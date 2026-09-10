import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso, AtomicStatement } from '../db'
import type { LocalBlobStore } from '../blob'
import { normalizeTags, checkBlacklistedTags, STORE_ITEMS, computeCardRarity, generateFallbackName, isDefaultPeerName } from '@orbit/shared'
import { parseLootboxTags, normalizeDrawConfig } from '../lootboxes/service'
import { recomputeUserCounters } from '../game'
import { maybeResetDailyScores } from '../cleanup'
import { broadcastToRoom } from '../ws-bus'
import { reportContent, ReportError } from '../reports'
import { EconomyService, buildDebitStatements, type BalanceOpResult } from '../economy'
import { mintCardStatements } from '../cards'
import crypto from 'crypto'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const users = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

// Public unauthenticated endpoint for avatar image rendering in standard <img> tags
users.get('/:id/pfp', async (c) => {
  const userId = c.req.param('id')
  if (!userId) return c.text('Not found', 404)

  try {
    const row = await c.env.DB.prepare('SELECT pfp_url, hidden_at FROM Users WHERE id = ?').bind(userId).first<{ pfp_url: string | null; hidden_at: string | null }>()
    if (!row || !row.pfp_url || row.hidden_at) return c.text('No avatar set', 404)

    const pfp = row.pfp_url
    if (pfp.startsWith('data:')) {
      const parts = pfp.split(',')
      const mimeMatch = parts[0].match(/:(.*?);/)
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
      const base64Data = parts[1] || ''
      const buf = Buffer.from(base64Data, 'base64')
      return new Response(buf, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    if (pfp.startsWith('http://') || pfp.startsWith('https://')) {
      return c.redirect(pfp, 302)
    }

    return c.text('Invalid avatar format', 404)
  } catch {
    return c.text('Failed to load avatar', 500)
  }
})

users.use('*', orbitAuth)

users.get('/me', async (c) => {
  const orbitId = c.get('orbitId')
  const user = await c.env.DB.prepare(
    `SELECT u.*, COALESCE(w.balance, 0) as balance, COALESCE(lr.wins, 0) as matches_won, COALESCE(lr.losses, 0) as matches_lost
     FROM Users u
     LEFT JOIN Wallets w ON w.user_id = u.id
     LEFT JOIN LeagueRank lr ON lr.user_id = u.id
     WHERE u.id = ? AND u.hidden_at IS NULL`
  ).bind(orbitId).first<any>()

  if (!user) return c.json({ error: 'User not found' }, 404)
  let tags: string[] = []
  try { tags = user.tags ? JSON.parse(user.tags) : [] } catch {}
  return c.json({
    id: user.id,
    publicKey: user.public_key,
    encryptionPubKey: user.encryption_pub_key || null,
    display_name: user.display_name?.trim() || generateFallbackName(user.id),
    tags,
    pfp_url: user.pfp_url || null,
    bio: user.bio || '',
    website: user.website || '',
    last_seen: user.last_seen || null,
    followers_count: Number(user.followers_count || 0),
    following_count: Number(user.following_count || 0),
    posts_count: Number(user.posts_count || 0),
    score: Number(user.score || 0),
    reputation: Number(user.score_total || 0),
    balance: Number(user.balance || 0),
    is_admin: Boolean(user.is_admin),
    is_moderator: Boolean(user.is_moderator || user.is_admin),
    maximum_gooner: Boolean(user.maximum_gooner),
    is_private: Boolean(user.is_private),
    matches_won: Number(user.matches_won ?? 0),
    matches_lost: Number(user.matches_lost ?? 0),
  })
})

users.get('/', async (c) => {
  const orbitId = c.get('orbitId')
  const limitParam = parseInt(c.req.query('limit') || '100', 10)
  const limit = isNaN(limitParam) ? 100 : Math.min(Math.max(1, limitParam), 200)
  const cursor = c.req.query('cursor') || ''

  let results: any[] = []
  try {
    let queryStr = `
      SELECT u.id, u.public_key, u.encryption_pub_key, u.display_name, u.tags, u.pfp_url, u.last_seen, u.attention_at,
             COALESCE(u.objects_sent_count, 0) as objects_sent_count,
             COALESCE(u.gacha_items_collected, 0) as gacha_items_collected,
             COALESCE(u.maximum_gooner, 0) as maximum_gooner,
             COALESCE(u.is_admin, 0) as is_admin,
             COALESCE(u.is_moderator, 0) as is_moderator,
             COALESCE(u.likes_given, 0) as likes_given,
             COALESCE(u.likes_received, 0) as likes_received,
             COALESCE(u.matches_total, 0) as matches_total,
             COALESCE(u.score, 0) as score,
             COALESCE(u.score_total, 0) as score_total,
             COALESCE(u.bio, '') as bio,
             COALESCE(u.website, '') as website,
             COALESCE(u.followers_count, 0) as followers_count,
             COALESCE(u.following_count, 0) as following_count,
             COALESCE(u.posts_count, 0) as posts_count,
             COALESCE(u.is_private, 0) as is_private,
             COALESCE(g.sum_downloads, 0) as gacha_downloads_received,
             COALESCE(lr.wins, 0) as matches_won,
             COALESCE(lr.losses, 0) as matches_lost,
             COALESCE(w.balance, 0) as balance
      FROM Users u
      LEFT JOIN (
        SELECT owner_id, SUM(COALESCE(gacha_downloads_count, 0)) as sum_downloads
        FROM Objects
        GROUP BY owner_id
      ) g ON g.owner_id = u.id
      LEFT JOIN LeagueRank lr ON lr.user_id = u.id
      LEFT JOIN Wallets w ON w.user_id = u.id
    `
    const params: any[] = []
    if (cursor) {
      queryStr += ' WHERE u.hidden_at IS NULL AND u.id > ?'
      params.push(cursor)
    } else {
      queryStr += ' WHERE u.hidden_at IS NULL'
    }
    queryStr += ' ORDER BY u.id ASC LIMIT ?'
    params.push(limit)

    const res = await c.env.DB.prepare(queryStr).bind(...params).all()
    results = res.results || []
  } catch (err) {
    let queryStr = `
      SELECT u.id, u.public_key, u.encryption_pub_key, u.display_name, u.tags, u.last_seen, u.attention_at,
             COALESCE(u.objects_sent_count, 0) as objects_sent_count,
             COALESCE(u.score, 0) as score,
             COALESCE(u.score_total, 0) as score_total,
             COALESCE(u.bio, '') as bio,
             COALESCE(u.website, '') as website,
             COALESCE(u.followers_count, 0) as followers_count,
             COALESCE(u.following_count, 0) as following_count,
             COALESCE(u.posts_count, 0) as posts_count,
             COALESCE(u.is_private, 0) as is_private,
             COALESCE(u.is_moderator, 0) as is_moderator,
             COALESCE(u.is_admin, 0) as is_admin
      FROM Users u
    `
    const params: any[] = []
    if (cursor) {
      queryStr += ' WHERE u.hidden_at IS NULL AND u.id > ?'
      params.push(cursor)
    } else {
      queryStr += ' WHERE u.hidden_at IS NULL'
    }
    queryStr += ' ORDER BY u.id ASC LIMIT ?'
    params.push(limit)

    const res = await c.env.DB.prepare(queryStr).bind(...params).all()
    results = res.results || []
  }

  const now = Date.now()
  // Lazy daily score reset so the leaderboard always reflects today's haul.
  await maybeResetDailyScores(c.env.DB, now).catch(() => {})
  const mapped = (results as any[]).map(u => {
    let tags: string[] = []
    try { tags = u.tags ? JSON.parse(u.tags) : [] } catch { tags = [] }
    const lastSeen = u.last_seen ? new Date(u.last_seen).getTime() : 0
    const online = lastSeen > 0 && (now - lastSeen) < 60_000
    const attentionAt = u.attention_at ? new Date(u.attention_at).getTime() : 0
    const attention = attentionAt > 0 && (now - attentionAt) < 30_000

    const sentCount = u.objects_sent_count ?? 0
    const downloadsReceived = u.gacha_downloads_received ?? 0
    const itemsCollected = u.gacha_items_collected ?? 0
    const likesGiven = u.likes_given ?? 0
    const likesReceived = u.likes_received ?? 0
    const matchesTotal = u.matches_total ?? 0

    // Scores reset once per UTC day; read the live column (fall back to the
    // legacy derived formula for rows created before the column existed).
    const score = u.score != null ? Number(u.score) : (sentCount * 10) + (downloadsReceived * 15) + (itemsCollected * 5) + (likesReceived * 25) + (likesGiven * 20) + (matchesTotal * 100)

    const isAdmin = u.id === orbitId ? Boolean(Number((u as any).is_admin)) : undefined
    const isModerator = Boolean(Number((u as any).is_moderator)) || Boolean(Number((u as any).is_admin))

    return {
      id: u.id,
      publicKey: u.public_key,
      encryptionPubKey: u.encryption_pub_key || null,
      display_name: u.display_name?.trim() || generateFallbackName(u.id),
      tags: tags.length > 0 ? tags : undefined,
      pfp_url: u.pfp_url || undefined,
      last_seen: u.last_seen || undefined,
      online,
      attention,
      objects_sent_count: sentCount,
      gacha_downloads_received: downloadsReceived,
      gacha_items_collected: itemsCollected,
      likes_given: likesGiven,
      likes_received: likesReceived,
      matches_total: matchesTotal,
      matches_won: Number(u.matches_won ?? 0),
      matches_lost: Number(u.matches_lost ?? 0),
      score,
      daily_score: score,
      reputation: Number(u.score_total ?? 0),
      balance: u.id === orbitId ? Number(u.balance ?? 0) : undefined,
      maximum_gooner: u.maximum_gooner ? true : false,
      bio: u.bio || undefined,
      website: u.website || undefined,
      followers_count: Number(u.followers_count ?? 0),
      following_count: Number(u.following_count ?? 0),
      posts_count: Number(u.posts_count ?? 0),
      is_private: Number(u.is_private ?? 0) === 1,
      is_admin: isAdmin,
      is_moderator: isModerator,
    }
  })

  // Filter out stale accounts (offline >24h)
  const STALE_CUTOFF = 24 * 60 * 60 * 1000
  const staleFiltered = mapped.filter(u => {
    if (u.id === orbitId) return true
    if (u.online || u.attention) return true
    if (!u.last_seen) return false
    return (now - new Date(u.last_seen).getTime()) < STALE_CUTOFF
  })

  staleFiltered.sort((a, b) => {
    if (a.id === orbitId) return -1
    if (b.id === orbitId) return 1
    if (a.attention && !b.attention) return -1
    if (!a.attention && b.attention) return 1
    if ((a.objects_sent_count ?? 0) > (b.objects_sent_count ?? 0)) return -1
    if ((a.objects_sent_count ?? 0) < (b.objects_sent_count ?? 0)) return 1
    if (a.online && !b.online) return -1
    if (!a.online && b.online) return 1
    const aTime = a.last_seen ? new Date(a.last_seen).getTime() : 0
    const bTime = b.last_seen ? new Date(b.last_seen).getTime() : 0
    return bTime - aTime
  })

  return c.json(staleFiltered)
})

users.post('/heartbeat', async (c) => {
  const orbitId = c.get('orbitId')
  const now = new Date().toISOString()
  try {
    await c.env.DB.prepare('UPDATE Users SET last_seen = ? WHERE id = ?').bind(now, orbitId).run()
    await c.env.DB.prepare('INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)').bind(orbitId).run()
  } catch (err) {
    console.warn('[users] Heartbeat update failed:', err)
  }
  return c.json({ ok: true })
})

// Discovery roster: who is online RIGHT NOW (last_seen within 60s, the same
// window `GET /api/users` uses). A joining client seeds its peer map from
// this instead of waiting passively for a swarm event.
users.get('/online', async (c) => {
  const callerId = c.get('orbitId')
  const since = new Date(Date.now() - 60_000).toISOString()
  let rows: any[] = []
  try {
    const res = await c.env.DB.prepare(
      `SELECT id, public_key, encryption_pub_key, display_name, tags, pfp_url,
              last_seen, score, maximum_gooner
       FROM Users
       WHERE hidden_at IS NULL AND last_seen >= ? AND id != ?
       ORDER BY last_seen DESC LIMIT 100`,
    ).bind(since, callerId).all()
    rows = res.results || []
  } catch (err) {
    console.warn('[users] online roster failed:', err)
    return c.json({ error: 'roster unavailable' }, 500)
  }
  const users = rows.map((u) => {
    let tags: string[] = []
    try { tags = u.tags ? JSON.parse(u.tags) : [] } catch { tags = [] }
    return {
      id: u.id,
      public_key: u.public_key,
      encryption_pub_key: u.encryption_pub_key || undefined,
      display_name: u.display_name,
      tags,
      pfp_url: u.pfp_url || undefined,
      last_seen: u.last_seen || undefined,
      score: u.score ?? 0,
      maximum_gooner: u.maximum_gooner ?? 0,
      online: true,
    }
  })
  return c.json({ users, ts: Date.now() })
})

// Canonical public profile by id (GET /api/users/:id) — the target of
// share permalinks. Registered AFTER static routes so it shadows nothing;
// returns only public fields.
users.get('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    `SELECT id, public_key, encryption_pub_key, display_name, bio, website,
            tags, pfp_url, last_seen, score, followers_count,
            following_count, posts_count, likes_received, is_private, is_admin, is_moderator
     FROM Users WHERE id = ? AND hidden_at IS NULL`,
  ).bind(id).first<Record<string, unknown>>()
  if (!row) return c.json({ error: 'User not found' }, 404)
  let tags: string[] = []
  try { tags = row.tags ? JSON.parse(String(row.tags)) : [] } catch { tags = [] }
  return c.json({
    user: {
      id: row.id,
      public_key: row.public_key,
      encryption_pub_key: row.encryption_pub_key || undefined,
      display_name: row.display_name,
      bio: row.bio || '',
      website: row.website || '',
      tags,
      pfp_url: row.pfp_url || undefined,
      last_seen: row.last_seen || undefined,
      score: row.score ?? 0,
      followers_count: row.followers_count ?? 0,
      following_count: row.following_count ?? 0,
      posts_count: row.posts_count ?? 0,
      likes_received: row.likes_received ?? 0,
      is_private: Number(row.is_private) === 1,
      is_admin: Number(row.is_admin) === 1,
      is_moderator: Number(row.is_moderator) === 1,
    },
  })
})

users.post('/attention', async (c) => {
  const orbitId = c.get('orbitId')
  const now = new Date()
  const nowMs = now.getTime()

  // Check cooldown
  const row = await c.env.DB.prepare('SELECT attention_at FROM Users WHERE id = ?').bind(orbitId).first<{ attention_at: string | null }>()
  if (row?.attention_at) {
    const lastAt = new Date(row.attention_at).getTime()
    const elapsed = nowMs - lastAt
    if (elapsed < 30_000) {
      const remaining = Math.ceil((30_000 - elapsed) / 1000)
      return c.json({ error: `Cooldown: wait ${remaining}s`, cooldown_remaining: remaining }, 429)
    }
  }

  await c.env.DB.prepare('UPDATE Users SET attention_at = ? WHERE id = ?').bind(now.toISOString(), orbitId).run()
  await c.env.DB.prepare('INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)').bind(orbitId).run()
  return c.json({ ok: true, cooldown_remaining: 0 })
})

users.on(['PATCH', 'PUT'], '/profile', async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json()

  // Reject unexpected fields
  const allowedKeys = ['display_name', 'tags', 'pfp_url', 'bio', 'website']
  const unknownKeys = Object.keys(body).filter(k => !allowedKeys.includes(k))
  if (unknownKeys.length > 0) {
    return c.json({ error: `Unexpected fields: ${unknownKeys.join(', ')}` }, 400)
  }

  const { display_name, tags, pfp_url } = body

  // Every authenticated account must have a real profile name. The auth
  // middleware may create a temporary row before onboarding completes, but no
  // profile update may leave that row nameless.
  const existing = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?')
    .bind(orbitId).first<{ display_name: string | null }>()

  let cleanBio: string | undefined
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > 150) {
      return c.json({ error: 'Bio must be a string with at most 150 characters' }, 400)
    }
    cleanBio = body.bio.trim()
  }
  let cleanWebsite: string | undefined
  if (body.website !== undefined) {
    if (typeof body.website !== 'string' || body.website.length > 200) {
      return c.json({ error: 'Website must be a string with at most 200 characters' }, 400)
    }
    cleanWebsite = body.website.trim()
    if (cleanWebsite && !/^https?:\/\//i.test(cleanWebsite) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(cleanWebsite)) {
      return c.json({ error: 'Website must be a valid URL or domain' }, 400)
    }
  }

  let cleanName: string | undefined
  if (display_name !== undefined) {
    if (typeof display_name !== 'string' || display_name.length > 50) {
      return c.json({ error: 'Display name must be a string with at most 50 characters' }, 400)
    }
    const trimmed = display_name.trim()
    if (!trimmed) {
      return c.json({ error: 'Display name cannot be empty or whitespace-only' }, 400)
    }
    if (trimmed.length > 50) {
      return c.json({ error: 'Display name must be at most 50 characters' }, 400)
    }
    if (/[<>\x00-\x1f\x7f]/.test(trimmed)) {
      return c.json({ error: 'Display name cannot contain <, >, or control characters' }, 400)
    }
    if (isDefaultPeerName(trimmed)) {
      return c.json({ error: 'Display name cannot use pre-generated or default user format' }, 400)
    }
    cleanName = trimmed
  }
  if (!cleanName && !existing?.display_name?.trim()) {
    return c.json({ error: 'Display name is required' }, 400)
  }
  let cleanTags: string[] | undefined
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 5) {
      return c.json({ error: 'Tags must be an array of at most 5 strings' }, 400)
    }
    for (const raw of tags) {
      if (typeof raw !== 'string' || raw.length === 0 || raw.length > 20) {
        return c.json({ error: 'Each tag must be a non-empty string with at most 20 characters' }, 400)
      }
      if (/[<>&"']/.test(raw)) {
        return c.json({ error: 'Tags cannot contain < > & " or \'' }, 400)
      }
    }
    const { hasBlacklisted, blockedTags } = checkBlacklistedTags(tags)
    if (hasBlacklisted) {
      return c.json({ error: `The following tags are prohibited: ${blockedTags.join(', ')}. Please choose different tags.` }, 400)
    }
    // Single normalization source of truth shared with the web client.
    cleanTags = normalizeTags(tags)
  }

  const updates: string[] = []
  const values: any[] = []
  if (cleanName !== undefined) {
    updates.push('display_name = ?')
    values.push(cleanName)
  }
  if (tags !== undefined) {
    updates.push('tags = ?')
    values.push(JSON.stringify(cleanTags ?? []))
  }
  if (pfp_url !== undefined) {
    updates.push('pfp_url = ?')
    values.push(pfp_url)
  }
  if (cleanBio !== undefined) {
    updates.push('bio = ?')
    values.push(cleanBio)
  }
  if (cleanWebsite !== undefined) {
    updates.push('website = ?')
    values.push(cleanWebsite)
  }

  // Always touch last_seen so the user is immediately active and online
  const nowIso = new Date().toISOString()
  updates.push('last_seen = ?')
  values.push(nowIso)

  await c.env.DB.prepare('INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)').bind(orbitId).run()

  if (updates.length > 0) {
    values.push(orbitId)
    await c.env.DB.prepare(`UPDATE Users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

    const push: any = { type: 'PROFILE', user: { id: orbitId } }
    if (cleanName !== undefined) push.user.display_name = cleanName
    if (tags !== undefined) push.user.tags = cleanTags ?? []
    if (pfp_url !== undefined) push.user.pfp_url = pfp_url
    broadcastToRoom('global', push)
    broadcastToRoom('lobby', { type: 'lobby', action: 'profile_updated', user: push.user })
  }

  const saved = await c.env.DB.prepare(
    'SELECT id, display_name, tags, pfp_url, bio, website, followers_count, following_count, posts_count, is_private FROM Users WHERE id = ?'
  ).bind(orbitId).first<any>()
  let savedTags: string[] = []
  try { savedTags = saved?.tags ? JSON.parse(saved.tags) : [] } catch {}
  return c.json({
    id: orbitId,
    display_name: saved?.display_name || null,
    tags: savedTags,
    pfp_url: saved?.pfp_url || null,
    bio: saved?.bio || '',
    website: saved?.website || '',
    followers_count: Number(saved?.followers_count || 0),
    following_count: Number(saved?.following_count || 0),
    posts_count: Number(saved?.posts_count || 0),
    is_private: Boolean(saved?.is_private),
  })
})

