import crypto from 'crypto'
import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import { PICTURE_WIPE_SECONDS, STORY_TTL_SECONDS, normalizeTags, OFFLINE_DELETION_SECONDS, OFFLINE_WARNING_SECONDS } from '@orbit/shared'
import { purgeExpiredBabecock } from './babecock'

const PICTURE_WIPE_MS = PICTURE_WIPE_SECONDS * 1000
const OFFLINE_DELETION_MS = OFFLINE_DELETION_SECONDS * 1000
const OFFLINE_WARNING_MS = OFFLINE_WARNING_SECONDS * 1000

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

async function getMeta(db: D1Turso, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(key).first<{ value: string | null }>()
  return row?.value ?? null
}

async function setMeta(db: D1Turso, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO SystemMeta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run()
}

export interface CleanupStats {
  expiredStories: number
  expiredObjects: number
  expiredLobbyImages: number
  expiredSessions: number
  staleRateLimits: number
  staleMatchCards: number
  staleMatchChat: number
  staleMatches: number
  deletedBlobs: number
  sweptOrphanBlobs: number
  pictureWiped: boolean
  dailyScoresReset: boolean
  offlineUsersDeleted: number
  offlineUsersWarned: number
}

/**
 * Continuous automatic expiration sweeper:
 * Removes expired stories, expired cards/objects, expired lobby images, expired sessions,
 * stale rate limits, old tournament match cards, old match chats, and ended matches older than 3 days.
 * Runs on every maintenance tick (e.g. every minute) and lazy request guards.
 */
