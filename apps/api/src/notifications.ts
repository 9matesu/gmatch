import type { D1Turso } from './db'
import type { GameMatch } from '@orbit/shared'
import { MIN_GAME_CARDS } from '@orbit/shared'

/**
 * Server-persisted in-app notifications + match invites.
 *
 * Notifications are the persistent record behind the header bell: created
 * server-side for events (match invite, match result, PM, babecock invite,
 * system), stored in the Notifications table, pushed over WS in real time,
 * and replayed via GET /api/notifications on reload. Rows are pruned after
 * 48h by the maintenance sweep (cleanup.ts).
 *
 * Match invites are the "challenge a specific player" flow: any user with a
 * card can challenge one online player to a direct 1v1 (bypassing the queue).
 * The invitee sees it in the bell with Accept/Decline; accepting creates a
 * fresh GameMatches duel via lobby.createDirectMatch.
 */

export type NotificationType = 'match_invite' | 'match_result' | 'pm' | 'babecock_invite' | 'babecock_start' | 'like' | 'comment' | 'follow' | 'card_received' | 'system'

export interface NotificationRow {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  data: string | null
  read: number
  created_at: string
}

export interface MatchInviteRow {
  id: string
  inviter_id: string
  invitee_id: string
  status: 'open' | 'accepted' | 'declined' | 'expired'
  created_at: string
  updated_at: string
  expires_at: string
  inviter_name?: string | null
  inviter_pfp_url?: string | null
}

/** How long a match invite stays open before it expires. */
export const MATCH_INVITE_TTL_MS = 30 * 1000

export async function createNotification(
  db: D1Turso,
  userId: string,
  type: NotificationType,
  title: string,
  body?: string | null,
  data?: Record<string, unknown> | null
): Promise<NotificationRow | null> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await db
      .prepare(
        'INSERT INTO Notifications (id, user_id, type, title, body, data, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      )
      .bind(id, userId, type, title.slice(0, 200), body ? body.slice(0, 500) : null, data ? JSON.stringify(data) : null, now)
      .run()
    return { id, user_id: userId, type, title, body: body ?? null, data: data ? JSON.stringify(data) : null, read: 0, created_at: now }
  } catch (err) {
    return null
  }
}

export async function listNotifications(db: D1Turso, userId: string, limit = 50): Promise<NotificationRow[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM Notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, Math.min(Math.max(1, limit), 200))
      .all<NotificationRow>()
    return (results || []).map((r) => ({ ...r, read: Number(r.read) || 0 }))
  } catch {
    return []
  }
}

export async function unreadNotificationCount(db: D1Turso, userId: string): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT COUNT(*) as n FROM Notifications WHERE user_id = ? AND read = 0')
      .bind(userId)
      .first<{ n: number }>()
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/** Mark a set of notifications read for a user. Empty ids = mark all. */
export async function markNotificationsRead(db: D1Turso, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await db.prepare('UPDATE Notifications SET read = 1 WHERE user_id = ?').bind(userId).run().catch(() => {})
    return
  }
  await db
    .prepare(`UPDATE Notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(userId, ...ids)
    .run()
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Match invites
// ---------------------------------------------------------------------------

export async function listMyInvites(db: D1Turso, userId: string): Promise<MatchInviteRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT mi.id, mi.inviter_id, mi.invitee_id, mi.status, mi.created_at, mi.updated_at, mi.expires_at,
                u.display_name as inviter_name, u.pfp_url as inviter_pfp_url
         FROM MatchInvites mi
         LEFT JOIN Users u ON u.id = mi.inviter_id
         WHERE mi.invitee_id = ?
         ORDER BY mi.created_at DESC
         LIMIT 30`
      )
      .bind(userId)
      .all<MatchInviteRow>()
    return results || []
  } catch {
    return []
  }
}

/** Check a user is not currently in an active duel. */
async function inActiveMatch(db: D1Turso, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM GameMatches WHERE status IN ('lobby', 'playing') AND (user_a = ? OR user_b = ?) LIMIT 1")
    .bind(userId, userId)
    .first()
  return Boolean(row)
}