// ─── Instagram-style asymmetric follows (Followers table) ───

async function bumpFollowCounts(db: D1Turso, followerId: string, followeeId: string, delta: number) {
  if (delta > 0) {
    await db.prepare('UPDATE Users SET followers_count = COALESCE(followers_count, 0) + 1 WHERE id = ?').bind(followeeId).run().catch(() => {})
    await db.prepare('UPDATE Users SET following_count = COALESCE(following_count, 0) + 1 WHERE id = ?').bind(followerId).run().catch(() => {})
  } else {
    await db.prepare('UPDATE Users SET followers_count = MAX(COALESCE(followers_count, 0) - 1, 0) WHERE id = ?').bind(followeeId).run().catch(() => {})
    await db.prepare('UPDATE Users SET following_count = MAX(COALESCE(following_count, 0) - 1, 0) WHERE id = ?').bind(followerId).run().catch(() => {})
  }
}

users.post('/:id/follow', async (c) => {
  const db = c.env.DB
  const followerId = c.get('orbitId')
  const followeeId = c.req.param('id')

  if (followeeId === followerId) return c.json({ error: 'Cannot follow yourself' }, 400)
  const target = await db.prepare('SELECT id FROM Users WHERE id = ?').bind(followeeId).first()
  if (!target) return c.json({ error: 'User not found' }, 404)

  const res = await db.prepare('INSERT OR IGNORE INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)').bind(followerId, followeeId).run()
  if (Number(res.meta?.changes || 0) > 0) {
    await bumpFollowCounts(db, followerId, followeeId, 1)
    broadcastToRoom('global', { type: 'follow', action: 'new', follower_id: followerId, followee_id: followeeId })

    try {
      const follower = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(followerId).first<{ display_name: string | null }>()
      const name = follower?.display_name?.trim() || 'Someone'
      const { createNotification } = await import('../notifications')
      const { broadcastToUser } = await import('../ws-bus')
      const notif = await createNotification(db, followeeId, 'follow', `${name} started following you`, null, { follower_id: followerId })
      if (notif) broadcastToUser(followeeId, { type: 'notification', action: 'new', notification: notif })
    } catch {}
  }
  return c.json({ following: true })
})