export async function deleteExpiredContent(
  db: D1Turso,
  bucket?: LocalBlobStore,
  now: number = Date.now()
): Promise<Partial<CleanupStats>> {
  const stats: Partial<CleanupStats> = {
    expiredStories: 0,
    expiredObjects: 0,
    expiredLobbyImages: 0,
    expiredSessions: 0,
    staleRateLimits: 0,
    staleMatchCards: 0,
    staleMatchChat: 0,
    staleMatches: 0,
    deletedBlobs: 0,
  }

  const nowIso = isoFromMs(now)

  // 1. Expired Stories & Objects with explicit expiration
  const expiredObjs = await db
    .prepare(
      "SELECT id FROM Objects WHERE (is_story = 1 OR expires_at IS NOT NULL) AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)"
    )
    .bind(nowIso)
    .all<{ id: string }>()
    .catch(() => ({ results: [] }))

  if (expiredObjs.results && expiredObjs.results.length > 0) {
    for (const row of expiredObjs.results) {
      if (bucket) {
        await bucket.delete(`objects/${row.id}`).catch(() => {})
        stats.deletedBlobs = (stats.deletedBlobs || 0) + 1
      }
    }
    await db
      .prepare(
        "DELETE FROM Objects WHERE (is_story = 1 OR expires_at IS NOT NULL) AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)"
      )
      .bind(nowIso)
      .run()
      .catch(() => {})
    stats.expiredObjects = expiredObjs.results.length
  }

  // 2. Expired or empty LobbyImages
  const expiredLobby = await db
    .prepare(
      "SELECT id FROM LobbyImages WHERE (expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)) OR (content_url IS NULL OR content_url = '')"
    )
    .bind(nowIso)
    .all<{ id: string }>()
    .catch(() => ({ results: [] }))

  if (expiredLobby.results && expiredLobby.results.length > 0) {
    for (const row of expiredLobby.results) {
      if (bucket) {
        await bucket.delete(`lobby/${row.id}`).catch(() => {})
        stats.deletedBlobs = (stats.deletedBlobs || 0) + 1
      }
    }
    await db
      .prepare(
        "DELETE FROM LobbyImages WHERE (expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)) OR (content_url IS NULL OR content_url = '')"
      )
      .bind(nowIso)
      .run()
      .catch(() => {})
    stats.expiredLobbyImages = expiredLobby.results.length
  }

  // 3. Expired Sessions
  const sessionRes = await db
    .prepare("DELETE FROM Sessions WHERE datetime(expires_at) <= datetime(?)")
    .bind(nowIso)
    .run()
    .catch(() => {})
  stats.expiredSessions = sessionRes?.meta?.changes || 0

  // 3b. Lobby chat is capped at 12 hours — older rows are dropped so the replay
  // history never grows unbounded. Users are told "clears every 12 hours".
  await db.prepare("DELETE FROM LobbyChat WHERE datetime(created_at) < datetime(?, '-12 hours')").bind(nowIso).run().catch(() => {})

  // 3c. Match invites are transient: stale (expired / older than a day) rows
  // are swept so the table doesn't accumulate.
  await db
    .prepare("DELETE FROM MatchInvites WHERE datetime(expires_at) < datetime(?) OR datetime(updated_at) < datetime(?, '-1 day')")
    .bind(nowIso, nowIso)
    .run()
    .catch(() => {})

  // 3d. Notifications are kept for 48h then pruned.
  await db
    .prepare("DELETE FROM Notifications WHERE datetime(created_at) < datetime(?, '-2 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  // 3e. Match archive rows are kept for 14 days then pruned (admin-only report
  // browser; older duels are dropped to keep the table bounded).
  await db
    .prepare("DELETE FROM MatchArchive WHERE datetime(ended_at) < datetime(?, '-14 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  // 4. Stale RateLimits (older than 10 minutes)
  const tenMinsAgo = now - 10 * 60 * 1000
  await db
    .prepare("DELETE FROM RateLimits WHERE window_start < ?")
    .bind(tenMinsAgo)
    .run()
    .catch(() => {})

  // 5. Stale Tournament MatchCards (older than 24h or orphaned room)
  await db
    .prepare(
      "DELETE FROM MatchCards WHERE datetime(created_at) < datetime(?, '-1 day') OR room_id NOT IN (SELECT id FROM MatchRooms WHERE status != 'closed')"
    )
    .bind(nowIso)
    .run()
    .catch(() => {})

  // 6. Stale MatchChat (ended matches > 6h, or chats > 2 days)
  await db
    .prepare(
      "DELETE FROM MatchChat WHERE match_id IN (SELECT id FROM GameMatches WHERE status = 'ended' AND datetime(updated_at) < datetime(?, '-6 hours')) OR datetime(created_at) < datetime(?, '-2 days')"
    )
    .bind(nowIso, nowIso)
    .run()
    .catch(() => {})

  // 7. Old Ended Matches (> 3 days)
  await db
    .prepare("DELETE FROM GameMatches WHERE status = 'ended' AND datetime(updated_at) < datetime(?, '-3 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  await db
    .prepare("DELETE FROM TierMatches WHERE status = 'ended' AND datetime(updated_at) < datetime(?, '-3 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  await db
    .prepare("DELETE FROM MatchSessions WHERE status = 'ended' AND datetime(created_at) < datetime(?, '-3 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  await db
    .prepare("DELETE FROM MatchRooms WHERE status = 'closed' AND datetime(updated_at) < datetime(?, '-3 days')")
    .bind(nowIso)
    .run()
    .catch(() => {})

  // 8. Sweep orphaned relational rows
  await db.prepare('DELETE FROM Recipients WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})
  await db.prepare('DELETE FROM Favorites WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})
  await db.prepare('DELETE FROM Likes WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})
  await db.prepare('DELETE FROM MatchRounds WHERE session_id NOT IN (SELECT id FROM MatchSessions)').run().catch(() => {})
  await db.prepare('DELETE FROM MatchPairs WHERE round_id NOT IN (SELECT id FROM MatchRounds)').run().catch(() => {})
  await db.prepare('DELETE FROM MatchRoomPlayers WHERE room_id NOT IN (SELECT id FROM MatchRooms)').run().catch(() => {})
  await db.prepare('DELETE FROM RoomDuelPairs WHERE room_id NOT IN (SELECT id FROM MatchRooms)').run().catch(() => {})

  return stats
}

/**
 * Sweep orphaned blob files from disk that no longer exist in the database.
 */
export async function sweepOrphanedBlobs(db: D1Turso, bucket: LocalBlobStore): Promise<number> {
  let cleaned = 0
  try {
    if (typeof bucket.list === 'function') {
      const objectKeys = await bucket.list('objects')
      for (const key of objectKeys) {
        const id = key.replace(/^objects\//, '')
        const exists = await db.prepare('SELECT id FROM Objects WHERE id = ?').bind(id).first<{ id: string }>()
        if (!exists) {
          await bucket.delete(key).catch(() => {})
          cleaned++
        }
      }

      const lobbyKeys = await bucket.list('lobby')
      for (const key of lobbyKeys) {
        const id = key.replace(/^lobby\//, '')
        const exists = await db.prepare('SELECT id FROM LobbyImages WHERE id = ?').bind(id).first<{ id: string }>()
        if (!exists) {
          await bucket.delete(key).catch(() => {})
          cleaned++
        }
      }

      const babecockKeys = await bucket.list('babecock')
      for (const key of babecockKeys) {
        const id = key.replace(/^babecock\//, '')
        const exists = await db
          .prepare('SELECT id FROM BabecockEntries WHERE content_url = ?')
          .bind(`/api/babecock/entries/${id}/content`)
          .first<{ id: string }>()
        if (!exists) {
          await bucket.delete(key).catch(() => {})
          cleaned++
        }
      }
    }
  } catch (err) {
    console.warn('[MAINT] blob sweep error:', err)
  }
  return cleaned
}

/**
 * Wipe every transient piece of media whose TTL has elapsed and clear expired
 * lobby-board images. Permanent cards (expires_at = NULL) are never touched —
 * cards last forever. Runs at most once per PICTURE_WIPE_MS window (tracked in
 * SystemMeta). Explicit user-chosen timebomb expiries are removed here too,
 * matching deleteExpiredContent (kept for belt-and-braces on older DBs).
 */
export async function maybeWipePictures(
  db: D1Turso,
  bucket?: LocalBlobStore,
  now: number = Date.now()
): Promise<boolean> {
  const last = await getMeta(db, 'last_picture_wipe_at')
  if (last && now - new Date(last).getTime() < PICTURE_WIPE_MS) return false

  // Stories live until expires_at — remove the expired ones.
  await db
    .prepare("DELETE FROM Objects WHERE is_story = 1 AND expires_at IS NOT NULL AND datetime(expires_at) < datetime(?)")
    .bind(isoFromMs(now))
    .run()
    .catch(() => {})

  await db.prepare("DELETE FROM LobbyImages WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')").run().catch(() => {})

  // Sweep orphaned recipient/favorite/like rows for deleted objects.
  await db.prepare('DELETE FROM Recipients WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})
  await db.prepare('DELETE FROM Favorites WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})
  await db.prepare('DELETE FROM Likes WHERE object_id NOT IN (SELECT id FROM Objects)').run().catch(() => {})

  await setMeta(db, 'last_picture_wipe_at', isoFromMs(now))
  return true
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Upsert today's row in DailyStats with freshly aggregated counters. Runs on
 * every maintenance tick so `peak_concurrent` is a true observed max and the
 * row is never stale (see daily-stats admin / stats API which read DailyStats).
 * `new_users` is approximated as users whose earliest recorded last_seen is
 * today (Users has no created_at column; identity rows are written on first
 * auth with last_seen set).
 */
export async function recordDailyStats(db: D1Turso, now: number = Date.now()): Promise<void> {
  const day = todayUtc()
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayStartIso = dayStart.toISOString()

  const [activeUsers, matchesPlayed, newUsers, bannedUsers, reportsOpened, onlineNow] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM Users WHERE datetime(last_seen) >= datetime(?)').bind(dayStartIso).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM GameMatches WHERE date(created_at) = date(?)').bind(dayStartIso).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM (SELECT MIN(last_seen) AS first_seen FROM Users WHERE last_seen IS NOT NULL GROUP BY id HAVING date(first_seen) = date(?))').bind(dayStartIso).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM Bans WHERE date(created_at) = date(?)').bind(dayStartIso).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM ContentReports WHERE date(created_at) = date(?)').bind(dayStartIso).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM Users WHERE datetime(last_seen) >= datetime(?)')
      .bind(new Date(now - 2 * 60 * 1000).toISOString()).first<{ n: number }>(),
  ])

  await db.prepare(
    `INSERT INTO DailyStats (date, active_users, matches_played, peak_concurrent, new_users, banned_users, reports_opened)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       active_users = excluded.active_users,
       matches_played = excluded.matches_played,
       peak_concurrent = MAX(DailyStats.peak_concurrent, excluded.peak_concurrent),
       new_users = excluded.new_users,
       banned_users = excluded.banned_users,
       reports_opened = excluded.reports_opened`
  ).bind(
    day,
    Number(activeUsers?.n || 0),
    Number(matchesPlayed?.n || 0),
    Number(onlineNow?.n || 0),
    Number(newUsers?.n || 0),
    Number(bannedUsers?.n || 0),
    Number(reportsOpened?.n || 0),
  ).run()
}

/**
 * One-time pass that normalizes legacy Users.tags written by the older client
 * paths (uppercase / spaces / duplicates / stray `#`). Uses the shared
 * normalizeTags rule (same source of truth as the web client and the API).
 * Idempotent via a SystemMeta flag.
 */
export async function maybeNormalizeTags(db: D1Turso): Promise<boolean> {
  const done = await getMeta(db, 'tags_normalized_v1')
  if (done === '1') return false

  const rows = await db.prepare('SELECT id, tags FROM Users WHERE tags IS NOT NULL AND length(tags) > 0').all<{ id: string; tags: any }>()
  let changed = 0
  for (const row of rows.results) {
    let arr: string[] = []
    try { arr = JSON.parse(row.tags) } catch { continue }
    if (!Array.isArray(arr)) continue
    const cleaned = normalizeTags(arr)
    if (JSON.stringify(cleaned) === JSON.stringify(arr)) continue
    await db.prepare('UPDATE Users SET tags = ? WHERE id = ?').bind(JSON.stringify(cleaned), row.id).run()
    changed++
  }

  await setMeta(db, 'tags_normalized_v1', '1')
  if (changed > 0) console.log(`[MAINT] Normalized tags for ${changed} users`)
  return true
}

/**
 * Zero every user's score once per UTC day so the leaderboard always reflects
 * today's haul. Persists the reset date in SystemMeta so it is idempotent.
 */
export async function maybeResetDailyScores(db: D1Turso, now: number = Date.now()): Promise<boolean> {
  const last = await getMeta(db, 'last_score_reset_at')
  const day = todayUtc()
  const lastDay = last ? last.slice(0, 10) : null
  if (lastDay === day) return false

  await db.prepare('UPDATE Users SET score = 0').run().catch(() => {})
  await setMeta(db, 'last_score_reset_at', isoFromMs(now))
  return true
}

/**
 * Delete users who have been offline for more than 3 days (OFFLINE_DELETION_SECONDS).
 * Deletes ALL their content and the user account itself.
 * Runs during periodic maintenance.
 */
export async function deleteOfflineUsers(
  db: D1Turso,
  bucket?: LocalBlobStore,
  now: number = Date.now()
): Promise<{ deletedUsers: number; deletedObjects: number; deletedCards: number; deletedBlobs: number }> {
  const cutoffIso = isoFromMs(now - OFFLINE_DELETION_MS)
  const stats = { deletedUsers: 0, deletedObjects: 0, deletedCards: 0, deletedBlobs: 0 }

  // Find offline users (excluding bots)
  const offlineUsers = await db
    .prepare(
      `SELECT id FROM Users 
       WHERE id NOT LIKE 'bot_%' 
       AND (last_seen IS NULL OR datetime(last_seen) < datetime(?))`
    )
    .bind(cutoffIso)
    .all<{ id: string }>()

  if (!offlineUsers.results || offlineUsers.results.length === 0) {
    return stats
  }

  console.log(`[MAINT] Deleting ${offlineUsers.results.length} offline users`)

  for (const user of offlineUsers.results) {
    const userId = user.id
    try {
      // Delete user's objects and blobs
      const userObjects = await db
        .prepare('SELECT id FROM Objects WHERE owner_id = ?')
        .bind(userId)
        .all<{ id: string }>()
      
      if (userObjects.results && bucket) {
        for (const obj of userObjects.results) {
          await bucket.delete(`objects/${obj.id}`).catch(() => {})
          stats.deletedBlobs++
        }
      }
      if (userObjects.results) {
        stats.deletedObjects += userObjects.results.length
      }
      await db.prepare('DELETE FROM Objects WHERE owner_id = ?').bind(userId).run()

      // Delete user's cards and related data
      const userCards = await db
        .prepare('SELECT id FROM Cards WHERE creator_id = ?')
        .bind(userId)
        .all<{ id: string }>()
      
      if (userCards.results) {
        stats.deletedCards += userCards.results.length
        for (const card of userCards.results) {
          await db.prepare('DELETE FROM CardOwnership WHERE card_id = ?').bind(card.id).run()
          await db.prepare('DELETE FROM CardHistory WHERE card_id = ?').bind(card.id).run()
          await db.prepare('DELETE FROM MarketListings WHERE card_id = ?').bind(card.id).run()
          await db.prepare('DELETE FROM DeckCards WHERE card_id = ?').bind(card.id).run()
        }
      }
      await db.prepare('DELETE FROM Cards WHERE creator_id = ?').bind(userId).run()

      // Delete lobby images and blobs
      const userLobbyImages = await db
        .prepare('SELECT id FROM LobbyImages WHERE owner_id = ?')
        .bind(userId)
        .all<{ id: string }>()
      
      if (userLobbyImages.results && bucket) {
        for (const img of userLobbyImages.results) {
          await bucket.delete(`lobby/${img.id}`).catch(() => {})
          stats.deletedBlobs++
        }
      }
      await db.prepare('DELETE FROM LobbyImages WHERE owner_id = ?').bind(userId).run()

      // Delete match-local cards
      await db.prepare('DELETE FROM MatchCards WHERE owner_id = ?').bind(userId).run()

      // Delete relational data
      await db.prepare('DELETE FROM Recipients WHERE recipient_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM Favorites WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM Likes WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM LobbyComments WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM LobbyLikes WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM PrivateMessages WHERE sender_id = ? OR recipient_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM MatchChat WHERE sender_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM LobbyChat WHERE sender_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM Notifications WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM MatchInvites WHERE inviter_id = ? OR invitee_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM BabecockEntries WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM BabecockInvites WHERE host_id = ? OR invitee_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM Followers WHERE follower_id = ? OR followee_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM Friends WHERE user_id = ? OR friend_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM FriendRequests WHERE sender_id = ? OR receiver_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM UserBlocks WHERE blocker_id = ? OR blocked_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM UserReports WHERE reporter_id = ? OR reported_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM Playtime WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM DonationAcknowledgement WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM SessionEvents WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM StoreUnlocks WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM UserInventory WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM DominationActions WHERE dominator_id = ? OR victim_id = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM LeagueRank WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM MatchArchive WHERE user_a = ? OR user_b = ?').bind(userId, userId).run()
      await db.prepare('DELETE FROM Wallets WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM LedgerTransactions WHERE user_id = ?').bind(userId).run()
      await db.prepare('DELETE FROM EconomicOperations WHERE user_id = ?').bind(userId).run()

      // Delete the user account
      await db.prepare('DELETE FROM Users WHERE id = ?').bind(userId).run()

      // Log to audit
      await db.prepare(
        'INSERT INTO AdminAuditLog (id, admin_id, action, target_id, target_type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), 'system', 'offline_user_purge', userId, 'user', `Offline > ${OFFLINE_DELETION_SECONDS / 86400} days`, isoFromMs(now)).run()

      stats.deletedUsers++
    } catch (err) {
      console.error(`[MAINT] Failed to delete offline user ${userId}:`, err)
    }
  }

  return stats
}

/**
 * Send warning notifications to users who have been offline for 2-3 days.
 * Only sends once per warning period (tracked via SystemMeta).
 */
export async function sendOfflineWarnings(
  db: D1Turso,
  now: number = Date.now()
): Promise<number> {
  const warningCutoffIso = isoFromMs(now - OFFLINE_WARNING_MS)
  const deletionCutoffIso = isoFromMs(now - OFFLINE_DELETION_MS)
  let warnedCount = 0

  // Find users in warning window (offline 2-3 days, not bots)
  const warningUsers = await db
    .prepare(
      `SELECT id, last_seen FROM Users 
       WHERE id NOT LIKE 'bot_%' 
       AND last_seen IS NOT NULL 
       AND datetime(last_seen) < datetime(?) 
       AND datetime(last_seen) >= datetime(?)`
    )
    .bind(warningCutoffIso, deletionCutoffIso)
    .all<{ id: string; last_seen: string }>()

  if (!warningUsers.results || warningUsers.results.length === 0) {
    return 0
  }

  for (const user of warningUsers.results) {
    const userId = user.id
    const lastSeen = user.last_seen
    try {
      // Check if we already sent a warning today
      const todayKey = `offline_warning_${userId}_${new Date().toISOString().slice(0, 10)}`
      const existing = await db.prepare('SELECT 1 FROM SystemMeta WHERE key = ?').bind(todayKey).first()
      if (existing) continue

      const lastSeenMs = new Date(lastSeen).getTime()
      const daysOffline = Math.floor((now - lastSeenMs) / (24 * 60 * 60 * 1000))
      const hoursLeft = Math.ceil((OFFLINE_DELETION_MS - (now - lastSeenMs)) / (60 * 60 * 1000))

      await db.prepare(
        `INSERT INTO Notifications (id, user_id, type, title, body, data, read, created_at) 
         VALUES (?, ?, 'offline_warning', ?, ?, ?, 0, ?)`
      ).bind(
        crypto.randomUUID(),
        userId,
        'Account expires soon',
        `You've been offline for ${daysOffline} day(s). Your account and all content will be permanently deleted in ~${hoursLeft} hour(s). Log in now to keep your data.`,
        JSON.stringify({ daysOffline, hoursLeft }),
        isoFromMs(now)
      ).run()

      await db.prepare('INSERT INTO SystemMeta (key, value) VALUES (?, ?)').bind(todayKey, '1').run()
      warnedCount++
    } catch (err) {
      console.error(`[MAINT] Failed to send offline warning to ${userId}:`, err)
    }
  }

  return warnedCount
}

/** Run every maintenance task; used by the server interval and lazy request guards. */
export async function runPeriodicMaintenance(
  db: D1Turso,
  bucket?: LocalBlobStore,
  now: number = Date.now(),
  forceWipe = false
): Promise<CleanupStats> {
  // Run offline user deletion FIRST (most critical)
  const offlineStats = await deleteOfflineUsers(db, bucket, now)
  const warnedCount = await sendOfflineWarnings(db, now)

  const expiredStats = await deleteExpiredContent(db, bucket, now)
  const wiped = forceWipe
    ? (await setMeta(db, 'last_picture_wipe_at', '1970-01-01T00:00:00.000Z'), await maybeWipePictures(db, bucket, now))
    : await maybeWipePictures(db, bucket, now)
  const resetScores = await maybeResetDailyScores(db, now)
  await maybeNormalizeTags(db)
  await purgeExpiredBabecock(db, bucket).catch(() => {})
  await recordDailyStats(db, now).catch(() => {})

  let sweptBlobs = 0
  if (bucket) {
    sweptBlobs = await sweepOrphanedBlobs(db, bucket)
  }

  return {
    expiredStories: expiredStats.expiredStories || 0,
    expiredObjects: expiredStats.expiredObjects || 0,
    expiredLobbyImages: expiredStats.expiredLobbyImages || 0,
    expiredSessions: expiredStats.expiredSessions || 0,
    staleRateLimits: expiredStats.staleRateLimits || 0,
    staleMatchCards: expiredStats.staleMatchCards || 0,
    staleMatchChat: expiredStats.staleMatchChat || 0,
    staleMatches: expiredStats.staleMatches || 0,
    deletedBlobs: expiredStats.deletedBlobs || 0,
    sweptOrphanBlobs: sweptBlobs,
    pictureWiped: wiped,
    dailyScoresReset: resetScores,
    offlineUsersDeleted: offlineStats.deletedUsers,
    offlineUsersWarned: warnedCount,
  }
}