/**
 * Challenge a specific online player to a direct 1v1. Returns the created
 * invite, or `{ error, status }`.
 */
export async function createMatchInvite(
  db: D1Turso,
  inviterId: string,
  inviteeId: string,
  now: number = Date.now()
): Promise<MatchInviteRow | { error: string; status: number }> {
  if (!inviteeId.trim()) return { error: 'invitee_id is required', status: 400 }
  if (inviteeId === inviterId) return { error: 'You cannot challenge yourself', status: 400 }

  // Invitee must exist and be online (strict 60s window, matching the roster).
  const onlineCutoff = new Date(now - 60 * 1000).toISOString()
  const invitee = await db
    .prepare("SELECT 1 FROM Users WHERE id = ? AND last_seen IS NOT NULL AND datetime(last_seen) >= datetime(?)")
    .bind(inviteeId, onlineCutoff)
    .first()
  if (!invitee) return { error: 'That player is not online right now', status: 409 }

  // Inviter must have at least MIN_GAME_CARDS cards (same gate as the queue).
  const own = await db
    .prepare('SELECT COUNT(*) AS n FROM Objects WHERE owner_id = ? AND is_story = 0')
    .bind(inviterId)
    .first<{ n: number }>()
  if (!own || (own.n ?? 0) < MIN_GAME_CARDS) return { error: `Upload at least ${MIN_GAME_CARDS} pictures before challenging someone.`, status: 400 }

  // Neither side may already be locked in a duel.
  if (await inActiveMatch(db, inviterId)) return { error: 'You are already in an active match', status: 409 }
  if (await inActiveMatch(db, inviteeId)) return { error: 'That player is already in a match', status: 409 }

  // Reuse an existing open invite from this inviter to this invitee.
  const existing = await db
    .prepare("SELECT * FROM MatchInvites WHERE inviter_id = ? AND invitee_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1")
    .bind(inviterId, inviteeId)
    .first<MatchInviteRow>()
  if (existing) {
    const u = await db.prepare('SELECT display_name, pfp_url FROM Users WHERE id = ?').bind(inviterId).first<{ display_name: string | null; pfp_url: string | null }>()
    return { ...existing, inviter_name: u?.display_name ?? null, inviter_pfp_url: u?.pfp_url ?? null }
  }

  const id = crypto.randomUUID()
  const nowIso = new Date(now).toISOString()
  const expiresIso = new Date(now + MATCH_INVITE_TTL_MS).toISOString()
  await db
    .prepare(
      "INSERT INTO MatchInvites (id, inviter_id, invitee_id, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'open', ?, ?, ?)"
    )
    .bind(id, inviterId, inviteeId, nowIso, nowIso, expiresIso)
    .run()

  const u = await db.prepare('SELECT display_name, pfp_url FROM Users WHERE id = ?').bind(inviterId).first<{ display_name: string | null; pfp_url: string | null }>()

  // Persistent notification for the invitee's bell (survives reload) so the
  // challenge is visible even if the WS push is missed.
  const notif = await createNotification(
    db,
    inviteeId,
    'match_invite',
    'Match challenge',
    `${u?.display_name || 'Someone'} challenged you to a 1v1 match`,
    { invite_id: id, inviter_id: inviterId }
  )
  if (notif) {
    const { broadcastToUser } = await import('./ws-bus')
    broadcastToUser(inviteeId, { type: 'notification', action: 'new', notification: notif })
  }

  return {
    id,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    status: 'open',
    created_at: nowIso,
    updated_at: nowIso,
    expires_at: expiresIso,
    inviter_name: u?.display_name ?? null,
    inviter_pfp_url: u?.pfp_url ?? null,
  }
}