users.delete('/:id/follow', async (c) => {
  const db = c.env.DB
  const followerId = c.get('orbitId')
  const followeeId = c.req.param('id')

  const res = await db.prepare('DELETE FROM Followers WHERE follower_id = ? AND followee_id = ?').bind(followerId, followeeId).run()
  if (Number(res.meta?.changes || 0) > 0) {
    await bumpFollowCounts(db, followerId, followeeId, -1)
  }
  return c.json({ following: false })
})

users.get('/:id/followers', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')

  const rows = await db.prepare(`
    SELECT f.follower_id as id, u.display_name, u.pfp_url, u.last_seen,
           (SELECT COUNT(*) FROM Followers x WHERE x.follower_id = ? AND x.followee_id = f.follower_id AND x.accepted = 1) as is_following
    FROM Followers f
    LEFT JOIN Users u ON u.id = f.follower_id
    WHERE f.followee_id = ? AND f.accepted = 1
    ORDER BY f.created_at DESC
  `).bind(orbitId, userId).all<any>()

  return c.json((rows.results || []).map((r: any) => ({
    id: r.id,
    display_name: r.display_name || null,
    pfp_url: r.pfp_url || null,
    online: r.last_seen ? (Date.now() - new Date(r.last_seen).getTime() < 5 * 60 * 1000) : false,
    is_following: Number(r.is_following || 0) > 0,
  })))
})

users.get('/:id/following', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')

  const rows = await db.prepare(`
    SELECT f.followee_id as id, u.display_name, u.pfp_url, u.last_seen,
           (SELECT COUNT(*) FROM Followers x WHERE x.follower_id = ? AND x.followee_id = f.followee_id AND x.accepted = 1) as is_following
    FROM Followers f
    LEFT JOIN Users u ON u.id = f.followee_id
    WHERE f.follower_id = ? AND f.accepted = 1
    ORDER BY f.created_at DESC
  `).bind(orbitId, userId).all<any>()

  return c.json((rows.results || []).map((r: any) => ({
    id: r.id,
    display_name: r.display_name || null,
    pfp_url: r.pfp_url || null,
    online: r.last_seen ? (Date.now() - new Date(r.last_seen).getTime() < 5 * 60 * 1000) : false,
    is_following: Number(r.is_following || 0) > 0,
  })))
})

/** Cascading-account deletion shared by the self-service DELETE /account and
 * the admin moderation flow. Purges every row the account ever touched —
 * content first (shared with wipeUserContent), then the remaining
 * user-scoped rows, then the account itself. Safety records (bans, report
 * history) are retained but anonymized. Returns peers needing recompute. */
export async function deleteUserCascade(
  db: D1Turso,
  userId: string,
  opts: { BUCKET?: LocalBlobStore }
): Promise<string[]> {
  // Objects/likes/PMs/chats/cards/decks/groups/notifications (bucket blobs too).
  const affectedUsers = await wipeUserContent(db, userId, opts)

  const stmts: Array<{ run: () => Promise<any> }> = []
  const del = (sql: string, ...args: unknown[]) => {
    stmts.push(db.prepare(sql).bind(...args as never[]))
  }
  del('DELETE FROM Followers WHERE follower_id = ? OR followee_id = ?', userId, userId)
  del('DELETE FROM UserBlocks WHERE blocker_id = ? OR blocked_id = ?', userId, userId)
  del('DELETE FROM ChatGroupMembers WHERE user_id = ?', userId)
  del('DELETE FROM Recommendations WHERE user_id = ?', userId)
  del('DELETE FROM MatchPairs WHERE user_a = ? OR user_b = ?', userId, userId)
  del('DELETE FROM TierMatches WHERE user_a = ? OR user_b = ?', userId, userId)
  del('DELETE FROM GameMatches WHERE user_a = ? OR user_b = ?', userId, userId)
  del('DELETE FROM MatchArchive WHERE user_a = ? OR user_b = ?', userId, userId)
  del('DELETE FROM MatchCards WHERE owner_id = ?', userId)
  del('DELETE FROM MatchRoomPlayers WHERE user_id = ?', userId)
  del('DELETE FROM MatchRooms WHERE owner_id = ?', userId)
  del('DELETE FROM LeagueRank WHERE user_id = ?', userId)
  del('DELETE FROM Playtime WHERE user_id = ?', userId)
  del('DELETE FROM StoreUnlocks WHERE user_id = ?', userId)
  del('DELETE FROM UserInventory WHERE user_id = ?', userId)
  del('DELETE FROM Wallets WHERE user_id = ?', userId)
  del('DELETE FROM LedgerTransactions WHERE user_id = ?', userId)
  del('DELETE FROM EconomicOperations WHERE user_id = ?', userId)
  del('DELETE FROM CardOwnership WHERE owner_id = ?', userId)
  del('DELETE FROM Comments WHERE author_id = ?', userId)
  del('DELETE FROM CommentLikes WHERE user_id = ?', userId)
  del('DELETE FROM Saves WHERE user_id = ?', userId)
  del('DELETE FROM DominationActions WHERE dominator_id = ? OR victim_id = ?', userId, userId)
  del('DELETE FROM BabecockEntries WHERE user_id = ?', userId)
  del('DELETE FROM BabecockInvites WHERE host_id = ? OR invitee_id = ?', userId, userId)
  del('DELETE FROM BabecockRounds WHERE host_id = ?', userId)
  del('DELETE FROM ModerationPatrolRewards WHERE user_id = ?', userId)
  del('DELETE FROM SessionEvents WHERE user_id = ?', userId)
  del('DELETE FROM ServerDirectory WHERE owner_id = ?', userId)
  del('DELETE FROM Devices WHERE user_id = ?', userId)
  del('DELETE FROM Sessions WHERE user_id = ?', userId)
  // Safety records stay (zero-tolerance enforcement outlives the account) but
  // lose their link to this identity — the orbit id no longer resolves.
  del(`UPDATE UserReports SET reporter_id = 'deleted' WHERE reporter_id = ?`, userId)
  del(`UPDATE UserReports SET reported_id = 'deleted' WHERE reported_id = ?`, userId)
  del(`UPDATE ContentReports SET reporter_id = 'deleted' WHERE reporter_id = ?`, userId)
  del(`UPDATE ReportedImages SET reporter_id = 'deleted' WHERE reporter_id = ?`, userId)
  del('DELETE FROM Users WHERE id = ?', userId)

  await db.batch(stmts)

  return affectedUsers.filter(uid => uid !== userId)
}