export async function loadMatchInvite(db: D1Turso, inviteId: string): Promise<MatchInviteRow | null> {
  return db
    .prepare(
      `SELECT mi.id, mi.inviter_id, mi.invitee_id, mi.status, mi.created_at, mi.updated_at, mi.expires_at,
              u.display_name as inviter_name, u.pfp_url as inviter_pfp_url
       FROM MatchInvites mi
       LEFT JOIN Users u ON u.id = mi.inviter_id
       WHERE mi.id = ?`
    )
    .bind(inviteId)
    .first<MatchInviteRow>()
}

/**
 * Accept an open match invite as the invitee. On success the inviter and
 * invitee are placed into a fresh GameMatches duel and an accept notification
 * is pushed to the inviter. Returns the created match, or `{ error, status }`.
 */
export async function acceptMatchInvite(
  db: D1Turso,
  inviteId: string,
  inviteeId: string,
  now: number = Date.now()
): Promise<GameMatch | { error: string; status: number }> {
  const invite = await loadMatchInvite(db, inviteId)
  if (!invite) return { error: 'Invite not found', status: 404 }
  if (invite.invitee_id !== inviteeId) return { error: 'This invite is not for you', status: 403 }
  if (invite.status !== 'open') return { error: 'This invite is no longer open', status: 409 }
  if (new Date(invite.expires_at).getTime() <= now) {
    await db.prepare("UPDATE MatchInvites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(inviteId).run()
    return { error: 'This invite has expired', status: 409 }
  }

  // Re-verify neither side is in a duel (state may have changed since invite).
  if (await inActiveMatch(db, invite.inviter_id)) {
    await db.prepare("UPDATE MatchInvites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(inviteId).run()
    return { error: 'The challenger is already in a match', status: 409 }
  }
  if (await inActiveMatch(db, inviteeId)) return { error: 'You are already in a match', status: 409 }

  const { createDirectMatch } = await import('./lobby')
  const match = await createDirectMatch(db, invite.inviter_id, inviteeId, now)
  if (!match) return { error: 'Failed to start the match', status: 500 }

  await db.prepare("UPDATE MatchInvites SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(inviteId).run()

  const u = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(inviteeId).first<{ display_name: string | null }>()
  const { createNotification } = await import('./notifications')
  const notif = await createNotification(
    db,
    invite.inviter_id,
    'match_invite',
    'Match accepted',
    `${u?.display_name || 'Someone'} accepted your challenge — the match is starting!`,
    { invite_id: inviteId, match_id: match.id, accepted: true }
  )
  if (notif) {
    const { broadcastToUser } = await import('./ws-bus')
    broadcastToUser(invite.inviter_id, { type: 'notification', action: 'new', notification: notif })
  }

  return match
}

/** Decline an open match invite as the invitee. */
export async function declineMatchInvite(
  db: D1Turso,
  inviteId: string,
  inviteeId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const invite = await loadMatchInvite(db, inviteId)
  if (!invite) return { error: 'Invite not found', status: 404 }
  if (invite.invitee_id !== inviteeId) return { error: 'This invite is not for you', status: 403 }
  if (invite.status !== 'open') return { ok: true }

  await db.prepare("UPDATE MatchInvites SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(inviteId).run()

  const u = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(inviteeId).first<{ display_name: string | null }>()
  const notif = await createNotification(
    db,
    invite.inviter_id,
    'match_invite',
    'Challenge declined',
    `${u?.display_name || 'Someone'} declined your challenge`,
    { invite_id: inviteId, declined: true }
  )
  if (notif) {
    const { broadcastToUser } = await import('./ws-bus')
    broadcastToUser(invite.inviter_id, { type: 'notification', action: 'new', notification: notif })
  }
  return { ok: true }
}

/** Mark any still-open invites past their TTL as expired. */
export async function expireStaleInvites(db: D1Turso, now: number = Date.now()): Promise<void> {
  await db
    .prepare("UPDATE MatchInvites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'open' AND datetime(expires_at) <= datetime(?)")
    .bind(new Date(now).toISOString())
    .run()
    .catch(() => {})
}