/**
 * Wipe ALL of a user's content while KEEPING the account row (used by the
 * "ban + wipe" admin action and the report-ban triage). Deletes every Object
 * the user owns (cards media, stories, lobby images), all likes/favorites/
 * recipient grants to and from the user, private messages, match + lobby + group
 * chat, their minted Cards (ownership/history/deck/listings), owned chat groups,
 * notifications and invites, then resets the user's counters and score. The
 * user stays registered so their ban record and identity remain intact.
 */
export async function wipeUserContent(
  db: D1Turso,
  userId: string,
  opts: { BUCKET?: LocalBlobStore }
): Promise<string[]> {
  const owned = await db.prepare('SELECT id FROM Objects WHERE owner_id = ?').bind(userId).all()
  const objectIds = (owned.results as any[]).map(o => o.id)

  const userImages = await db.prepare('SELECT id FROM LobbyImages WHERE owner_id = ?').bind(userId).all()
  const imageIds = (userImages.results as any[]).map(i => i.id)

  const userCards = await db.prepare('SELECT id FROM Cards WHERE creator_id = ?').bind(userId).all()
  const cardIds = (userCards.results as any[]).map(c => c.id)

  const userDecks = await db.prepare('SELECT id FROM Decks WHERE owner_id = ?').bind(userId).all()
  const deckIds = (userDecks.results as any[]).map(d => d.id)

  const userGroups = await db.prepare('SELECT id FROM ChatGroups WHERE owner_id = ?').bind(userId).all()
  const groupIds = (userGroups.results as any[]).map(g => g.id)

  // Users who liked the wiped account's objects need their counters recomputed
  let affectedUsers: string[] = []
  if (objectIds.length > 0) {
    const likers = await db.prepare(
      `SELECT DISTINCT user_id FROM Likes WHERE object_id IN (${objectIds.map(() => '?').join(',')})`
    ).bind(...objectIds).all<{ user_id: string }>()
    affectedUsers = likers.results.map(r => r.user_id).filter(Boolean)
  }

  if (opts.BUCKET) {
    const deletePromises = [
      ...objectIds.map((id: string) => opts.BUCKET!.delete(`objects/${id}`).catch(() => {})),
      ...imageIds.map((id: string) => opts.BUCKET!.delete(`lobby/${id}`).catch(() => {})),
    ]
    await Promise.all(deletePromises)
  }

  const stmts: Array<{ run: () => Promise<any> }> = []
  stmts.push(db.prepare('DELETE FROM Recipients WHERE recipient_id = ?').bind(userId))
  if (objectIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM Recipients WHERE object_id IN (${objectIds.map(() => '?').join(',')})`).bind(...objectIds))
  }
  stmts.push(db.prepare('DELETE FROM Favorites WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM Likes WHERE user_id = ?').bind(userId))
  if (objectIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM Likes WHERE object_id IN (${objectIds.map(() => '?').join(',')})`).bind(...objectIds))
  }
  stmts.push(db.prepare('DELETE FROM FriendRequests WHERE sender_id = ? OR receiver_id = ?').bind(userId, userId))
  stmts.push(db.prepare('DELETE FROM Friends WHERE user_id = ? OR friend_id = ?').bind(userId, userId))
  stmts.push(db.prepare('DELETE FROM Devices WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM Sessions WHERE user_id = ?').bind(userId))
  if (objectIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM Objects WHERE id IN (${objectIds.map(() => '?').join(',')})`).bind(...objectIds))
  }
  stmts.push(db.prepare('DELETE FROM LobbyImages WHERE owner_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM LobbyLikes WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM LobbyComments WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM LobbyChat WHERE sender_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM PrivateMessages WHERE sender_id = ? OR recipient_id = ?').bind(userId, userId))
  stmts.push(db.prepare('DELETE FROM MatchChat WHERE sender_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM GroupMessages WHERE sender_id = ?').bind(userId))
  if (cardIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM CardOwnership WHERE card_id IN (${cardIds.map(() => '?').join(',')})`).bind(...cardIds))
    stmts.push(db.prepare(`DELETE FROM CardHistory WHERE card_id IN (${cardIds.map(() => '?').join(',')})`).bind(...cardIds))
    stmts.push(db.prepare(`DELETE FROM DeckCards WHERE card_id IN (${cardIds.map(() => '?').join(',')})`).bind(...cardIds))
    stmts.push(db.prepare(`DELETE FROM MarketListings WHERE card_id IN (${cardIds.map(() => '?').join(',')}) OR seller_id = ?`).bind(...cardIds, userId))
    stmts.push(db.prepare(`DELETE FROM Cards WHERE id IN (${cardIds.map(() => '?').join(',')})`).bind(...cardIds))
  } else {
    stmts.push(db.prepare('DELETE FROM MarketListings WHERE seller_id = ?').bind(userId))
  }
  if (deckIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM DeckCards WHERE deck_id IN (${deckIds.map(() => '?').join(',')})`).bind(...deckIds))
  }
  stmts.push(db.prepare('DELETE FROM Decks WHERE owner_id = ?').bind(userId))
  if (groupIds.length > 0) {
    stmts.push(db.prepare(`DELETE FROM ChatGroupMembers WHERE group_id IN (${groupIds.map(() => '?').join(',')})`).bind(...groupIds))
  }
  stmts.push(db.prepare('DELETE FROM ChatGroups WHERE owner_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM Notifications WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare('DELETE FROM MatchInvites WHERE inviter_id = ? OR invitee_id = ?').bind(userId, userId))
  stmts.push(db.prepare('DELETE FROM LobbyPlayers WHERE user_id = ?').bind(userId))
  stmts.push(db.prepare(
    `UPDATE Users SET objects_sent_count = 0, gacha_items_collected = 0, maximum_gooner = 0,
       likes_given = 0, likes_received = 0, matches_total = 0, score = 0, score_total = 0, pfp_url = NULL
     WHERE id = ?`
  ).bind(userId))

  await db.batch(stmts)

  return affectedUsers.filter(uid => uid !== userId)
}

users.delete('/account', async (c) => {
  const orbitId = c.get('orbitId')

  const affectedUsers = await deleteUserCascade(c.env.DB, orbitId, { BUCKET: c.env.BUCKET })

  // Recompute counters for users whose matches/likes referenced the deleted account
  for (const userId of affectedUsers) {
    await recomputeUserCounters(c.env.DB, userId)
  }

  return c.json({ ok: true })
})

users.post('/maximum-gooner', async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json()
  const enabled = body?.enabled === true ? 1 : 0
  try {
    await c.env.DB.prepare('UPDATE Users SET maximum_gooner = ? WHERE id = ?').bind(enabled, orbitId).run()
  } catch {}
  return c.json({ ok: true, maximum_gooner: enabled === 1 })
})

users.post('/:id/block', async (c) => {
  const blockerId = c.get('orbitId')
  const blockedId = c.req.param('id')
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO UserBlocks (blocker_id, blocked_id) VALUES (?, ?)').bind(blockerId, blockedId).run()
  } catch {}
  return c.json({ ok: true, blocked: blockedId })
})

users.post('/:id/report', async (c) => {
  const reporterId = c.get('orbitId')
  const reportedId = c.req.param('id')
  if (!reportedId || reportedId === reporterId) {
    return c.json({ error: 'Cannot report yourself' }, 400)
  }

  let reason = 'User reported'
  let category: string | null = null
  let objectId: string | null = null
  try {
    const body = await c.req.json()
    if (body?.reason) reason = String(body.reason).substring(0, 200)
    if (body?.category) category = String(body.category).substring(0, 50)
    if (body?.object_id) objectId = String(body.object_id).substring(0, 64)
  } catch {}

  // Reporting instantly hides the target user's profile + all their content
  // until an admin resolves the report.
  try {
    const result = await reportContent(c.env.DB, reporterId, 'user', reportedId, category, reason, objectId)
    return c.json({ ok: true, reported: reportedId, hidden: result.hidden }, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})

// Purchase a store item with the user's live score. Deducts points and records
// Active in-memory hack debuffs with expiration
interface ServerHackDebuff {
  id: string
  type: 'deny' | 'mobile_virus'
  attacker_id: string
  attacker_name: string
  target_id: string
  target_name: string
  created_at: number
  expires_at: number
}

const activeServerHacks: ServerHackDebuff[] = []

function pruneExpiredHacks() {
  const now = Date.now()
  for (let i = activeServerHacks.length - 1; i >= 0; i--) {
    if (activeServerHacks[i].expires_at <= now) {
      activeServerHacks.splice(i, 1)
    }
  }
}

async function getDynamicItemPrices(db: any): Promise<Record<string, number>> {
  try {
    const row = await db.prepare("SELECT value FROM SystemMeta WHERE key = 'store_prices'").bind().first() as { value: string } | null
    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch {}
  return {}
}

// Get all store items with single-source-of-truth prices applied from SystemMeta.
// Pack/lootbox items are NOT taken from the static list — they come from the
// admin-managed Lootboxes table, filtered to released rows only.
users.get('/store/items', async (c) => {
  const overrides = await getDynamicItemPrices(c.env.DB)
  const nonPack = STORE_ITEMS
    .filter((it) => it.category !== 'pack')
    .map((it) => ({
      ...it,
      cost: typeof overrides[it.id] === 'number' ? overrides[it.id] : it.cost,
    }))
  const rows = await c.env.DB
    .prepare('SELECT id, name, desc, cost, icon, badge, tags FROM Lootboxes WHERE released = 1 ORDER BY created_at ASC')
    .all<{ id: string; name: string; desc: string | null; cost: number; icon: string | null; badge: string | null; tags: string | null }>()
  const packs = (rows.results || []).map((lb) => ({
    id: lb.id,
    name: lb.name,
    desc: lb.desc || '',
    category: 'pack' as const,
    cost: Number(lb.cost || 0),
    icon: lb.icon || 'Sparkles',
    badge: lb.badge || undefined,
    tags: parseLootboxTags(lb.tags),
    consumable: true,
  }))
  return c.json({ items: [...nonPack, ...packs] })
})

// Purchase a store item with g$ from the authoritative economy wallet. The
// debit and the item effect (inventory/unlock) run in one atomic batch; hacks
// apply an in-memory effect after the debit commits. Idempotent via
// Idempotency-Key so a retry cannot double-charge or double-grant.
users.post('/store/purchase', async (c) => {
  const orbitId = c.get('orbitId')

  let itemId = ''
  let targetId = ''
  let idemKey = ''
  try {
    const body = await c.req.json()
    itemId = String(body?.item_id || '').trim()
    targetId = String(body?.target_id || '').trim()
    idemKey = String(body?.idempotency_key || '').trim()
  } catch {}
  if (!idemKey) idemKey = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || ''

  let baseItem: any = STORE_ITEMS.find((i) => i.id === itemId)
  if (!baseItem) {
    const lb = await c.env.DB
      .prepare('SELECT id, name, desc, cost, icon, badge FROM Lootboxes WHERE id = ? AND released = 1')
      .bind(itemId)
      .first<{ id: string; name: string; desc: string | null; cost: number; icon: string | null; badge: string | null }>()
    if (lb) {
      baseItem = {
        id: lb.id,
        name: lb.name,
        desc: lb.desc || '',
        category: 'pack',
        cost: Number(lb.cost || 0),
        icon: lb.icon || 'Sparkles',
        badge: lb.badge || undefined,
        consumable: true,
      }
    }
  }
  if (!baseItem) return c.json({ error: 'Unknown store item' }, 400)
  if (idemKey.length < 8 || idemKey.length > 128) {
    return c.json({ error: 'Idempotency-Key header required (8-128 chars)' }, 400)
  }

  const overrides = await getDynamicItemPrices(c.env.DB)
  const cost = typeof overrides[baseItem.id] === 'number' ? overrides[baseItem.id] : baseItem.cost

  const db = c.env.DB
  const economy = new EconomyService(db)
  const nowIso = new Date().toISOString()
  const operationId = crypto.randomUUID()
  const ledgerId = crypto.randomUUID()
  const fingerprint = `purchase|${orbitId}|${itemId}|${cost}`

  // Idempotent replay: return the recorded purchase without re-charging or
  // re-granting, and refuse keys reused with different parameters.
  const existing = await db
    .prepare('SELECT user_id, fingerprint, result FROM EconomicOperations WHERE idempotency_key = ?')
    .bind(idemKey)
    .first<{ user_id: string; fingerprint: string | null; result: string | null }>()
  if (existing) {
    if (existing.user_id !== orbitId || (existing.fingerprint && existing.fingerprint !== fingerprint)) {
      return c.json({ error: 'Idempotency key reused with different parameters' }, 409)
    }
    const balance = await economy.getBalance(orbitId)
    return c.json({ ok: true, item_id: baseItem.id, cost, score: balance, balance, replayed: true })
  }

  // Build the item effect. DB-backed effects (inventory/unlock) attach to the
  // debit batch atomically; hacks register an in-memory debuff after commit.
  let extra: AtomicStatement[] = []
  let debitGate: { clause: string; args: any[] } | undefined
  let effect: (() => void) | null = null

if (baseItem.id === 'item-flash-drop') {
    // Flash Drop is a broadcast, not a targeted debuff: buying it grants an
    // inventory charge that /api/flash consumes when firing to everyone online.
    extra = [
      {
        sql: 'INSERT INTO UserInventory (user_id, item_id, quantity, updated_at) SELECT ?, ?, 1, ? WHERE changes() = 1 ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1, updated_at = excluded.updated_at',
        args: [orbitId, baseItem.id, nowIso],
      },
    ]
  } else if (baseItem.category === 'hack') {
    if (!targetId) return c.json({ error: 'Target player required for hacking service' }, 400)

    // Hacks can only be deployed against players online right now (strict 60s
    // last_seen window, matching the roster + duel-invite gate) who explicitly
    // opted in to hack payloads (allowHacks, default off).
    const onlineCutoff = new Date(Date.now() - 60_000).toISOString()
    const target = await db.prepare("SELECT display_name, pc_domination_settings FROM Users WHERE id = ? AND last_seen IS NOT NULL AND datetime(last_seen) >= datetime(?)").bind(targetId, onlineCutoff).first<{ display_name: string | null; pc_domination_settings: string | null }>()
    if (!target) return c.json({ error: 'That player is not online right now' }, 409)
    let targetConsent: Record<string, unknown> = {}
    try { targetConsent = JSON.parse(target.pc_domination_settings || '{}') } catch { /* deny */ }
    if (targetConsent.allowHacks !== true) {
      return c.json({ error: 'That player has not allowed hacks on their account' }, 403)
    }
    const me = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
    const targetName = target?.display_name?.trim() || 'Unknown User'
    const attackerName = me?.display_name?.trim() || 'Unknown User'

    let durationMs = 5 * 60 * 1000
    let hackType: 'deny' | 'mobile_virus' = 'deny'

    if (baseItem.id === 'item-hack-deny') {
      hackType = 'deny'
      durationMs = 5 * 60 * 1000
    } else if (baseItem.id === 'item-hack-mobile') {
      hackType = 'mobile_virus'
      durationMs = 60 * 1000
    }

    const now = Date.now()
    const debuff: ServerHackDebuff = {
      id: `hack_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type: hackType,
      attacker_id: orbitId,
      attacker_name: attackerName,
      target_id: targetId,
      target_name: targetName,
      created_at: now,
      expires_at: now + durationMs,
    }
    effect = () => {
      pruneExpiredHacks()
      activeServerHacks.push(debuff)
    }
  } else if (baseItem.consumable) {
    extra = [
      {
        sql: 'INSERT INTO UserInventory (user_id, item_id, quantity, updated_at) SELECT ?, ?, 1, ? WHERE changes() = 1 ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1, updated_at = excluded.updated_at',
        args: [orbitId, baseItem.id, nowIso],
      },
    ]
  } else {
    const alreadyOwned = await db.prepare('SELECT 1 FROM StoreUnlocks WHERE user_id = ? AND item_id = ?').bind(orbitId, baseItem.id).first()
    if (alreadyOwned) return c.json({ error: 'Already owned' }, 409)
    debitGate = {
      clause: 'AND NOT EXISTS (SELECT 1 FROM StoreUnlocks WHERE user_id = ? AND item_id = ?)',
      args: [orbitId, baseItem.id],
    }
    extra = [
      { sql: 'INSERT INTO StoreUnlocks (user_id, item_id) SELECT ?, ? WHERE changes() = 1', args: [orbitId, baseItem.id] },
    ]
  }

  const result: BalanceOpResult = { operationId, ledgerId, userId: orbitId, delta: -cost, balance: 0 }
  const { statements, balanceIndex } = buildDebitStatements({
    userId: orbitId,
    amount: cost,
    kind: 'purchase',
    reference: baseItem.id,
    operationId,
    ledgerId,
    idempotencyKey: idemKey,
    fingerprint,
    payload: { itemId: baseItem.id, targetId: targetId || null },
    result,
    nowIso,
    debitGate,
    extra,
  })

  let res
  try {
    res = await db.atomicBatch(statements)
  } catch (err: any) {
    if (err?.code?.includes('CONSTRAINT')) {
      const balance = await economy.getBalance(orbitId)
      return c.json({ ok: true, item_id: baseItem.id, cost, score: balance, balance, replayed: true })
    }
    console.warn('[users] Store purchase failed:', err)
    return c.json({ error: 'Purchase failed, try again' }, 500)
  }

  if ((res[balanceIndex].rows?.length ?? 0) === 0) {
    return c.json({ error: 'Not enough points' }, 409)
  }

  const balance = (res[balanceIndex].rows[0]?.balance as number) ?? 0
  if (effect) effect()

  return c.json({ ok: true, item_id: baseItem.id, cost, score: balance, balance })
})

// Query active hack debuffs affecting the current user or launched by current user
users.get('/hacks/active', async (c) => {
  const orbitId = c.get('orbitId')
  pruneExpiredHacks()
  const myDebuffs = activeServerHacks.filter((h) => h.target_id === orbitId || h.attacker_id === orbitId)
  return c.json({ active_hacks: myDebuffs })
})

/**
 * Spy feed: the payoff for a purchased hack. Only the ATTACKER of a still-
 * active hack session may read the target's recent public posts and profile
 * blurb — the server enforces the gate (client-side views are cosmetic).
 */
users.get('/hacks/spy-feed/:targetId', async (c) => {
  const orbitId = c.get('orbitId')
  const targetId = c.req.param('targetId') || ''
  pruneExpiredHacks()
  const now = Date.now()
  const session = activeServerHacks.find(
    (h) => h.attacker_id === orbitId && h.target_id === targetId && h.expires_at > now,
  )
  if (!session) return c.json({ error: 'No active hack session on that target' }, 403)

  const db = c.env.DB
  const target = await db.prepare('SELECT display_name, bio FROM Users WHERE id = ?')
    .bind(targetId).first<{ display_name: string | null; bio: string | null }>().catch(() => null)
  const posts = await db.prepare(`
    SELECT id, COALESCE(post_caption, caption) as caption, like_count, created_at
    FROM Objects
    WHERE owner_id = ? AND is_public = 1 AND hidden_at IS NULL AND post_group IS NULL
    ORDER BY created_at DESC LIMIT 8
  `).bind(targetId).all<{ id: string; caption: string | null; like_count: number; created_at: string }>().catch(() => ({ results: [] as any[] }))
  const pmPeeks = await db.prepare(`
    SELECT body, created_at FROM PrivateMessages
    WHERE (sender_id = ? OR recipient_id = ?) AND hidden_at IS NULL
    ORDER BY created_at DESC LIMIT 5
  `).bind(targetId, targetId).all<{ body: string; created_at: string }>().catch(() => ({ results: [] as any[] }))

  return c.json({
    hack: { type: session.type, expires_at: session.expires_at },
    target: {
      id: targetId,
      display_name: target?.display_name || 'Unknown User',
      bio: target?.bio || '',
    },
    posts: (posts.results || []).map((r) => ({
      id: r.id, caption: r.caption || '', likes: Number(r.like_count || 0), created_at: r.created_at,
    })),
    intercepted: (pmPeeks.results || []).map((r) => ({
      body: String(r.body || '').slice(0, 140), created_at: r.created_at,
    })),
  })
})
// The set of store items this user has already unlocked (used to restore the
// "UNLOCKED" state across sessions and devices).
users.get('/store/unlocks', async (c) => {
  const orbitId = c.get('orbitId')
  const rows = await c.env.DB.prepare('SELECT item_id FROM StoreUnlocks WHERE user_id = ?').bind(orbitId).all<{ item_id: string }>()
  return c.json((rows.results || []).map((r) => r.item_id))
})

// Owned consumables (e.g. Flash Drop) with stack counts, so the web client can
// restore the Inventory tab across sessions and devices.
users.get('/store/inventory', async (c) => {
  const orbitId = c.get('orbitId')
  const rows = await c.env.DB.prepare('SELECT item_id, quantity FROM UserInventory WHERE user_id = ? AND quantity > 0').bind(orbitId).all<{ item_id: string; quantity: number }>()
  return c.json((rows.results || []).map((r) => ({ item_id: r.item_id, quantity: Number(r.quantity || 0) })))
})

const PACK_THEMES = [
  { title: 'Cyber Valkyrie', col1: '#ec4899', col2: '#8b5cf6', rarity: 'EPIC', score: 150 },
  { title: 'Neon Phantom', col1: '#06b6d4', col2: '#3b82f6', rarity: 'RARE', score: 80 },
  { title: 'Solar Empress', col1: '#f59e0b', col2: '#ef4444', rarity: 'LEGENDARY', score: 300 },
  { title: 'Astral Nomad', col1: '#10b981', col2: '#06b6d4', rarity: 'COMMON', score: 20 },
  { title: 'Void Weaver', col1: '#8b5cf6', col2: '#1e1b4b', rarity: 'MYTHIC', score: 500 },
  { title: 'Prism Blossom', col1: '#f43f5e', col2: '#fb7185', rarity: 'RARE', score: 90 },
  { title: 'Quantum Overlord', col1: '#6366f1', col2: '#a855f7', rarity: 'LEGENDARY', score: 350 },
]

type PackTheme = (typeof PACK_THEMES)[number]

function themesForRarityTheme(rarityTheme: string): PackTheme[] {
  const labels: Record<string, string[]> = {
    common: ['COMMON', 'RARE'],
    rare: ['RARE', 'EPIC'],
    legendary: ['LEGENDARY', 'MYTHIC'],
    mythic: ['MYTHIC', 'LEGENDARY'],
  }
  const wanted = labels[rarityTheme]
  if (!wanted) return PACK_THEMES
  const filtered = PACK_THEMES.filter((t) => wanted.includes(t.rarity))
  return filtered.length > 0 ? filtered : PACK_THEMES
}

function pickPackTheme(rarityTheme: string, drawConfig: Record<string, unknown>): PackTheme {
  // Optional draw_config.rarity_weights (e.g. { EPIC: 30, RARE: 70 }) takes
  // precedence; otherwise the box's rarity_theme filters the pool.
  const weights = (drawConfig && typeof drawConfig.rarity_weights === 'object' ? drawConfig.rarity_weights : {}) as Record<string, unknown>
  const pool = PACK_THEMES.map((theme) => {
    const w = Number(weights[theme.rarity])
    return { theme, weight: Number.isFinite(w) && w >= 0 ? w : 0 }
  })
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  if (total > 0) {
    let roll = Math.random() * total
    for (const p of pool) {
      roll -= p.weight
      if (roll < 0) return p.theme
    }
    return pool[pool.length - 1].theme
  }
  const filtered = themesForRarityTheme(rarityTheme)
  return filtered[Math.floor(Math.random() * filtered.length)]
}

users.post('/store/open-pack', async (c) => {
  const orbitId = c.get('orbitId')
  const db = c.env.DB
  let itemId = ''
  let idemKey = ''
  try {
    const body = await c.req.json()
    itemId = String(body?.item_id || body?.itemId || '').trim()
    idemKey = String(body?.idempotency_key || '').trim()
  } catch {}
  if (!idemKey) idemKey = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || ''

  // Packs open against the admin-managed Lootboxes table — only released boxes
  // can be opened, and the minted card count comes from the box definition.
  const pack = await db
    .prepare('SELECT id, card_count, rarity_theme, draw_config FROM Lootboxes WHERE id = ? AND released = 1')
    .bind(itemId)
    .first<{ id: string; card_count: number; rarity_theme: string | null; draw_config: string | null }>()
  if (!pack) return c.json({ error: 'Invalid pack item' }, 400)
  if (idemKey.length < 8 || idemKey.length > 128) {
    return c.json({ error: 'Idempotency-Key header required (8-128 chars)' }, 400)
  }

  const fingerprint = `open_pack|${orbitId}|${itemId}`

  // Idempotent replay: return the previously minted cards without consuming
  // another pack, and refuse keys reused with different parameters.
  const existing = await db
    .prepare('SELECT user_id, fingerprint, result FROM EconomicOperations WHERE idempotency_key = ?')
    .bind(idemKey)
    .first<{ user_id: string; fingerprint: string | null; result: string | null }>()
  if (existing) {
    if (existing.user_id !== orbitId || (existing.fingerprint && existing.fingerprint !== fingerprint)) {
      return c.json({ error: 'Idempotency key reused with different parameters' }, 409)
    }
    if (existing.result) return c.json(JSON.parse(existing.result))
    return c.json({ error: 'Operation already in progress' }, 409)
  }

  const cardCount = Math.max(1, Math.min(20, Number(pack.card_count || 3)))
  const nowIso = new Date().toISOString()
  const drawConfig = normalizeDrawConfig(pack.draw_config)
  const rarityTheme = pack.rarity_theme || 'rare'

  // Build the atomic batch: inventory decrement is the gate; the minted cards
  // and the idempotency record only apply when the decrement succeeds.
  const openedCards: Array<{ id: string; title: string; rarity: string; score: number; content_url: string }> = []
  const statements: AtomicStatement[] = [
    { sql: 'UPDATE UserInventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ? AND quantity > 0 RETURNING quantity', args: [orbitId, itemId] },
  ]

  for (let i = 0; i < cardCount; i++) {
    const theme = pickPackTheme(rarityTheme, drawConfig)
    const cardId = crypto.randomUUID()
    const objectId = crypto.randomUUID()
    const canonicalRarity = computeCardRarity(theme.score).rarity
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">
<defs>
  <linearGradient id="g${i}" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${theme.col1}"/>
    <stop offset="100%" stop-color="${theme.col2}"/>
  </linearGradient>
</defs>
<rect width="400" height="560" rx="24" fill="#09090b"/>
<rect x="12" y="12" width="376" height="536" rx="16" fill="url(#g${i})" fill-opacity="0.18" stroke="url(#g${i})" stroke-width="2.5"/>
<circle cx="200" cy="230" r="95" fill="url(#g${i})" fill-opacity="0.85"/>
<text x="200" y="242" font-family="sans-serif" font-size="46" font-weight="900" fill="#ffffff" text-anchor="middle">✦</text>
<text x="200" y="400" font-family="sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${theme.title}</text>
<text x="200" y="430" font-family="sans-serif" font-size="13" font-weight="800" fill="${theme.col1}" text-anchor="middle">${theme.rarity} EDITION</text>
<text x="200" y="470" font-family="monospace" font-size="11" font-weight="600" fill="#71717a" text-anchor="middle">COLLECTOR #${cardId.slice(0, 6).toUpperCase()}</text>
</svg>`
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

    statements.push(...mintCardStatements({
      ownerId: orbitId,
      cardId,
      objectId,
      spec: { name: theme.title, rarity: canonicalRarity, contentUrl: dataUrl, mimeType: 'image/svg+xml', sizeBytes: 1024, value: theme.score },
      historyId: crypto.randomUUID(),
      nowIso,
      source: 'pack',
    }))

    openedCards.push({ id: cardId, title: theme.title, rarity: theme.rarity, score: theme.score, content_url: dataUrl })
  }

  const resultPayload = { ok: true, cards: openedCards }
  const operationId = crypto.randomUUID()
  statements.push({
    sql: 'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, payload, result) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
    args: [operationId, idemKey, orbitId, 'open_pack', fingerprint, JSON.stringify({ itemId, cardCount }), JSON.stringify(resultPayload)],
  })

  let res
  try {
    res = await db.atomicBatch(statements)
  } catch (err: any) {
    if (err?.code?.includes('CONSTRAINT')) {
      const recorded = await db.prepare('SELECT result FROM EconomicOperations WHERE idempotency_key = ?').bind(idemKey).first<{ result: string | null }>()
      if (recorded?.result) return c.json(JSON.parse(recorded.result))
    }
    throw err
  }

  if ((res[0].rows?.length ?? 0) === 0) {
    return c.json({ error: 'You do not own this pack' }, 400)
  }

  return c.json(resultPayload)
})
