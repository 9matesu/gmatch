import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { adminAuth } from '../middleware/admin'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { purgeObjectLikes } from '../game'
import { STALE_PLAYER_MS, recordLeagueRank, resolveMatch, ensureBotReady, promoteLobbyImagesToPosts, advanceLobbyWithOptions, resolveCardUrl } from '../lobby'
import { deleteUserCascade, wipeUserContent } from './users'
import { runPeriodicMaintenance } from '../cleanup'
import { broadcastToRoom } from '../ws-bus'
import { parseTags, clampCashoutRateBps, type GameMatch } from '@orbit/shared'
import { logAdminAction } from '../admin-audit'
import { decryptText } from '../crypto'
import { getBotConfig, saveBotConfig, testBotApi, refreshBotImageCache, getBotProfiles, saveBotProfile, deleteBotProfile, generateBotPicture } from '../bot-image-api'
import { validateProviderUrl } from '../bots/provider-pool'
import { listLootboxes, getLootbox, normalizeTags, normalizeDrawConfig, stateTransition, isValidState, type LootboxState } from '../lootboxes/service'
import { EconomyService } from '../economy'
import { CardService, getCashoutRateBps } from '../cards'
import { resolveReport, ReportError } from '../reports'
import crypto from 'crypto'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
  ADMIN_PIN?: string
  ADMIN_PIN_HASH?: string
}

const admin = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
const announcements = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

admin.use('*', orbitAuth)
announcements.use('*', orbitAuth)

// Verify secret admin passcode/PIN - accessible to any authenticated Orbit user
// Security plan B.4: NO hardcoded default — with neither ADMIN_PIN_HASH nor
// ADMIN_PIN configured the feature returns 503 (disabled). Prefer
// ADMIN_PIN_HASH = sha256(pin) hex (constant-time compare); plaintext
// ADMIN_PIN remains for dev/self-host convenience. Per-identity lockout:
// 5 wrong attempts in 15 min → 429.
const PIN_WINDOW_MS = 15 * 60 * 1000
const PIN_MAX_FAILS = 5
const pinFails = new Map<string, number[]>() // orbitId -> failure timestamps

export function _resetPinLockout(): void {
  pinFails.clear()
}

function sha256hexSync(text: string): string | null {
  // Bun/Node both expose node:crypto here; keep it sync to avoid an await
  // race with the lockout bookkeeping below.
  try {
    return createHash('sha256').update(text, 'utf8').digest('hex')
  } catch {
    return null
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

admin.post('/verify-pin', async (c) => {
  const orbitId = c.get('orbitId')
  let pin = ''
  try {
    const body = await c.req.json()
    if (body?.pin) pin = String(body.pin).trim()
  } catch { }

  const configuredHash = (c.env.ADMIN_PIN_HASH || '').trim().toLowerCase()
  const configuredPlain = c.env.ADMIN_PIN
  if (!configuredHash && !configuredPlain) {
    return c.json({ error: 'Admin console disabled: set ADMIN_PIN_HASH (sha256 hex of the PIN) or ADMIN_PIN' }, 503)
  }

  // lockout check (sliding window)
  const now = Date.now()
  const fails = (pinFails.get(orbitId) || []).filter((t) => now - t < PIN_WINDOW_MS)
  if (fails.length >= PIN_MAX_FAILS) {
    pinFails.set(orbitId, fails)
    return c.json({ error: 'Too many failed attempts — try again in 15 minutes' }, 429)
  }

  const presentedHash = sha256hexSync(pin)
  const okHash = configuredHash && presentedHash ? constantTimeEqual(presentedHash, configuredHash) : false
  const okPlain = configuredPlain ? constantTimeEqual(pin, configuredPlain) : false
  if (!(okHash || okPlain)) {
    fails.push(now)
    pinFails.set(orbitId, fails)
    return c.json({ error: 'Invalid secret admin passcode' }, 401)
  }
  pinFails.delete(orbitId)

  // Exactly one admin: revoke the flag everywhere, then grant it to the
  // identity that presented the passcode. Subsequent panel logins mint their
  // own identity, so 'one admin' = whoever last unlocked the console.
  await c.env.DB.prepare('UPDATE Users SET is_admin = 0').run()
  await c.env.DB.prepare('INSERT INTO Users (id, public_key, is_admin) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET is_admin = 1')
    .bind(orbitId, c.get('publicKeyHex')).run()

  return c.json({ success: true })
})

// Protect all moderation endpoints with adminAuth
admin.use('/dashboard', adminAuth)
admin.use('/content-reports', adminAuth)
admin.use('/content-reports/*', adminAuth)
admin.use('/users/*', adminAuth)
admin.use('/users', adminAuth)
admin.use('/announcements/*', adminAuth)
admin.use('/announcements', adminAuth)
admin.use('/recommendations/*', adminAuth)
admin.use('/recommendations', adminAuth)
admin.use('/live', adminAuth)
admin.use('/matches/*', adminAuth)
admin.use('/matches', adminAuth)
admin.use('/special-matches/*', adminAuth)
admin.use('/special-matches', adminAuth)
admin.use('/lobby-images/*', adminAuth)
admin.use('/lobby-images', adminAuth)
admin.use('/posts/*', adminAuth)
admin.use('/posts', adminAuth)
admin.use('/settings/*', adminAuth)
admin.use('/objects/*', adminAuth)
admin.use('/objects', adminAuth)
admin.use('/cleanup', adminAuth)
// Admin Panel v2 — new moderation surfaces (D2-D6): lobby
// comments, private messages, admin audit log, daily stats.
admin.use('/lobby-comments', adminAuth)
admin.use('/lobby-comments/*', adminAuth)
admin.use('/private-messages', adminAuth)
admin.use('/private-messages/*', adminAuth)
admin.use('/audit-log', adminAuth)
admin.use('/audit-log/*', adminAuth)
admin.use('/daily-stats', adminAuth)
admin.use('/traffic-sources', adminAuth)
admin.use('/traffic-sources/*', adminAuth)
admin.use('/bot-config', adminAuth)
admin.use('/bot-config/*', adminAuth)
admin.use('/bots', adminAuth)
admin.use('/bots/*', adminAuth)
admin.use('/cards/*', adminAuth)
admin.use('/cards', adminAuth)
admin.use('/economy/*', adminAuth)
admin.use('/decks/*', adminAuth)
admin.use('/decks', adminAuth)
admin.use('/marketplace/*', adminAuth)
admin.use('/marketplace', adminAuth)
admin.use('/rooms/*', adminAuth)
admin.use('/rooms', adminAuth)
admin.use('/babecock/*', adminAuth)
admin.use('/babecock', adminAuth)
admin.use('/chat', adminAuth)
admin.use('/chat/*', adminAuth)

// Canonical card browser for the Cards & Economy admin workspace. Card value
// and ownership remain service-owned; this endpoint is deliberately read-only.
admin.get('/cards', async (c) => {
  const url = new URL(c.req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const owner = (url.searchParams.get('owner') || '').trim()
  const state = (url.searchParams.get('moderation_state') || '').trim()
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
  const where: string[] = []
  const args: unknown[] = []
  if (q) {
    where.push('(c.id LIKE ? OR c.name LIKE ? OR u.display_name LIKE ?)')
    const like = `%${q}%`
    args.push(like, like, like)
  }
  if (owner) { where.push('co.owner_id = ?'); args.push(owner) }
  if (state) { where.push('c.moderation_state = ?'); args.push(state) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM Cards c
    LEFT JOIN CardOwnership co ON co.card_id = c.id
    LEFT JOIN Users u ON u.id = co.owner_id
    ${whereSql}
  `).bind(...args).first<{ n: number }>()
  const rows = await c.env.DB.prepare(`
    SELECT c.id, c.creator_id, c.media_object_id, c.name, c.rarity, c.value,
           c.like_count, c.market_status, c.moderation_state, c.created_at,
           c.updated_at, co.owner_id, u.display_name AS owner_name,
           o.mime_type, o.caption, o.content_url
    FROM Cards c
    LEFT JOIN CardOwnership co ON co.card_id = c.id
    LEFT JOIN Users u ON u.id = co.owner_id
    LEFT JOIN Objects o ON o.id = c.media_object_id
    ${whereSql}
    ORDER BY c.updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(...args, limit, offset).all()
  c.header('X-Total-Count', String(total?.n || 0))
  return c.json(rows.results || [])
})

admin.get('/cards/:id', async (c) => {
  const id = c.req.param('id')
  const card = await c.env.DB.prepare(`
    SELECT c.*, co.owner_id, u.display_name AS owner_name, o.mime_type,
           o.caption, o.content_url
    FROM Cards c
    LEFT JOIN CardOwnership co ON co.card_id = c.id
    LEFT JOIN Users u ON u.id = co.owner_id
    LEFT JOIN Objects o ON o.id = c.media_object_id
    WHERE c.id = ?
  `).bind(id).first<any>()
  if (!card) return c.json({ error: 'Card not found' }, 404)
  const history = await c.env.DB.prepare(`
    SELECT id, event, from_user, to_user, meta, created_at
    FROM CardHistory WHERE card_id = ? ORDER BY created_at DESC LIMIT 200
  `).bind(id).all()
  return c.json({ card, history: history.results || [] })
})

admin.patch('/cards/:id/moderation', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  let state = ''
  let reason = ''
  try {
    const body = await c.req.json()
    state = typeof body?.moderation_state === 'string' ? body.moderation_state : ''
    reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  } catch { }
  if (!['active', 'hidden', 'banned'].includes(state)) {
    return c.json({ error: 'moderation_state must be active, hidden, or banned' }, 400)
  }
  const result = await c.env.DB.prepare(
    'UPDATE Cards SET moderation_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(state, id).run()
  if (!result.success || result.meta?.changes === 0) return c.json({ error: 'Card not found' }, 404)
  await logAdminAction(c.env.DB, adminId, 'moderate_card', { id, type: 'card' }, `state=${state}${reason ? ` reason=${reason}` : ''}`)
  return c.json({ ok: true, id, moderation_state: state })
})

admin.get('/economy/wallets', async (c) => {
  const q = (c.req.query('q') || '').trim()
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 200)
  const where = q ? 'WHERE w.user_id LIKE ? OR u.display_name LIKE ?' : ''
  const args = q ? [`%${q}%`, `%${q}%`, limit] : [limit]
  const rows = await c.env.DB.prepare(`
    SELECT w.user_id, u.display_name, w.balance, w.updated_at,
           (SELECT COUNT(*) FROM LedgerTransactions l WHERE l.user_id = w.user_id) AS transaction_count
    FROM Wallets w LEFT JOIN Users u ON u.id = w.user_id ${where}
    ORDER BY w.balance DESC LIMIT ?
  `).bind(...args).all()
  return c.json(rows.results || [])
})

admin.get('/economy/ledger', async (c) => {
  const userId = (c.req.query('user_id') || '').trim()
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 500)
  const where = userId ? 'WHERE l.user_id = ?' : ''
  const args = userId ? [userId, limit] : [limit]
  const rows = await c.env.DB.prepare(`
    SELECT l.*, u.display_name FROM LedgerTransactions l
    LEFT JOIN Users u ON u.id = l.user_id ${where}
    ORDER BY l.created_at DESC LIMIT ?
  `).bind(...args).all()
  return c.json(rows.results || [])
})

admin.get('/decks', async (c) => {
  const owner = (c.req.query('owner_id') || '').trim()
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 300)
  const where = owner ? 'WHERE d.owner_id = ?' : ''
  const args = owner ? [owner, limit] : [limit]
  const rows = await c.env.DB.prepare(`
    SELECT d.id, d.owner_id, u.display_name AS owner_name, d.name, d.game_id,
           d.created_at, d.updated_at, COUNT(dc.card_id) AS card_count
    FROM Decks d LEFT JOIN Users u ON u.id = d.owner_id
    LEFT JOIN DeckCards dc ON dc.deck_id = d.id ${where}
    GROUP BY d.id ORDER BY d.updated_at DESC LIMIT ?
  `).bind(...args).all()
  return c.json(rows.results || [])
})

admin.get('/decks/:id', async (c) => {
  const id = c.req.param('id')
  const deck = await c.env.DB.prepare(`
    SELECT d.*, u.display_name AS owner_name FROM Decks d
    LEFT JOIN Users u ON u.id = d.owner_id WHERE d.id = ?
  `).bind(id).first<any>()
  if (!deck) return c.json({ error: 'Deck not found' }, 404)
  const cards = await c.env.DB.prepare(`
    SELECT dc.card_id, dc.position, c.name, c.rarity, c.value, c.moderation_state
    FROM DeckCards dc LEFT JOIN Cards c ON c.id = dc.card_id
    WHERE dc.deck_id = ? ORDER BY dc.position ASC
  `).bind(id).all()
  return c.json({ deck, cards: cards.results || [] })
})

admin.get('/marketplace', async (c) => {
  const status = (c.req.query('status') || 'open').trim()
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 300)
  const rows = await c.env.DB.prepare(`
    SELECT ml.*, c.name, c.rarity, c.value, c.moderation_state,
           u.display_name AS seller_name
    FROM MarketListings ml
    LEFT JOIN Cards c ON c.id = ml.card_id
    LEFT JOIN Users u ON u.id = ml.seller_id
    WHERE ml.status = ? ORDER BY ml.created_at DESC LIMIT ?
  `).bind(status, limit).all()
  return c.json(rows.results || [])
})

admin.get('/rooms', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT r.id, r.name, r.owner_id, u.display_name AS owner_name, r.status,
           r.phase, r.capacity, r.round_seq, r.created_at, r.updated_at,
           COUNT(rp.user_id) AS player_count
    FROM MatchRooms r LEFT JOIN Users u ON u.id = r.owner_id
    LEFT JOIN MatchRoomPlayers rp ON rp.room_id = r.id
    GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 200
  `).all()
  return c.json(rows.results || [])
})

admin.post('/rooms/:id/close', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'ended'").bind(id).run()
  if (!result.success || Number(result.meta?.changes || 0) === 0) return c.json({ error: 'Open room not found' }, 404)
  await logAdminAction(c.env.DB, adminId, 'close_room', { id, type: 'match_room' })
  return c.json({ ok: true, id })
})

admin.get('/babecock', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT r.id, r.host_id, u.display_name AS host_name, r.status,
           r.phase_deadline, r.gallery_expires_at, r.grid_size,
           r.created_at, r.updated_at, COUNT(e.id) AS entry_count
    FROM BabecockRounds r LEFT JOIN Users u ON u.id = r.host_id
    LEFT JOIN BabecockEntries e ON e.round_id = r.id
    GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 200
  `).all()
  const rounds = (rows.results || []) as any[]
  const roundIds = rounds.map((r) => r.id)
  const entries: any[] = []
  if (roundIds.length > 0) {
    const placeholders = roundIds.map(() => '?').join(',')
    const eRows = await c.env.DB.prepare(`
      SELECT e.id, e.round_id, e.user_id, e.content_url, e.mime_type, e.caption, e.grid_position,
             u.display_name AS user_name
      FROM BabecockEntries e
      LEFT JOIN Users u ON u.id = e.user_id
      WHERE e.round_id IN (${placeholders})
      ORDER BY COALESCE(e.grid_position, 2147483647) ASC, e.created_at ASC
    `).bind(...roundIds).all<any>()
    entries.push(...(eRows.results || []))
  }
  return c.json(rounds.map((r) => ({
    ...r,
    entries: entries.filter((e) => e.round_id === r.id).map((e) => ({
      id: e.id,
      user_id: e.user_id,
      user_name: e.user_name ?? null,
      content_url: e.content_url,
      mime_type: e.mime_type || 'image/jpeg',
      caption: e.caption ?? null,
      grid_position: e.grid_position ?? null,
    })),
  })))
})

admin.post('/babecock/:id/close', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare("UPDATE BabecockRounds SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").bind(id).run()
  if (!result.success || Number(result.meta?.changes || 0) === 0) return c.json({ error: 'Open Babecock round not found' }, 404)
  await logAdminAction(c.env.DB, adminId, 'close_babecock_round', { id, type: 'babecock_round' })
  return c.json({ ok: true, id })
})

// Non-canonical -> canonical migration: mint canonical Cards for existing
// self-uploaded media objects that are not yet carded. Idempotent.
admin.post('/cards/backfill', async (c) => {
  const service = new CardService(c.env.DB)
  const result = await service.backfillFromObjects()
  await logAdminAction(c.env.DB, c.get('orbitId'), 'cards.backfill', { type: 'cards' }, `created=${result.created} skipped=${result.skipped}`)
  return c.json(result)
})

// Live active lobby players & online users status
admin.get('/live', async (c) => {
  const cutoff = new Date(Date.now() - STALE_PLAYER_MS).toISOString()
  const onlineUsers = await c.env.DB.prepare(`
    SELECT u.id, u.display_name, u.pfp_url, u.last_seen, u.tags, u.objects_sent_count, lp.status as lobby_status, lp.joined_at
    FROM Users u
    LEFT JOIN LobbyPlayers lp ON u.id = lp.user_id
    WHERE datetime(u.last_seen) > datetime(?)
    ORDER BY u.last_seen DESC
  `).bind(cutoff).all()

  const mapped = (onlineUsers.results || []).map((u: any) => ({
    ...u,
    tags: parseTags(u.tags),
  }))

  return c.json(mapped)
})

// Moderation dashboard: aggregate platform stats + recent activity
admin.get('/dashboard', async (c) => {
  const cutoffOnline = new Date(Date.now() - STALE_PLAYER_MS).toISOString()
  const [
    users,
    online,
    banned,
    admins,
    objects,
    stories,
    lobbyImages,
    queue,
    inSession,
    activeMatches,
    tierActive,
    reports,
    recommendations,
    announcements,
    offlineDeletion,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Users').first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM Users
       WHERE datetime(last_seen) > datetime(?)
          OR EXISTS (SELECT 1 FROM LobbyPlayers lp WHERE lp.user_id = Users.id)`
    ).bind(cutoffOnline).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Bans').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Users WHERE is_admin = 1').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Objects').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Objects WHERE is_story = 1').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM LobbyImages').first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM LobbyPlayers WHERE status = 'waiting'").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM LobbyPlayers WHERE status IN ('in_session', 'in_match')").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM GameMatches WHERE status IN ('lobby', 'playing')").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM TierMatches WHERE status = 'active'").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM ContentReports WHERE status = 'open'").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM Recommendations WHERE status = 'pending'").first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM Announcements WHERE is_active = 1').first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM Users 
       WHERE id NOT LIKE 'bot_%' 
       AND (last_seen IS NULL OR last_seen < datetime('now', '-3 days'))`
    ).first<{ n: number }>(),
  ])

  const recent = await c.env.DB.prepare(`
    SELECT o.id, o.owner_id, o.mime_type, o.size_bytes, o.is_story, o.created_at, o.caption,
           u.display_name as owner_name, u.pfp_url as owner_pfp
    FROM Objects o
    LEFT JOIN Users u ON o.owner_id = u.id
    ORDER BY o.created_at DESC
    LIMIT 12
  `).all<any>()

  return c.json({
    users: Number(users?.n || 0),
    online_users: Number(online?.n || 0),
    banned_users: Number(banned?.n || 0),
    admins: Number(admins?.n || 0),
    objects: Number(objects?.n || 0),
    stories: Number(stories?.n || 0),
    lobby_images: Number(lobbyImages?.n || 0),
    queue_waiting: Number(queue?.n || 0),
    in_session: Number(inSession?.n || 0),
    active_matches: Number(activeMatches?.n || 0),
    active_tier_matches: Number(tierActive?.n || 0),
    pending_reports: Number(reports?.n || 0),
    pending_recommendations: Number(recommendations?.n || 0),
    active_announcements: Number(announcements?.n || 0),
    offline_users_pending_deletion: Number(offlineDeletion?.n || 0),
    recent_objects: (recent.results || []).map((o: any) => ({
      ...o,
      content_url: `/api/objects/${o.id}`,
    })),
  })
})

// Active 1v1 matches with rich cards, scores, rounds and participant info
admin.get('/matches', async (c) => {
  const sessions = await c.env.DB.prepare(`
    SELECT gm.id, gm.user_a, gm.user_b, gm.status, gm.phase, gm.result, gm.phase_deadline, gm.created_at,
           gm.card_a, gm.card_b, gm.score_a, gm.score_b, gm.round_seq, gm.max_rounds, gm.rounds_history,
           ua.display_name as user_a_name, ua.pfp_url as user_a_pfp,
           ub.display_name as user_b_name, ub.pfp_url as user_b_pfp
    FROM GameMatches gm
    LEFT JOIN Users ua ON gm.user_a = ua.id
    LEFT JOIN Users ub ON gm.user_b = ub.id
    ORDER BY CASE WHEN gm.status IN ('lobby', 'playing') THEN 0 ELSE 1 END, gm.created_at DESC
    LIMIT 50
  `).all()

  const out = (sessions.results || []).map((m: any) => {
    let history = []
    try { history = m.rounds_history ? JSON.parse(m.rounds_history) : [] } catch { }
    return {
      ...m,
      score_a: Number(m.score_a || 0),
      score_b: Number(m.score_b || 0),
      round_seq: Number(m.round_seq || 1),
      max_rounds: Number(m.max_rounds || 5),
      rounds_history: history,
      card_a_url: m.card_a ? `/api/objects/${m.card_a}` : null,
      card_b_url: m.card_b ? `/api/objects/${m.card_b}` : null,
    }
  })

  return c.json(out)
})

// Cancel / delete a 1v1 match and free players immediately
admin.delete('/matches/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const match = await c.env.DB
    .prepare("SELECT * FROM GameMatches WHERE id = ?")
    .bind(id)
    .first<GameMatch>()
  if (!match) return c.json({ error: 'Match not found' }, 404)

  if (match.status === 'lobby' || match.status === 'playing') {
    await resolveMatch(c.env.DB, match, Date.now(), 'admin_cancelled')
  } else {
    await c.env.DB.prepare("DELETE FROM GameMatches WHERE id = ?").bind(id).run()
  }
  await logAdminAction(c.env.DB, adminId, 'cancel_match', { id, type: 'match' })

  return c.json({ success: true, cancelled: id })
})

// Force-end a stuck active 1v1 match: award league points from current score
admin.post('/matches/:id/end', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const match = await c.env.DB
    .prepare("SELECT * FROM GameMatches WHERE id = ? AND status IN ('lobby', 'playing')")
    .bind(id)
    .first<GameMatch>()
  if (!match) return c.json({ error: 'Active match not found' }, 404)

  const a = Number(match.score_a || 0)
  const b = Number(match.score_b || 0)
  const winner = a > b ? match.user_a : b > a ? match.user_b : null
  const loser = a > b ? match.user_b : b > a ? match.user_a : null
  if (winner || a === b) await recordLeagueRank(c.env.DB, winner, loser, a === b)
  await resolveMatch(c.env.DB, match, Date.now(), 'admin_ended')
  await logAdminAction(c.env.DB, adminId, 'end_match', { id, type: 'match' }, `score_a=${a} score_b=${b}`)

  return c.json({ success: true, ended: id })
})

// Direct match result override: admin explicitly sets the outcome of an active
// duel (winner_a / winner_b / draw / no_match / forfeit_a / forfeit_b) and the
// match is resolved with that result. League points follow the override.
admin.post('/matches/:id/result', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  let result = ''
  try {
    const body = await c.req.json()
    result = typeof body?.result === 'string' ? body.result : ''
  } catch { }

  const allowed = ['winner_a', 'winner_b', 'draw', 'no_match', 'forfeit_a', 'forfeit_b']
  if (!allowed.includes(result)) {
    return c.json({ error: `Invalid result. Must be one of: ${allowed.join(', ')}` }, 400)
  }

  const match = await c.env.DB
    .prepare("SELECT * FROM GameMatches WHERE id = ? AND status IN ('lobby', 'playing')")
    .bind(id)
    .first<GameMatch>()
  if (!match) return c.json({ error: 'Active match not found' }, 404)

  // League points: winner takes 50, loser 5; draw splits 10; no_match 0.
  if (result === 'winner_a' || result === 'forfeit_a') {
    await recordLeagueRank(c.env.DB, match.user_a, match.user_b, false)
  } else if (result === 'winner_b' || result === 'forfeit_b') {
    await recordLeagueRank(c.env.DB, match.user_b, match.user_a, false)
  } else if (result === 'draw') {
    await recordLeagueRank(c.env.DB, null, null, true)
  }

  await resolveMatch(c.env.DB, match, Date.now(), result)
  await logAdminAction(c.env.DB, adminId, 'override_match_result', { id, type: 'match' }, result)

  return c.json({ success: true, match_id: id, result })
})

// Manually pair up queued players into a fresh 1v1 match (admin override).
// If only 1 player is queued or selected, automatically pairs them with an AI bot!
admin.post('/matches/force', async (c) => {
  let userA: string | null = null
  let userB: string | null = null
  try {
    const body = await c.req.json()
    userA = body?.user_a ? String(body.user_a).trim() : null
    userB = body?.user_b ? String(body.user_b).trim() : null
  } catch { }

  const now = Date.now()
  const onlineCutoff = new Date(now - STALE_PLAYER_MS).toISOString()

  let a = userA
  let b = userB

  if (!a && !b) {
    const queued = await c.env.DB.prepare(`
      SELECT lp.user_id
      FROM LobbyPlayers lp
      LEFT JOIN Users u ON u.id = lp.user_id
      WHERE lp.status = 'waiting'
        AND (lp.auto_queue IS NULL OR lp.auto_queue = 1)
        AND u.last_seen IS NOT NULL
        AND datetime(u.last_seen) >= datetime(?)
      ORDER BY lp.joined_at ASC
      LIMIT 2
    `).bind(onlineCutoff).all<{ user_id: string }>()

    const results = queued.results || []
    if (results.length >= 2) {
      a = results[0].user_id
      b = results[1].user_id
    } else if (results.length === 1) {
      a = results[0].user_id
    } else {
      const online = await c.env.DB.prepare(`
        SELECT id FROM Users WHERE last_seen IS NOT NULL AND datetime(last_seen) >= datetime(?) ORDER BY last_seen DESC LIMIT 1
      `).bind(onlineCutoff).first<{ id: string }>()
      if (online) a = online.id
    }
  }

  if (!a) {
    return c.json({ error: 'No active or queued player found to match' }, 404)
  }

  if (!b || a === b) {
    const profiles = await getBotProfiles(c.env.DB).catch(() => [])
    const available = profiles.filter((p) => p.enabled)
    const bot = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : null
    if (!bot) {
      return c.json({ error: 'No bot profiles configured' }, 409)
    }
    await ensureBotReady(c.env.DB, { id: bot.id, name: bot.name, tags: bot.tags, col: bot.color || '', pfp_url: bot.pfp_url })
    b = bot.id
  }

  // Guard: don't double-match players already locked in a duel.
  const already = await c.env.DB.prepare(`
    SELECT 1 FROM GameMatches
    WHERE status IN ('lobby', 'playing') AND (user_a IN (?, ?) OR user_b IN (?, ?))
    LIMIT 1
  `).bind(a, b, a, b).first()
  if (already) return c.json({ error: 'One of these players is already in an active match' }, 409)

  const id = crypto.randomUUID()
  const deadline = now + 10 * 1000
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO GameMatches (id, user_a, user_b, status, phase, round_seq, max_rounds,
        score_a, score_b, played_cards_a, played_cards_b, rounds_history, phase_deadline, phase_version)
      VALUES (?, ?, ?, 'lobby', 'lobby', 1, 5, 0, 0, '[]', '[]', '[]', ?, 1)
    `).bind(id, a, b, deadline),
    c.env.DB.prepare("UPDATE LobbyPlayers SET status = 'in_match', waiting_since = NULL WHERE user_id IN (?, ?)").bind(a, b),
  ])

  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  await logAdminAction(c.env.DB, c.get('orbitId'), 'force_match', { id, type: 'match' }, `${a} vs ${b}`)

  return c.json({ success: true, match_id: id, user_a: a, user_b: b })
})

// Force matchup all online human players — pairs them up without bots.
admin.post('/matches/force-all', async (c) => {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const MIN_GAME_CARDS = 5
  let onlineCutoff = new Date(now - 30 * 60 * 1000).toISOString() // 30 min default
  
  try {
    const body = await c.req.json().catch(() => ({}))
    if (body?.minOnlineMinutes && typeof body.minOnlineMinutes === 'number') {
      onlineCutoff = new Date(now - body.minOnlineMinutes * 60 * 1000).toISOString()
    }
  } catch { }

  // 1. Get all human users (not bots) who are online and have enough cards
  const humanUsers = await c.env.DB.prepare(`
    SELECT u.id
    FROM Users u
    WHERE u.id NOT IN (SELECT id FROM Bots)
      AND u.last_seen IS NOT NULL
      AND datetime(u.last_seen) >= datetime(?)
      AND (
        SELECT COUNT(*) FROM Objects o 
        WHERE o.owner_id = u.id AND o.is_story = 0
      ) >= ?
  `).bind(onlineCutoff, MIN_GAME_CARDS).all<{ id: string }>()

  const humanIds = humanUsers.results.map(r => r.id)
  if (humanIds.length === 0) {
    return c.json({ 
      success: false, 
      error: 'No eligible human players found',
      summary: { totalHumansOnline: 0, eligibleForQueue: 0, matchesCreated: 0 }
    }, 404)
  }

  // 2. Find users already in active matches
  const activeMatches = await c.env.DB.prepare(`
    SELECT user_a, user_b FROM GameMatches WHERE status IN ('lobby', 'playing')
  `).bind().all<{ user_a: string; user_b: string }>()
  const inMatchIds = new Set<string>()
  for (const m of activeMatches.results) {
    inMatchIds.add(m.user_a)
    inMatchIds.add(m.user_b)
  }

  // 3. Find users already waiting in queue
  const waitingPlayers = await c.env.DB.prepare(`
    SELECT user_id FROM LobbyPlayers WHERE status = 'waiting'
  `).bind().all<{ user_id: string }>()
  const waitingIds = new Set(waitingPlayers.results.map(r => r.user_id))

  // 4. Determine eligible users (not in match, not already waiting)
  const eligibleIds = humanIds.filter(id => !inMatchIds.has(id) && !waitingIds.has(id))

  // 5. Add eligible users to queue
  let newlyQueued = 0
  if (eligibleIds.length > 0) {
    for (const userId of eligibleIds) {
      await c.env.DB.prepare(`
        INSERT INTO LobbyPlayers (user_id, status, auto_queue, joined_at, waiting_since)
        VALUES (?, 'waiting', 1, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          status = 'waiting',
          auto_queue = 1,
          waiting_since = ?
      `).bind(userId, nowIso, nowIso, nowIso).run()
      newlyQueued++
    }
  }

  // 6. Run pairing with skipBots=true
  await advanceLobbyWithOptions(c.env.DB, now, true)

  // 7. Get created matches
  const newMatches = await c.env.DB.prepare(`
    SELECT id, user_a, user_b FROM GameMatches 
    WHERE status = 'lobby' AND phase = 'lobby' AND datetime(created_at) >= datetime(?)
  `).bind(nowIso).all<{ id: string; user_a: string; user_b: string }>()

  // Check for unpaired player (odd total: queued already-waiting + newly queued)
  const totalQueued = waitingIds.size + eligibleIds.length
  const unpairedPlayer = totalQueued % 2 === 1 ? eligibleIds[eligibleIds.length - 1] ?? null : null

  await logAdminAction(c.env.DB, c.get('orbitId'), 'force_match_all', 
    { id: 'force_match_all', type: 'match' }, `Force-matched ${newMatches.results.length} pairs from ${humanIds.length} humans`)

  return c.json({
    success: true,
    summary: {
      totalHumansOnline: humanIds.length,
      alreadyInMatch: humanIds.filter(id => inMatchIds.has(id)).length,
      alreadyWaiting: humanIds.filter(id => waitingIds.has(id)).length,
      newlyQueued,
      matchesCreated: newMatches.results.length,
      unpairedPlayer
    },
    matches: newMatches.results
  })
})

// Archived (resolved) 1v1 duels — admin-only match report browser. Every ended
// match is copied into MatchArchive at resolve time; this endpoint lists the
// archive with advanced filters (result, matched/perfect, player, date range,
// search) and pagination.
admin.get('/matches/archive', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const result = (c.req.query('result') || '').trim()
  const matchedParam = c.req.query('matched') || ''
  const perfectParam = c.req.query('perfect') || ''
  const user = (c.req.query('user') || '').trim()
  const from = (c.req.query('from') || '').trim()
  const to = (c.req.query('to') || '').trim()
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

  const where: string[] = []
  const bind: string[] = []
  if (result) { where.push('ma.result = ?'); bind.push(result) }
  if (matchedParam === '1' || matchedParam === 'matched') where.push('ma.matched = 1')
  if (matchedParam === '0' || matchedParam === 'unmatched') where.push('ma.matched = 0')
  if (perfectParam === '1' || perfectParam === 'perfect') where.push('ma.perfect = 1')
  if (user) { where.push('(ma.user_a = ? OR ma.user_b = ?)'); bind.push(user, user) }
  if (from) { where.push('datetime(ma.ended_at) >= datetime(?)'); bind.push(from) }
  if (to) { where.push('datetime(ma.ended_at) <= datetime(?)'); bind.push(to) }
  if (q) {
    where.push('(LOWER(ma.user_a_name) LIKE ? OR LOWER(ma.user_b_name) LIKE ? OR LOWER(ma.id) LIKE ? OR LOWER(ma.user_a) LIKE ? OR LOWER(ma.user_b) LIKE ?)')
    const like = `%${q}%`
    bind.push(like, like, like, like, like)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM MatchArchive ma ${whereSql}`)
    .bind(...bind)
    .first<{ n: number }>()

  const rows = await c.env.DB
    .prepare(`
      SELECT ma.* FROM MatchArchive ma
      ${whereSql}
      ORDER BY ma.ended_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...bind, String(limit), String(offset))
    .all()

  const out = await Promise.all((rows.results || []).map(async (m: any) => {
    let history: any[] = []
    try { history = m.rounds_history ? JSON.parse(m.rounds_history) : [] } catch { }
    const resolvedHistory = await Promise.all(history.map(async (h: any) => ({
      ...h,
      card_a_url: await resolveCardUrl(c.env.DB, h.card_a),
      card_b_url: await resolveCardUrl(c.env.DB, h.card_b),
    })))
    return {
      id: m.id,
      user_a: m.user_a,
      user_b: m.user_b,
      user_a_name: m.user_a_name,
      user_a_pfp: m.user_a_pfp,
      user_b_name: m.user_b_name,
      user_b_pfp: m.user_b_pfp,
      score_a: Number(m.score_a || 0),
      score_b: Number(m.score_b || 0),
      result: m.result,
      matched: Number(m.matched || 0),
      perfect: Number(m.perfect || 0),
      rounds_history: resolvedHistory,
      created_at: m.created_at,
      ended_at: m.ended_at,
    }
  }))

  return c.json({
    matches: out,
    total: Number(countRow?.n || 0),
    limit,
    offset,
  })
})

// Full single-archived-match report detail (round history with cards).
admin.get('/matches/archive/:id', async (c) => {
  const id = c.req.param('id') || ''
  const m = await c.env.DB
    .prepare('SELECT * FROM MatchArchive WHERE id = ?')
    .bind(id)
    .first<any>()
  if (!m) return c.json({ error: 'Archived match not found' }, 404)
  let history: any[] = []
  try { history = m.rounds_history ? JSON.parse(m.rounds_history) : [] } catch { }
  const resolvedHistory = await Promise.all(history.map(async (h: any) => ({
    ...h,
    card_a_url: await resolveCardUrl(c.env.DB, h.card_a),
    card_b_url: await resolveCardUrl(c.env.DB, h.card_b),
  })))
  return c.json({
    id: m.id,
    user_a: m.user_a,
    user_b: m.user_b,
    user_a_name: m.user_a_name,
    user_a_pfp: m.user_a_pfp,
    user_b_name: m.user_b_name,
    user_b_pfp: m.user_b_pfp,
    score_a: Number(m.score_a || 0),
    score_b: Number(m.score_b || 0),
    result: m.result,
    matched: Number(m.matched || 0),
    perfect: Number(m.perfect || 0),
    rounds_history: resolvedHistory,
    created_at: m.created_at,
    ended_at: m.ended_at,
  })
})

// Active & recent special (tier-ladder) matches
admin.get('/special-matches', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT tm.id, tm.user_a, tm.user_b, tm.card_a, tm.card_b, tm.decision_a, tm.decision_b,
           tm.tier, tm.status, tm.last_result, tm.last_card_a, tm.last_card_b, tm.updated_at,
           ua.display_name as user_a_name, ua.pfp_url as user_a_pfp,
           ub.display_name as user_b_name, ub.pfp_url as user_b_pfp
       FROM TierMatches tm
    LEFT JOIN Users ua ON tm.user_a = ua.id
    LEFT JOIN Users ub ON tm.user_b = ub.id
    ORDER BY CASE WHEN tm.status = 'active' THEN 0 ELSE 1 END, tm.updated_at DESC
    LIMIT 50
  `).all()

  const out = (results || []).map((tm: any) => ({
    ...tm,
    card_a_url: tm.card_a ? `/api/objects/${tm.card_a}` : null,
    card_b_url: tm.card_b ? `/api/objects/${tm.card_b}` : null,
    last_card_a_url: tm.last_card_a ? `/api/objects/${tm.last_card_a}` : null,
    last_card_b_url: tm.last_card_b ? `/api/objects/${tm.last_card_b}` : null,
  }))

  return c.json(out)
})

// Force-end a special tier match
admin.post('/special-matches/:id/end', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const match = await c.env.DB.prepare('SELECT * FROM TierMatches WHERE id = ?').bind(id).first<any>()
  if (!match) return c.json({ error: 'Tier match not found' }, 404)

  await c.env.DB.prepare("UPDATE TierMatches SET status = 'ended', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run()
  await logAdminAction(c.env.DB, adminId, 'end_special_match', { id, type: 'tier_match' })

  return c.json({ success: true, ended: id })
})

// Lobby board shared media stream
admin.get('/lobby-images', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT li.id, li.owner_id as user_id, li.content_url, li.caption, li.likes_count, li.created_at,
           u.display_name as user_name, u.pfp_url as user_pfp
    FROM LobbyImages li
    LEFT JOIN Users u ON li.owner_id = u.id
    WHERE (li.content_url IS NOT NULL AND li.content_url != '')
      AND (li.expires_at IS NULL OR datetime(li.expires_at) > datetime('now'))
    ORDER BY li.created_at DESC
    LIMIT 100
  `).all()

  const mapped = (results || []).map((img: any) => {
    if (img.content_url && img.content_url.startsWith('data:')) {
      return { ...img, content_url: `/api/lobby/images/${img.id}/content` }
    }
    return img
  })

  return c.json(mapped)
})

// Delete a lobby board image
admin.delete('/lobby-images/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const item = await c.env.DB.prepare('SELECT id FROM LobbyImages WHERE id = ?').bind(id).first<any>()
  if (!item) return c.json({ error: 'Lobby image not found' }, 404)

  if (c.env.BUCKET) {
    try {
      await c.env.BUCKET.delete(`lobby/${id}`)
    } catch { }
  }

  await c.env.DB.prepare('DELETE FROM LobbyImages WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'delete_lobby_image', { id, type: 'lobby_image' })
  return c.json({ success: true, deleted: id })
})

// Canonical public-post browser. Posts are public Objects with post metadata;
// keeping this resource explicit prevents the admin UI from conflating feed
// moderation with the broader private media store.
admin.get('/posts', async (c) => {
  const url = new URL(c.req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const author = (url.searchParams.get('author_id') || '').trim()
  const visibility = url.searchParams.get('visibility') || 'all'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
  const where = ['o.is_public = 1']
  const args: unknown[] = []
  if (visibility === 'hidden') where.push('o.hidden_at IS NOT NULL')
  else if (visibility === 'visible') where.push('o.hidden_at IS NULL')
  if (author) { where.push('o.owner_id = ?'); args.push(author) }
  if (q) {
    where.push('(o.id LIKE ? OR COALESCE(o.post_caption, o.caption) LIKE ? OR COALESCE(o.post_tags, \'\') LIKE ? OR u.display_name LIKE ?)')
    const like = `%${q}%`
    args.push(like, like, like, like)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM Objects o LEFT JOIN Users u ON u.id = o.owner_id ${whereSql}`).bind(...args).first<{ n: number }>()
  const rows = await c.env.DB.prepare(`
    SELECT o.id, o.owner_id, u.display_name AS author_name, o.mime_type,
           o.created_at, o.hidden_at, o.post_caption, o.post_tags, o.location,
           o.like_count, o.comment_count, o.share_count, o.post_group,
           o.content_url
    FROM Objects o LEFT JOIN Users u ON u.id = o.owner_id
    ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).bind(...args, limit, offset).all()
  c.header('X-Total-Count', String(total?.n || 0))
  return c.json(rows.results || [])
})

admin.patch('/posts/:id/visibility', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  let hidden = false
  let reason = ''
  try {
    const body = await c.req.json()
    hidden = Boolean(body?.hidden)
    reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  } catch { }
  const result = await c.env.DB.prepare('UPDATE Objects SET hidden_at = ? WHERE id = ? AND is_public = 1')
    .bind(hidden ? new Date().toISOString() : null, id).run()
  if (!result.success || Number(result.meta?.changes || 0) === 0) return c.json({ error: 'Public post not found' }, 404)
  await logAdminAction(c.env.DB, adminId, hidden ? 'hide_post' : 'unhide_post', { id, type: 'post' }, reason)
  return c.json({ ok: true, id, hidden })
})

admin.delete('/posts/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const post = await c.env.DB.prepare('SELECT owner_id, mime_type FROM Objects WHERE id = ? AND is_public = 1').bind(id).first<{ owner_id: string; mime_type: string }>()
  if (!post) return c.json({ error: 'Public post not found' }, 404)
  if (post.mime_type !== 'text/url' && c.env.BUCKET) await c.env.BUCKET.delete(`objects/${id}`).catch(() => {})
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM CommentLikes WHERE comment_id IN (SELECT id FROM Comments WHERE object_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM Comments WHERE object_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM Saves WHERE object_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM PostLikes WHERE object_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM Objects WHERE id = ? AND is_public = 1').bind(id),
  ])
  await logAdminAction(c.env.DB, adminId, 'delete_post', { id, type: 'post' }, 'Admin-only permanent deletion')
  return c.json({ ok: true, deleted: id })
})

// Sent pictures stream (objects)
admin.get('/objects', async (c) => {
  const url = new URL(c.req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const owner = (url.searchParams.get('owner') || '').trim()
  const type = url.searchParams.get('type') || ''
  const sort = url.searchParams.get('sort') || 'created_at'
  const order = url.searchParams.get('order')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

  const where: string[] = []
  const params: unknown[] = []
  if (q) {
    where.push(`(o.caption LIKE ? OR o.id LIKE ? OR u.display_name LIKE ?)`)
    const like = `%${q}%`
    params.push(like, like, like)
  }
  if (owner) {
    where.push('o.owner_id = ?')
    params.push(owner)
  }
  if (type === 'story') where.push('o.is_story = 1')
  if (type === 'card') where.push('COALESCE(o.is_story, 0) = 0')

  const sortMap: Record<string, string> = {
    created_at: 'o.created_at',
    likes: 'COALESCE(lc.n, 0)',
    favorites: 'COALESCE(fc.n, 0)',
    recipients: 'COALESCE(rc.n, 0)',
    size: 'o.size_bytes',
  }
  const orderCol = sortMap[sort] || 'o.created_at'

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM Objects o
    LEFT JOIN Users u ON o.owner_id = u.id
    ${whereSql}
  `).bind(...params).first<{ n: number }>()

  const { results } = await c.env.DB.prepare(`
    SELECT o.id, o.owner_id, o.mime_type, o.size_bytes, o.is_story, o.created_at, o.caption,
           u.display_name as owner_name, u.public_key as owner_public_key,
           COALESCE(rc.n, 0) as recipients_count,
           COALESCE(lc.n, 0) as likes_count,
           COALESCE(fc.n, 0) as favorites_count
    FROM Objects o
    LEFT JOIN Users u ON o.owner_id = u.id
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Recipients GROUP BY object_id) rc ON rc.object_id = o.id
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Likes GROUP BY object_id) lc ON lc.object_id = o.id
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Favorites GROUP BY object_id) fc ON fc.object_id = o.id
    ${whereSql}
    ORDER BY ${orderCol} ${order}
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all()

  const out = (results || []).map((o: any) => ({
    ...o,
    content_url: `/api/objects/${o.id}`,
  }))

  c.header('X-Total-Count', String(total?.n || 0))
  return c.json(out)
})

// Intercept everything one user ever sent: every object they own, with counts
// and a signed-GET content_url. Lets a moderator sweep a reported account
// without hunting through the global stream.
admin.get('/users/:id/objects', async (c) => {
  const userId = c.req.param('id')
  if (!userId) return c.json({ error: 'Missing user id' }, 400)

  const { results } = await c.env.DB.prepare(`
    SELECT o.id, o.owner_id, o.mime_type, o.size_bytes, o.is_story, o.created_at, o.caption,
           o.is_wallpaper,
           COALESCE(rc.n, 0) as recipients_count,
           COALESCE(lc.n, 0) as likes_count,
           COALESCE(fc.n, 0) as favorites_count,
           CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS sender_is_banned,
           CASE WHEN t.card_a = o.id OR t.card_b = o.id THEN 1 ELSE 0 END AS used_in_tier_match
    FROM Objects o
    LEFT JOIN Users u ON o.owner_id = u.id
    LEFT JOIN Bans b ON b.user_id = o.owner_id
    LEFT JOIN TierMatches t ON (t.card_a = o.id OR t.card_b = o.id) AND t.status = 'active'
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Recipients GROUP BY object_id) rc ON rc.object_id = o.id
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Likes GROUP BY object_id) lc ON lc.object_id = o.id
    LEFT JOIN (SELECT object_id, COUNT(*) as n FROM Favorites GROUP BY object_id) fc ON fc.object_id = o.id
    WHERE o.owner_id = ?
    ORDER BY o.created_at DESC
    LIMIT 200
  `).bind(userId).all()

  const out = (results || []).map((o: any) => ({
    id: o.id,
    owner_id: o.owner_id,
    mime_type: o.mime_type,
    size_bytes: o.size_bytes,
    is_story: o.is_story,
    is_wallpaper: o.is_wallpaper,
    created_at: o.created_at,
    caption: o.caption,
    recipients_count: Number(o.recipients_count || 0),
    likes_count: Number(o.likes_count || 0),
    favorites_count: Number(o.favorites_count || 0),
    sender_is_banned: o.sender_is_banned ? true : false,
    used_in_tier_match: o.used_in_tier_match ? true : false,
    content_url: `/api/objects/${o.id}`,
  }))

  return c.json(out)
})

// Admin-only hard delete of any object (moderation). Purges likes/favorites,
// recipients, blob, and TierMatches card references in one go.
admin.post('/objects/:id/delete', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const obj = await c.env.DB.prepare('SELECT owner_id, mime_type FROM Objects WHERE id = ?').bind(id).first<{ owner_id: string; mime_type: string }>()
  if (!obj) return c.json({ error: 'Object not found' }, 404)

  if (obj.mime_type !== 'text/url' && c.env.BUCKET) {
    try {
      await c.env.BUCKET.delete(`objects/${id}`)
    } catch (err) {
      console.error(`[admin] Failed to delete blob for object ${id}:`, err)
    }
  }

  await c.env.DB.prepare('DELETE FROM Favorites WHERE object_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM Recipients WHERE object_id = ?').bind(id).run()
  await purgeObjectLikes(c.env.DB, id)
  await c.env.DB.prepare('UPDATE TierMatches SET card_a = NULL WHERE card_a = ?').bind(id).run()
  await c.env.DB.prepare('UPDATE TierMatches SET card_b = NULL WHERE card_b = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM Objects WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'delete_object', { id, type: 'object' })

  return c.json({ success: true, deleted: id })
})

// Redact a submitted object: wipe the blob, thumbnail refs and caption while
// keeping the row (recipients/history stay intact so the poster can be traced).
admin.post('/objects/:id/redact', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const obj = await c.env.DB.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind(id).first<{ mime_type: string }>()
  if (!obj) return c.json({ error: 'Object not found' }, 404)

  if (obj.mime_type !== 'text/url' && c.env.BUCKET) {
    try {
      await c.env.BUCKET.delete(`objects/${id}`)
    } catch (err) {
      console.error(`[admin] Failed to delete redacted blob for object ${id}:`, err)
    }
  }

  await c.env.DB
    .prepare("UPDATE Objects SET content_url = NULL, caption = 'REDACTED BY ADMIN', mime_type = 'text/redacted', size_bytes = 0 WHERE id = ?")
    .bind(id)
    .run()
  await logAdminAction(c.env.DB, adminId, 'redact_object', { id, type: 'object' })

  return c.json({ success: true, redacted: id })
})

// ─── Unified content reports queue (ContentReports) ───────────────────────
// Every report (post, story, lobby image, comment, PM, chat, card, user)
// lands here. Listing enriches each row with a target preview, the reported
// user's identity and current hidden/banned state.

const REPORT_ACCEPTED_TYPES = new Set([
  'post', 'story', 'lobby_image', 'lobby_comment', 'post_comment',
  'private_message', 'lobby_chat', 'match_chat', 'group_message', 'card', 'user',
])

admin.get('/content-reports', async (c) => {
  const url = new URL(c.req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const status = url.searchParams.get('status') || ''
  const category = url.searchParams.get('category') || ''
  const targetType = url.searchParams.get('target_type') || ''
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '200') || 200, 1), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') || '0') || 0, 0)

  const where: string[] = []
  const params: unknown[] = []
  if (q) {
    where.push('(reporter.display_name LIKE ? OR cr.reason LIKE ? OR cr.target_id LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like)
  }
  if (['open', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
    where.push('cr.status = ?')
    params.push(status)
  }
  if (category) {
    where.push('cr.category = ?')
    params.push(category)
  }
  if (targetType && REPORT_ACCEPTED_TYPES.has(targetType)) {
    where.push('cr.target_type = ?')
    params.push(targetType)
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM ContentReports cr
    LEFT JOIN Users reporter ON cr.reporter_id = reporter.id
    ${whereSql}
  `).bind(...params).first<{ n: number }>()

  const { results } = await c.env.DB.prepare(`
    SELECT cr.id, cr.reporter_id, cr.target_type, cr.target_id, cr.category, cr.reason,
           cr.object_id, cr.status, cr.action, cr.resolved_by, cr.resolved_at, cr.created_at, cr.hidden_at,
           reporter.display_name AS reporter_name
    FROM ContentReports cr
    LEFT JOIN Users reporter ON cr.reporter_id = reporter.id
    ${whereSql}
    ORDER BY CASE WHEN cr.status = 'open' THEN 0 ELSE 1 END, cr.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all()

  const rows = (results || []) as any[]

  // Enrich each report with a preview of its target. Group by type and fetch
  // one enriched set per present type instead of N+1 row lookups.
  const byType = new Map<string, any[]>()
  for (const r of rows) {
    if (!byType.has(r.target_type)) byType.set(r.target_type, [])
    byType.get(r.target_type)!.push(r.target_id)
  }

  const enrichment: Record<string, Record<string, any>> = {}
  for (const [type, ids] of byType) {
    const list = ids.map(() => '?').join(',')
    if (type === 'post' || type === 'story') {
      const { results: rs } = await c.env.DB.prepare(`
        SELECT o.id, o.content_url, o.caption, o.post_caption, o.hidden_at,
               u.display_name AS owner_name,
               CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
        FROM Objects o
        LEFT JOIN Users u ON o.owner_id = u.id
        LEFT JOIN Bans b ON b.user_id = o.owner_id
        WHERE o.id IN (${list})
      `).bind(...ids).all<any>()
      for (const row of rs || []) enrichment[`${type}:${row.id}`] = row
    } else if (type === 'lobby_image') {
      const { results: rs } = await c.env.DB.prepare(`
        SELECT li.id, li.content_url, li.caption, li.hidden_at,
               u.display_name AS owner_name,
               CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
        FROM LobbyImages li
        LEFT JOIN Users u ON li.owner_id = u.id
        LEFT JOIN Bans b ON b.user_id = li.owner_id
        WHERE li.id IN (${list})
      `).bind(...ids).all<any>()
      for (const row of rs || []) enrichment[`${type}:${row.id}`] = row
    } else if (type === 'card') {
      const { results: rs } = await c.env.DB.prepare(`
        SELECT c.id, c.name, c.content_url, c.moderation_state,
               u.display_name AS owner_name,
               CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
        FROM Cards c
        LEFT JOIN Users u ON u.id = c.creator_id
        LEFT JOIN Bans b ON b.user_id = c.creator_id
        WHERE c.id IN (${list})
      `).bind(...ids).all<any>()
      for (const row of rs || []) enrichment[`${type}:${row.id}`] = row
    } else if (type === 'user') {
      const { results: rs } = await c.env.DB.prepare(`
        SELECT u.id, u.display_name, u.pfp_url, u.hidden_at,
               CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
        FROM Users u LEFT JOIN Bans b ON b.user_id = u.id
        WHERE u.id IN (${list})
      `).bind(...ids).all<any>()
      for (const row of rs || []) enrichment[`${type}:${row.id}`] = row
    } else {
      // Text content rows (comments, chat, DM). Tables differ, but each has an
      // author-ish column and body. `hidden_at` is present on all of them.
      const ownerCol = type === 'lobby_comment' ? 'user_id'
        : type === 'post_comment' ? 'author_id'
        : type === 'private_message' ? 'sender_id'
        : 'sender_id'
      const { results: rs } = await c.env.DB.prepare(`
        SELECT t.id, t.body, t.hidden_at, u.display_name AS owner_name,
               CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
        FROM ${type === 'post_comment' ? 'Comments' : type === 'group_message' ? 'GroupMessages'
          : type === 'private_message' ? 'PrivateMessages'
          : type === 'lobby_chat' ? 'LobbyChat'
          : type === 'match_chat' ? 'MatchChat' : 'LobbyComments'} t
        LEFT JOIN Users u ON u.id = t.${ownerCol}
        LEFT JOIN Bans b ON b.user_id = t.${ownerCol}
        WHERE t.id IN (${list})
      `).bind(...ids).all<any>()
      for (const row of rs || []) enrichment[`${type}:${row.id}`] = row
    }
  }

  const out = rows.map((r: any) => {
    const target = enrichment[`${r.target_type}:${r.target_id}`]
    const isHidden = r.target_type === 'card' ? (target?.moderation_state && target.moderation_state !== 'active') : Boolean(target?.hidden_at)
    return {
      id: r.id,
      reporter_id: r.reporter_id,
      reporter_name: r.reporter_name || null,
      target_type: r.target_type,
      target_id: r.target_id,
      target_user_name: target?.owner_name ?? (r.target_type === 'user' ? target?.display_name : null) ?? null,
      content_url: target?.content_url || null,
      preview: target?.caption || target?.post_caption || target?.name || target?.body || (r.target_type === 'user' ? target?.display_name : null) || null,
      category: r.category || null,
      reason: r.reason || null,
      object_id: r.object_id || null,
      status: r.status || 'open',
      action: r.action || null,
      resolved_by: r.resolved_by || null,
      resolved_at: r.resolved_at || null,
      created_at: r.created_at,
      hidden_at: r.hidden_at || null,
      is_hidden: isHidden,
      reported_is_banned: Boolean(target?.is_banned),
    }
  })

  c.header('X-Total-Count', String(total?.n || 0))
  return c.json(out)
})

// Resolve a report — admin chooses exactly three actions:
//   delete: hard-delete the reported content
//   ban:    ban the owner user + wipe all their content
//   deny:   false positive — unhide the content
admin.post('/content-reports/:id/resolve', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  let action = ''
  try {
    const body = await c.req.json()
    if (typeof body?.action === 'string') action = body.action.trim()
  } catch { }

  try {
    const result = await resolveReport(c.env.DB, c.env.BUCKET, id, adminId, action as 'delete' | 'ban' | 'deny')
    await logAdminAction(c.env.DB, adminId, 'resolve_content_report', { id, type: 'content_report' }, `action=${result.action}`)
    return c.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})

// List all users with ban status + identification + activity stamps
admin.get('/users', async (c) => {
  const url = new URL(c.req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const role = url.searchParams.get('role') || ''
  const status = url.searchParams.get('status') || ''
  const sort = url.searchParams.get('sort') || 'last_seen'
  const order = url.searchParams.get('order')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

  const where: string[] = []
  const params: unknown[] = []
  if (q) {
    where.push(`(u.display_name LIKE ? OR u.public_key LIKE ? OR u.id LIKE ?)`)
    const like = `%${q}%`
    params.push(like, like, like)
  }
  if (role === 'admin') where.push('COALESCE(u.is_admin, 0) = 1')
  if (role === 'user') where.push('COALESCE(u.is_admin, 0) = 0')
  if (status === 'banned') where.push('b.id IS NOT NULL')
  if (status === 'active') where.push('b.id IS NULL')
  if (status === 'online') where.push(`(u.last_seen IS NOT NULL AND u.last_seen >= datetime('now', '-3 minutes'))`)
  if (status === 'offline_warning') where.push(`(u.last_seen IS NOT NULL AND u.last_seen < datetime('now', '-2 days') AND u.last_seen >= datetime('now', '-3 days'))`)
  if (status === 'offline_deletion') where.push(`(u.last_seen IS NULL OR u.last_seen < datetime('now', '-3 days'))`)

  const sortMap: Record<string, string> = {
    last_seen: 'u.last_seen',
    objects: 'COALESCE(u.objects_sent_count, 0)',
    matches: 'COALESCE(u.matches_total, 0)',
    likes_received: 'COALESCE(u.likes_received, 0)',
    likes_given: 'COALESCE(u.likes_given, 0)',
    gacha: 'COALESCE(u.gacha_items_collected, 0)',
    name: 'u.display_name',
  }
  const orderCol = sortMap[sort] || 'u.last_seen'

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const total = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM Users u
    LEFT JOIN Bans b ON u.id = b.user_id
    ${whereSql}
  `).bind(...params).first<{ n: number }>()

  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.public_key, u.encryption_pub_key, u.display_name, u.tags, u.last_seen, u.attention_at,
           COALESCE(u.objects_sent_count, 0) as objects_sent_count,
           COALESCE(u.is_admin, 0) as is_admin,
           COALESCE(u.likes_given, 0) as likes_given,
           COALESCE(u.likes_received, 0) as likes_received,
           COALESCE(u.matches_total, 0) as matches_total,
           COALESCE(u.gacha_items_collected, 0) as gacha_items_collected,
           COALESCE(g.sum_downloads, 0) as gacha_downloads_received,
           COALESCE(u.score, 0) as score,
           COALESCE(w.balance, 0) as balance,
           COALESCE(u.followers_count, 0) as followers_count,
           lp.status as lobby_status,
           CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END as is_banned,
           b.reason as ban_reason, b.created_at as ban_created_at,
           CASE WHEN t.uid IS NOT NULL THEN 1 ELSE 0 END as active_tier_match
    FROM Users u
    LEFT JOIN Bans b ON u.id = b.user_id
    LEFT JOIN Wallets w ON w.user_id = u.id
    LEFT JOIN LobbyPlayers lp ON u.id = lp.user_id
    LEFT JOIN (
      SELECT owner_id, SUM(COALESCE(gacha_downloads_count, 0)) as sum_downloads
      FROM Objects
      GROUP BY owner_id
    ) g ON g.owner_id = u.id
    LEFT JOIN (
      SELECT user_a as uid FROM TierMatches WHERE status = 'active'
      UNION SELECT user_b as uid FROM TierMatches WHERE status = 'active'
    ) t ON t.uid = u.id
    ${whereSql}
    ORDER BY ${orderCol} ${order}
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all()

  const now = Date.now()
  const mapped = (results || []).map((u: any) => {
    const lastSeen = u.last_seen ? new Date(u.last_seen).getTime() : 0
    const online = lastSeen > 0 && (now - lastSeen) < 3 * 60 * 1000 || Boolean(u.lobby_status)
    const daysOffline = lastSeen > 0 ? Math.floor((now - lastSeen) / (24 * 60 * 60 * 1000)) : null
    const tags = parseTags(u.tags)
    return {
      id: u.id,
      public_key: u.public_key,
      encryption_pub_key: u.encryption_pub_key || null,
      display_name: u.display_name || undefined,
      tags: tags.length > 0 ? tags : undefined,
      last_seen: u.last_seen || undefined,
      days_offline: daysOffline,
      online,
      lobby_status: u.lobby_status || null,
      active_tier_match: u.active_tier_match ? true : false,
      objects_sent_count: Number(u.objects_sent_count || 0),
      likes_given: Number(u.likes_given || 0),
      likes_received: Number(u.likes_received || 0),
      matches_total: Number(u.matches_total || 0),
      gacha_items_collected: Number(u.gacha_items_collected || 0),
      gacha_downloads_received: Number(u.gacha_downloads_received || 0),
      score: Number(u.score ?? 0),
      balance: Number(u.balance ?? 0),
      followers_count: Number(u.followers_count ?? 0),
      is_admin: u.is_admin ? true : false,
      is_banned: u.is_banned ? true : false,
      ban_reason: u.ban_reason || null,
      ban_created_at: u.ban_created_at || null,
    }
  })

  c.header('X-Total-Count', String(total?.n || 0))
  return c.json(mapped)
})

// Ban a user. `wipe: true` (default) wipes ALL of the user's content while
// keeping the account + ban record — the full "ban & purge" moderation action.
admin.post('/users/:id/ban', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')
  let reason = ''
  let scope = 'all'
  let banScopeChat = false
  let banScopePm = false
  let wipe = true
  try {
    const body = await c.req.json()
    if (body?.reason) reason = String(body.reason).substring(0, 500)
    if (typeof body?.scope === 'string' && ['all', 'chat', 'pm'].includes(body.scope)) scope = body.scope
    if (typeof body?.ban_scope_chat === 'boolean') banScopeChat = body.ban_scope_chat
    if (typeof body?.ban_scope_pm === 'boolean') banScopePm = body.ban_scope_pm
    if (typeof body?.wipe === 'boolean') wipe = body.wipe
  } catch { }

  const existing = await c.env.DB.prepare('SELECT 1 FROM Bans WHERE user_id = ?').bind(userId).first()
  if (existing) return c.json({ error: 'User already banned' }, 400)

  const banId = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO Bans (id, user_id, banned_by, reason, scope, ban_scope_chat, ban_scope_pm) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(banId, userId, orbitId, reason, scope, banScopeChat ? 1 : 0, banScopePm ? 1 : 0).run()

  // Wipe all content (cards, stories, likes, PMs, chats) but keep the account.
  let wipedObjects = 0
  if (wipe) {
    try {
      const affected = await wipeUserContent(c.env.DB, userId, { BUCKET: c.env.BUCKET })
      wipedObjects = affected.length
    } catch (error) {
      console.warn('[admin] wipe failed on ban:', error)
    }
  }

  await logAdminAction(c.env.DB, orbitId, 'ban_user', { id: userId, type: 'user' }, `wipe=${wipe} ${reason}`)

  return c.json({ success: true, banId, wiped: wipe })
})

// Unban a user
admin.post('/users/:id/unban', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM Bans WHERE user_id = ?').bind(userId).run()
  await logAdminAction(c.env.DB, orbitId, 'unban_user', { id: userId, type: 'user' })
  return c.json({ success: true })
})

// Toggle moderator role for a user
admin.post('/users/:id/moderator', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')

  let isModerator = true
  try {
    const body = await c.req.json()
    if (typeof body?.is_moderator === 'boolean') isModerator = body.is_moderator
    else if (typeof body?.moderator === 'boolean') isModerator = body.moderator
  } catch { }

  const target = await c.env.DB.prepare('SELECT 1 FROM Users WHERE id = ?').bind(userId).first()
  if (!target) return c.json({ error: 'User not found' }, 404)

  await c.env.DB.prepare('UPDATE Users SET is_moderator = ? WHERE id = ?').bind(isModerator ? 1 : 0, userId).run()
  await logAdminAction(c.env.DB, orbitId, isModerator ? 'grant_moderator' : 'revoke_moderator', { id: userId, type: 'user' })

  return c.json({ success: true, user_id: userId, is_moderator: isModerator })
})

// Edit user balances directly. Supports metric-specific adjustments:
//   - score / add_score           -> daily score (Users.score), and raises
//                                    score_total via MAX for back-compat
//   - reputation / add_reputation -> persistent reputation (Users.score_total)
//   - gcoins / add_gcoins         -> g$ wallet via EconomyService (ledgered)
//   - likes_received, followers_count, is_moderator, is_admin (unchanged)
admin.post('/users/:id/adjust', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')

  let scoreDelta: number | undefined
  let likesDelta: number | undefined
  let followersDelta: number | undefined
  let setScore: number | undefined
  let setLikes: number | undefined
  let setFollowers: number | undefined
  let setModerator: boolean | undefined
  let setAdmin: boolean | undefined
  let setReputation: number | undefined
  let reputationDelta: number | undefined
  let gcoinsDelta: number | undefined

  try {
    const body = await c.req.json()
    if (typeof body?.score === 'number') setScore = body.score
    if (typeof body?.likes_received === 'number') setLikes = body.likes_received
    if (typeof body?.followers_count === 'number') setFollowers = body.followers_count
    if (typeof body?.add_score === 'number') scoreDelta = body.add_score
    if (typeof body?.add_likes === 'number') likesDelta = body.add_likes
    if (typeof body?.add_followers === 'number') followersDelta = body.add_followers
    if (typeof body?.is_moderator === 'boolean') setModerator = body.is_moderator
    if (typeof body?.is_admin === 'boolean' && userId !== orbitId) setAdmin = body.is_admin
    if (typeof body?.reputation === 'number') setReputation = body.reputation
    if (typeof body?.add_reputation === 'number') reputationDelta = body.add_reputation
    if (typeof body?.add_gcoins === 'number') gcoinsDelta = body.add_gcoins
  } catch { }

  const user = await c.env.DB.prepare('SELECT * FROM Users WHERE id = ?').bind(userId).first<any>()
  if (!user) return c.json({ error: 'User not found' }, 404)

  const newScore = setScore !== undefined ? setScore : (Number(user.score || 0) + (scoreDelta || 0))
  const newReputation = setReputation !== undefined
    ? setReputation
    : (Number(user.score_total || 0) + (reputationDelta || 0))
  const newLikes = setLikes !== undefined ? setLikes : (Number(user.likes_received || 0) + (likesDelta || 0))
  const newFollowers = setFollowers !== undefined ? setFollowers : (Number(user.followers_count || 0) + (followersDelta || 0))
  const newModerator = setModerator !== undefined ? (setModerator ? 1 : 0) : Number(user.is_moderator || 0)
  const newAdmin = setAdmin !== undefined ? (setAdmin ? 1 : 0) : Number(user.is_admin || 0)

  // Daily score change keeps the legacy MAX back-compat on score_total; an
  // explicit reputation adjustment is authoritative for score_total.
  let finalReputation: number
  if (setReputation !== undefined || reputationDelta !== undefined) {
    finalReputation = newReputation
  } else if (setScore !== undefined || scoreDelta !== undefined) {
    finalReputation = Math.max(Number(user.score_total || 0), newScore)
  } else {
    finalReputation = Number(user.score_total || 0)
  }

  await c.env.DB.prepare(`
    UPDATE Users
    SET score = ?, score_total = ?, likes_received = ?, followers_count = ?, is_moderator = ?, is_admin = ?
    WHERE id = ?
  `).bind(newScore, finalReputation, newLikes, newFollowers, newModerator, newAdmin, userId).run()

  await logAdminAction(c.env.DB, orbitId, 'adjust_user', { id: userId, type: 'user' }, `score=${newScore} reputation=${finalReputation} likes=${newLikes} followers=${newFollowers} mod=${newModerator}`)

  // Wallet (g$) adjustments go through the authoritative economy so they are
  // ledgered and audited, never written directly.
  let balance: number | null = null
  if (gcoinsDelta !== undefined && gcoinsDelta !== 0) {
    const economy = new EconomyService(c.env.DB)
    const ref = `admin:${orbitId}`
    if (gcoinsDelta > 0) {
      await economy.credit(userId, gcoinsDelta, { idempotencyKey: `admin-gcoins-${crypto.randomUUID()}`, kind: 'adjustment', reference: ref })
    } else {
      try {
        await economy.debit(userId, Math.abs(gcoinsDelta), { idempotencyKey: `admin-gcoins-${crypto.randomUUID()}`, kind: 'adjustment', reference: ref })
      } catch (err: any) {
        if (err?.code === 'INSUFFICIENT_FUNDS') {
          return c.json({ error: 'Insufficient wallet funds for adjustment' }, 409)
        }
        throw err
      }
    }
    balance = await economy.getBalance(userId)
    await logAdminAction(c.env.DB, orbitId, 'adjust_wallet', { id: userId, type: 'user' }, `gcoins_delta=${gcoinsDelta} balance=${balance}`)
  }

  return c.json({
    success: true,
    user: {
      id: userId,
      score: newScore,
      reputation: finalReputation,
      likes_received: newLikes,
      followers_count: newFollowers,
      is_moderator: Boolean(newModerator),
      is_admin: Boolean(newAdmin),
      balance,
    }
  })
})

// Clean all posts / reset feed data
admin.post('/database/clean-posts', async (c) => {
  const orbitId = c.get('orbitId')

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM CommentLikes'),
    c.env.DB.prepare('DELETE FROM Comments'),
    c.env.DB.prepare('DELETE FROM PostLikes'),
    c.env.DB.prepare('DELETE FROM Saves'),
    c.env.DB.prepare('DELETE FROM Objects WHERE is_public = 1'),
    c.env.DB.prepare('UPDATE Users SET posts_count = 0'),
  ])

  await logAdminAction(c.env.DB, orbitId, 'clean_posts', { id: 'global', type: 'database' }, 'Wiped all public posts and comments')

  return c.json({ success: true, message: 'All posts and comments have been cleaned' })
})

// Migrate all lobby images to user posts under their gMatch profile
admin.post('/database/migrate-lobby-to-posts', async (c) => {
  const orbitId = c.get('orbitId')
  const migratedCount = await promoteLobbyImagesToPosts(c.env.DB, c.env.BUCKET)
  await c.env.DB.prepare(`UPDATE Users SET posts_count = (SELECT COUNT(*) FROM Objects WHERE Objects.owner_id = Users.id AND Objects.is_public = 1)`).run()

  await logAdminAction(c.env.DB, orbitId, 'migrate_lobby_images', { id: 'global', type: 'database' }, `Migrated ${migratedCount} lobby images to posts`)

  return c.json({ success: true, migrated_count: migratedCount })
})

// Replace a user's discovery tags (moderation: strip offensive tags)
admin.patch('/users/:id/tags', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')
  let tags: string[] = []
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.tags)) {
      tags = body.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8)
    }
  } catch { }
  await c.env.DB.prepare('UPDATE Users SET tags = ? WHERE id = ?').bind(JSON.stringify(tags), userId).run()
  await logAdminAction(c.env.DB, orbitId, 'edit_tags', { id: userId, type: 'user' }, JSON.stringify(tags))
  return c.json({ success: true, tags })
})

// Hard-delete a user account via the same cascade the self-service flow uses
admin.post('/users/:id/delete', async (c) => {
  const orbitId = c.get('orbitId')
  const userId = c.req.param('id')
  const user = await c.env.DB.prepare('SELECT 1 FROM Users WHERE id = ?').bind(userId).first()
  if (!user) return c.json({ error: 'User not found' }, 404)
  await deleteUserCascade(c.env.DB, userId, { BUCKET: c.env.BUCKET })
  await c.env.DB.prepare('DELETE FROM Bans WHERE user_id = ?').bind(userId).run()
  await logAdminAction(c.env.DB, orbitId, 'delete_user', { id: userId, type: 'user' })
  return c.json({ success: true, deleted: userId })
})

// List all announcements (admin)
admin.get('/announcements', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT a.id, a.message, COALESCE(a.is_active, 1) as is_active, a.created_at, u.display_name as created_by_name
    FROM Announcements a
    LEFT JOIN Users u ON a.created_by = u.id
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all()

  return c.json(results || [])
})

// Create announcement with active status
admin.post('/announcements', async (c) => {
  const orbitId = c.get('orbitId')
  let message = ''
  let isActive = 1
  try {
    const body = await c.req.json()
    if (body?.message) message = String(body.message).substring(0, 1000)
    if (typeof body?.is_active === 'boolean' || typeof body?.is_active === 'number') {
      isActive = body.is_active ? 1 : 0
    }
  } catch { }

  if (!message.trim()) return c.json({ error: 'Message is required' }, 400)

  // Deactivate existing announcements if active
  if (isActive === 1) {
    await c.env.DB.prepare('UPDATE Announcements SET is_active = 0').run()
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO Announcements (id, message, created_by, is_active) VALUES (?, ?, ?, ?)').bind(id, message.trim(), orbitId, isActive).run()
  await logAdminAction(c.env.DB, orbitId, 'create_announcement', { id, type: 'announcement' }, message.trim().substring(0, 120))

  return c.json({ success: true, id })
})

// Toggle announcement active status
admin.patch('/announcements/:id/toggle', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const current = (await c.env.DB.prepare('SELECT is_active FROM Announcements WHERE id = ?').bind(id).first()) as { is_active: number } | null
  if (!current) return c.json({ error: 'Announcement not found' }, 404)

  const nextStatus = current.is_active ? 0 : 1
  if (nextStatus === 1) {
    await c.env.DB.prepare('UPDATE Announcements SET is_active = 0').run()
  }

  await c.env.DB.prepare('UPDATE Announcements SET is_active = ? WHERE id = ?').bind(nextStatus, id).run()
  await logAdminAction(c.env.DB, orbitId, 'toggle_announcement', { id, type: 'announcement' }, `is_active=${nextStatus}`)

  return c.json({ success: true, is_active: nextStatus })
})

// Delete announcement
admin.delete('/announcements/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM Announcements WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, orbitId, 'delete_announcement', { id, type: 'announcement' })
  return c.json({ success: true })
})

// Admin recommendations list
admin.get('/recommendations', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.user_id, r.category, r.content, r.status, r.created_at, u.display_name as user_name
    FROM Recommendations r
    LEFT JOIN Users u ON r.user_id = u.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all()

  return c.json(results || [])
})

// Update recommendation status (pending, reviewed, resolved)
admin.patch('/recommendations/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  let status = 'pending'
  try {
    const body = await c.req.json()
    if (body?.status && ['pending', 'reviewed', 'resolved'].includes(body.status)) {
      status = body.status
    }
  } catch { }

  await c.env.DB.prepare('UPDATE Recommendations SET status = ? WHERE id = ?').bind(status, id).run()
  await logAdminAction(c.env.DB, orbitId, 'update_recommendation', { id, type: 'recommendation' }, `status=${status}`)
  return c.json({ success: true, status })
})

// Delete recommendation
admin.delete('/recommendations/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM Recommendations WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, orbitId, 'delete_recommendation', { id, type: 'recommendation' })
  return c.json({ success: true })
})

// Admin-manageable platform settings (SystemMeta-backed)
admin.get('/settings/discord-invite', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM SystemMeta WHERE key = 'discord_invite_url'").bind().first() as { value: string } | null
  return c.json({ url: row?.value ?? null })
})

admin.put('/settings/discord-invite', async (c) => {
  const orbitId = c.get('orbitId')
  let url = ''
  try {
    const body = await c.req.json()
    if (typeof body?.url === 'string') url = String(body.url).trim()
  } catch { }

  if (url !== '' && !/^https?:\/\/\S+$/i.test(url)) {
    return c.json({ error: 'URL must start with http:// or https://' }, 400)
  }

  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('discord_invite_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(url).run()
  await logAdminAction(c.env.DB, orbitId, 'set_discord_invite', null, url)

  return c.json({ success: true, url })
})

admin.get('/settings/store-prices', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM SystemMeta WHERE key = 'store_prices'").bind().first() as { value: string } | null
  let prices: Record<string, number> = {}
  if (row?.value) {
    try {
      prices = JSON.parse(row.value)
    } catch { }
  }
  return c.json({ prices })
})

admin.put('/settings/store-prices', async (c) => {
  const adminId = c.get('orbitId')
  const prices: Record<string, number> = {}
  try {
    const body = await c.req.json()
    if (body?.prices && typeof body.prices === 'object') {
      for (const [k, v] of Object.entries(body.prices)) {
        const num = Number(v)
        if (!isNaN(num) && num >= 0) {
          prices[k] = Math.floor(num)
        }
      }
    }
  } catch { }

  const serialized = JSON.stringify(prices)
  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('store_prices', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(serialized).run()
  await logAdminAction(c.env.DB, adminId, 'set_store_prices', null, serialized)

  return c.json({ success: true, prices })
})

// Economy cashout rate (inflation). Controls how many g$ a card is worth when
// cashed out. Stored in basis points and clamped server-side to legal bounds.
admin.get('/settings/economy', async (c) => {
  const rateBps = await getCashoutRateBps(c.env.DB)
  return c.json({ cashoutRateBps: rateBps })
})

admin.put('/settings/economy', async (c) => {
  const adminId = c.get('orbitId')
  let rateBps = clampCashoutRateBps(null)
  try {
    const body = await c.req.json()
    rateBps = clampCashoutRateBps(Number(body?.cashoutRateBps))
  } catch { }

  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('economy_cashout_rate_bps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(rateBps)).run()
  await logAdminAction(c.env.DB, adminId, 'set_economy_cashout_rate', null, String(rateBps))

  return c.json({ success: true, cashoutRateBps: rateBps })
})

// ─── Lootbox management: admins create + individually release lootboxes ───

admin.get('/settings/lootboxes', async (c) => {
  const lootboxes = await listLootboxes(c.env.DB)
  return c.json({ lootboxes })
})

admin.post('/settings/lootboxes', async (c) => {
  const adminId = c.get('orbitId')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const name = String(body?.name || '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)
  const id = body?.id && typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID()
  const cost = Math.max(0, Math.floor(Number(body?.cost) || 0))
  const cardCount = Math.min(Math.max(1, Math.floor(Number(body?.card_count) || 3)), 20)
  const rarityTheme = String(body?.rarity_theme || 'rare')
  const icon = body?.icon ? String(body.icon) : 'Sparkles'
  const badge = body?.badge ? String(body.badge) : null
  const desc = body?.desc ? String(body.desc).slice(0, 500) : null
  const tags = normalizeTags(body?.tags)
  const drawConfig = normalizeDrawConfig(body?.draw_config)
  const state: LootboxState = isValidState(body?.state) ? body.state : (body?.released ? 'released' : 'draft')
  const released = state === 'released' ? 1 : 0
  const nowIso = new Date().toISOString()

  await c.env.DB
    .prepare('INSERT INTO Lootboxes (id, name, desc, cost, card_count, rarity_theme, icon, badge, released, state, tags, draw_config, version, released_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, name, desc, cost, cardCount, rarityTheme, icon, badge, released, state, JSON.stringify(tags), JSON.stringify(drawConfig), state === 'released' ? nowIso : null, adminId)
    .run()
  await logAdminAction(c.env.DB, adminId, 'create_lootbox', { id, type: 'lootbox' }, `${name} (state=${state})`)

  return c.json({ success: true, id, state, tags })
})

admin.patch('/settings/lootboxes/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const existing = await getLootbox(c.env.DB, id)
  if (!existing) return c.json({ error: 'Lootbox not found' }, 404)

  const name = body?.name !== undefined ? String(body.name).trim() || existing.name : existing.name
  const desc = body?.desc !== undefined ? (body.desc ? String(body.desc).slice(0, 500) : null) : existing.desc
  const cost = body?.cost !== undefined ? Math.max(0, Math.floor(Number(body.cost))) : existing.cost
  const cardCount = body?.card_count !== undefined ? Math.min(Math.max(1, Math.floor(Number(body.card_count))), 20) : existing.card_count
  const rarityTheme = body?.rarity_theme !== undefined ? String(body.rarity_theme) : existing.rarity_theme
  const icon = body?.icon !== undefined ? String(body.icon) : existing.icon
  const badge = body?.badge !== undefined ? (body.badge ? String(body.badge) : null) : existing.badge
  const tags = body?.tags !== undefined ? normalizeTags(body.tags) : existing.tags
  const drawConfig = body?.draw_config !== undefined ? normalizeDrawConfig(body.draw_config) : existing.draw_config

  // Explicit `state` wins, else the legacy `released` boolean maps to a state.
  let nextState: LootboxState = existing.state
  if (isValidState(body?.state)) nextState = body.state
  else if (typeof body?.released === 'boolean') nextState = body.released ? 'released' : 'draft'

  if (existing.state === 'archived' && nextState !== 'archived') {
    return c.json({ error: 'Archived lootboxes are immutable' }, 409)
  }

  const transition = stateTransition(existing.state, nextState)
  const released = transition ? transition.released : (nextState === 'released' ? 1 : 0)
  const releasedAt = transition ? transition.released_at : existing.released_at
  const archivedAt = transition ? transition.archived_at : existing.archived_at
  const version = transition && nextState === 'released' ? existing.version + 1 : existing.version

  await c.env.DB
    .prepare('UPDATE Lootboxes SET name = ?, desc = ?, cost = ?, card_count = ?, rarity_theme = ?, icon = ?, badge = ?, released = ?, state = ?, tags = ?, draw_config = ?, version = ?, released_at = ?, archived_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(name, desc, cost, cardCount, rarityTheme, icon, badge, released, nextState, JSON.stringify(tags), JSON.stringify(drawConfig), version, releasedAt, archivedAt, adminId, id)
    .run()
  await logAdminAction(c.env.DB, adminId, 'update_lootbox', { id, type: 'lootbox' }, `state=${nextState}`)

  return c.json({ success: true, state: nextState, tags, version })
})

admin.delete('/settings/lootboxes/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const existing = await getLootbox(c.env.DB, id)
  if (!existing) return c.json({ error: 'Lootbox not found' }, 404)
  // Archive instead of hard-delete so already-purchased inventory stays openable.
  await c.env.DB
    .prepare("UPDATE Lootboxes SET state = 'archived', released = 0, archived_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(new Date().toISOString(), adminId, id)
    .run()
  await logAdminAction(c.env.DB, adminId, 'archive_lootbox', { id, type: 'lootbox' })
  return c.json({ success: true })
})

// ─── Bot & Image API Configuration & Connection Diagnostics ───

admin.get('/bot-config', async (c) => {
  const config = await getBotConfig(c.env.DB)
  return c.json(config)
})

admin.put('/bot-config', async (c) => {
  const adminId = c.get('orbitId')
  let body: any = {}
  try {
    body = await c.req.json()
  } catch { }

  const configUpdates: any = {}
  if (Array.isArray(body.providers)) {
    const providers = body.providers.map((p: any, idx: number) => ({
      id: p.id || `prov_${idx + 1}`,
      name: p.name || `API Provider ${idx + 1}`,
      providerType: p.providerType || 'generic',
      url: (p.url || '').trim(),
      apiKey: (p.apiKey || '').trim(),
      userId: (p.userId || '').trim(),
      customHeaders: p.customHeaders || {},
      tags: Array.isArray(p.tags)
        ? p.tags
        : typeof p.tags === 'string'
          ? p.tags.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean)
          : [],
      enabled: p.enabled !== false,
      weight: typeof p.weight === 'number' ? p.weight : 10,
    }))

    // Reject providers that point at localhost / private / metadata endpoints.
    for (const provider of providers) {
      if (!provider.url) continue
      const check = validateProviderUrl(provider.url)
      if (!check.ok) {
        return c.json({ error: `Provider "${provider.name}": ${check.error}` }, 400)
      }
    }

    configUpdates.providers = providers
  }
  if (typeof body.apiUrl === 'string') configUpdates.apiUrl = body.apiUrl.trim()
  if (typeof body.apiKey === 'string') configUpdates.apiKey = body.apiKey.trim()
  if (typeof body.userId === 'string') configUpdates.userId = body.userId.trim()
  if (Array.isArray(body.tags)) configUpdates.tags = body.tags
  else if (typeof body.tags === 'string') configUpdates.tags = body.tags.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean)
  if (Array.isArray(body.names)) configUpdates.names = body.names
  else if (typeof body.names === 'string') configUpdates.names = body.names.split(/[\n,]+/).map((n: string) => n.trim()).filter(Boolean)
  if (typeof body.enabled === 'boolean') configUpdates.enabled = body.enabled

  // Activation/fallback/model settings the admin panel sends must survive the
  // round trip (previously accepted by the UI but discarded by this route).
  const ALLOWED_RULES = new Set(['immediate', 'fallback', 'manual_only', 'disabled'])
  if (typeof body.activationRule === 'string') {
    const rule = String(body.activationRule).trim()
    if (!ALLOWED_RULES.has(rule)) {
      return c.json({ error: 'Invalid activationRule' }, 400)
    }
    configUpdates.activationRule = rule
  }
  if (body.fallbackSeconds !== undefined) {
    const seconds = Number(body.fallbackSeconds)
    if (!Number.isFinite(seconds)) {
      return c.json({ error: 'fallbackSeconds must be a number' }, 400)
    }
    configUpdates.fallbackSeconds = Math.max(0, Math.floor(seconds))
  }
  if (Array.isArray(body.models)) {
    configUpdates.models = body.models.map((m: any) => String(m).trim()).filter(Boolean)
  } else if (typeof body.models === 'string') {
    configUpdates.models = body.models.split(/[\n,]+/).map((m: string) => m.trim()).filter(Boolean)
  }

  await saveBotConfig(c.env.DB, configUpdates)
  await logAdminAction(c.env.DB, adminId, 'update_bot_config', null, JSON.stringify({
    providersCount: configUpdates.providers?.length,
    enabled: configUpdates.enabled,
  }))

  const updated = await getBotConfig(c.env.DB)
  return c.json({ success: true, config: updated })
})

admin.post('/bot-config/test', async (c) => {
  let body: any = {}
  try {
    body = await c.req.json()
  } catch { }

  const current = await getBotConfig(c.env.DB)
  const provider = body.provider || body
  const apiUrl = (typeof provider.url === 'string' && provider.url.trim())
    ? provider.url.trim()
    : (typeof body.apiUrl === 'string' && body.apiUrl.trim())
      ? body.apiUrl.trim()
      : (current.providers[0]?.url || current.apiUrl || 'https://api.waifu.im/search')

  const apiKey = provider.apiKey !== undefined
    ? String(provider.apiKey).trim()
    : body.apiKey !== undefined
      ? String(body.apiKey).trim()
      : (current.providers[0]?.apiKey || current.apiKey || '')

  const userId = provider.userId !== undefined
    ? String(provider.userId).trim()
    : body.userId !== undefined
      ? String(body.userId).trim()
      : (current.providers[0]?.userId || current.userId || '')

  const providerType = provider.providerType || body.providerType

  const tags = Array.isArray(provider.tags)
    ? provider.tags
    : typeof provider.tags === 'string'
      ? provider.tags.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean)
      : Array.isArray(body.tags)
        ? body.tags
        : typeof body.tags === 'string'
          ? body.tags.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean)
          : (current.providers[0]?.tags || current.tags || [])

  const testResult = await testBotApi(
    {
      url: apiUrl,
      apiKey,
      userId,
      providerType,
      tags,
    },
    apiKey,
    tags,
    userId,
    providerType
  )

  return c.json(testResult)
})

admin.post('/bot-config/sync-images', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch { }
  const playerTags = Array.isArray(body.tags) ? body.tags : undefined
  const cached = await refreshBotImageCache(c.env.DB, 20, playerTags)
  return c.json({ success: true, cachedCount: cached.length, samples: cached.slice(0, 5).map(c => c.url) })
})

// ─── Persistent Bot Duelist Profiles ───
// Each bot is an independently editable identity (name, tags, picture) backed
// by the Bots table. Pictures are resolved from the bot's own tags against the
// configured booru providers, or set manually. Every write also syncs the bot's
// Users row so its name/tags/picture are visible in the roster and matches.

function sanitizeBotTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw.split(/[\n,]+/).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean)
  }
  return []
}

admin.get('/bots', async (c) => {
  const bots = await getBotProfiles(c.env.DB)
  return c.json({ bots })
})

admin.post('/bots', async (c) => {
  const adminId = c.get('orbitId')
  let body: any = {}
  try { body = await c.req.json() } catch { }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : ''
  if (!name) return c.json({ error: 'name is required' }, 400)

  const tags = sanitizeBotTags(body.tags)
  const rawId = typeof body.id === 'string' && body.id.trim()
    ? body.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^bot_/, '')
    : crypto.randomUUID()
  const id = `bot_${rawId}`

  const saved = await saveBotProfile(c.env.DB, {
    id,
    name,
    tags,
    color: typeof body.color === 'string' && body.color.trim() ? body.color.trim() : null,
    enabled: body.enabled !== false,
  })
  await ensureBotReady(c.env.DB, { id: saved.id, name: saved.name, tags: saved.tags, col: saved.color || '', pfp_url: saved.pfp_url })
  await logAdminAction(c.env.DB, adminId, 'create_bot', { id: saved.id }, JSON.stringify({ name, tags }))
  return c.json({ success: true, bot: saved }, 201)
})

admin.put('/bots/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id') || ''
  const existing = await c.env.DB.prepare('SELECT id FROM Bots WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'Bot not found' }, 404)

  let body: any = {}
  try { body = await c.req.json() } catch { }

  const updates: any = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim().slice(0, 32)
  if (body.tags !== undefined) updates.tags = sanitizeBotTags(body.tags)
  if (body.color !== undefined) updates.color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : null
  if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled)
  if (body.pfp_url !== undefined) updates.pfp_url = typeof body.pfp_url === 'string' && body.pfp_url.trim() ? body.pfp_url.trim() : null

  const saved = await saveBotProfile(c.env.DB, { id, ...updates })
  await ensureBotReady(c.env.DB, { id: saved.id, name: saved.name, tags: saved.tags, col: saved.color || '', pfp_url: saved.pfp_url })

  // A disabled bot must not sit in the queue — purge it from LobbyPlayers so
  // it never appears as an eternally-waiting entry (and can't be paired).
  if (updates.enabled === false) {
    await c.env.DB.prepare("DELETE FROM LobbyPlayers WHERE user_id = ?").bind(id).run().catch(() => {})
  }

  await logAdminAction(c.env.DB, adminId, 'update_bot', { id }, JSON.stringify(updates))
  return c.json({ success: true, bot: saved })
})

admin.delete('/bots/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id') || ''
  const existing = await c.env.DB.prepare('SELECT id, enabled FROM Bots WHERE id = ?').bind(id).first<{ id: string; enabled: number }>()
  if (!existing) return c.json({ error: 'Bot not found' }, 404)

  // Keep the arcade duelist pool from ever emptying entirely. Only an enabled
  // bot that is the sole remaining enabled one is protected — deleting a
  // disabled bot never reduces the active pool.
  if (Number(existing.enabled ?? 0) === 1) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM Bots WHERE enabled = 1').first<{ n: number }>()
    if (Number(countRow?.n ?? 0) <= 1) {
      return c.json({ error: 'Cannot delete the last enabled bot' }, 409)
    }
  }

  const removed = await deleteBotProfile(c.env.DB, id)
  if (!removed) return c.json({ error: 'Bot not found' }, 404)
  await logAdminAction(c.env.DB, adminId, 'delete_bot', { id }, null)
  return c.json({ success: true })
})

// Regenerate a bot's picture from its tags (or persist an admin-supplied URL).
admin.post('/bots/:id/picture', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id') || ''
  let body: any = {}
  try { body = await c.req.json() } catch { }
  const customUrl = typeof body.customUrl === 'string' && body.customUrl.trim() ? body.customUrl.trim() : ''

  const result = await generateBotPicture(c.env.DB, id, customUrl || undefined)
  if (!result.ok) return c.json({ error: result.error }, 400)

  await ensureBotReady(c.env.DB, { id: result.bot.id, name: result.bot.name, tags: result.bot.tags, col: result.bot.color || '', pfp_url: result.bot.pfp_url })
  await logAdminAction(c.env.DB, adminId, 'refresh_bot_picture', { id }, JSON.stringify({ url: result.bot.pfp_url }))
  return c.json({ success: true, bot: result.bot })
})

// Trigger explicit maintenance sweep & vacuum
admin.post('/cleanup', async (c) => {
  const stats = await runPeriodicMaintenance(c.env.DB, c.env.BUCKET, Date.now(), true)
  const adminId = c.get('orbitId')
  await logAdminAction(c.env.DB, adminId, 'cleanup', null, 'Triggered DB maintenance & vacuum')
  return c.json({ success: true, stats })
})

// ─── D3: Lobby comments moderation ───────────────────────────────────────

admin.get('/lobby-comments', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.image_id, c.user_id, c.body, c.created_at, c.hidden_at,
           u.display_name as user_name,
           li.content_url as image_content_url, li.caption as image_caption
    FROM LobbyComments c
    LEFT JOIN Users u ON u.id = c.user_id
    LEFT JOIN LobbyImages li ON li.id = c.image_id
    ORDER BY CASE WHEN c.hidden_at IS NULL THEN 0 ELSE 1 END, c.created_at DESC
    LIMIT 200
  `).all()
  return c.json(results || [])
})

admin.post('/lobby-comments/:id/hide', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE LobbyComments SET hidden_at = CURRENT_TIMESTAMP WHERE id = ? AND hidden_at IS NULL').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'hide_comment', { id, type: 'lobby_comment' })
  return c.json({ ok: true })
})

admin.post('/lobby-comments/:id/unhide', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE LobbyComments SET hidden_at = NULL WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'unhide_comment', { id, type: 'lobby_comment' })
  return c.json({ ok: true })
})

admin.delete('/lobby-comments/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM LobbyComments WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'delete_comment', { id, type: 'lobby_comment' }, 'Hard delete from admin panel')
  return c.json({ ok: true })
})

// ─── D4: Private messages moderation (server-stored, plaintext per design) ──

admin.get('/private-messages', async (c) => {
  let userId = (c.req.query('user_id') || '').trim()
  let limit = Math.min(Math.max(Number(c.req.query('limit') || 200), 1), 500)
  try {
    const body = await c.req.json().catch(() => null)
    if (body?.user_id && typeof body.user_id === 'string') userId = body.user_id.trim()
    if (body?.limit && Number.isFinite(body.limit)) limit = Math.min(Math.max(1, Number(body.limit)), 500)
  } catch { }
  const sql = userId
    ? `SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at, pm.deleted_by, pm.hidden_at,
              pm.attachment_id, o.content_url as attachment_url, o.mime_type as attachment_mime,
              s.display_name as sender_name, r.display_name as recipient_name
       FROM PrivateMessages pm
       LEFT JOIN Users s ON s.id = pm.sender_id
       LEFT JOIN Users r ON r.id = pm.recipient_id
       LEFT JOIN Objects o ON o.id = pm.attachment_id
       WHERE (pm.sender_id = ? OR pm.recipient_id = ?)
       ORDER BY pm.created_at DESC LIMIT ?`
    : `SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at, pm.deleted_by, pm.hidden_at,
              pm.attachment_id, o.content_url as attachment_url, o.mime_type as attachment_mime,
              s.display_name as sender_name, r.display_name as recipient_name
       FROM PrivateMessages pm
       LEFT JOIN Users s ON s.id = pm.sender_id
       LEFT JOIN Users r ON r.id = pm.recipient_id
       LEFT JOIN Objects o ON o.id = pm.attachment_id
       ORDER BY pm.created_at DESC LIMIT ?`
  const stmt = userId ? c.env.DB.prepare(sql).bind(userId, userId, limit) : c.env.DB.prepare(sql).bind(limit)
  const { results } = await stmt.all()
  const rows = (results || []).map((r: any) => ({ ...r, body: decryptText(r.body ?? '') }))
  return c.json(rows)
})

admin.post('/private-messages/:id/hide', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE PrivateMessages SET hidden_at = CURRENT_TIMESTAMP WHERE id = ? AND hidden_at IS NULL').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'hide_pm', { id, type: 'private_message' })
  return c.json({ ok: true })
})

admin.delete('/private-messages/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, adminId, 'delete_pm', { id, type: 'private_message' }, 'Hard delete from admin panel')
  return c.json({ ok: true })
})

// ─── D5: Admin audit log read-only viewer ────────────────────────────────

admin.get('/audit-log', async (c) => {
  let limit = 200
  try {
    const q = c.req.query('limit')
    if (q) limit = Math.min(Math.max(1, parseInt(q, 10) || 200), 500)
  } catch { }
  const { results } = await c.env.DB.prepare(`
    SELECT a.id, a.admin_id, a.action, a.target_id, a.target_type, a.reason, a.created_at,
           u.display_name as admin_name
    FROM AdminAuditLog a
    LEFT JOIN Users u ON u.id = a.admin_id
    ORDER BY a.created_at DESC
    LIMIT ?
  `).bind(limit).all()
  return c.json(results || [])
})

// ─── D6: Daily aggregate stats (backfilled by cleanup.ts, surfaced here) ──

admin.get('/daily-stats', async (c) => {
  let days = 30
  try {
    const q = c.req.query('days')
    if (q) days = Math.min(Math.max(1, parseInt(q, 10) || 30), 90)
  } catch { }
  const { results } = await c.env.DB.prepare(`
    SELECT date, active_users, matches_played, peak_concurrent, new_users, banned_users, reports_opened
    FROM DailyStats
    ORDER BY date DESC
    LIMIT ?
  `).bind(days).all()
  return c.json(results || [])
})

// ─── D7: Inbound traffic-source aggregation (referrer attribution) ───────

admin.get('/traffic-sources', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT source, COUNT(*) as visits, DATE(MAX(created_at)) as last_seen, DATE(MIN(created_at)) as first_seen
    FROM TrafficSources
    GROUP BY source
    ORDER BY visits DESC
  `).all<any>()
  const rows = results || []
  const total = rows.reduce((acc: number, r: any) => acc + Number(r.visits || 0), 0)
  return c.json({ sources: rows, total })
})

// ─── D7: Lobby Chat moderation ──────────────────────────────────────────

admin.get('/chat', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id, sender_id, sender_name, body, created_at
    FROM LobbyChat
    ORDER BY created_at DESC
    LIMIT 100
  `).all()
  return c.json(results || [])
})

admin.get('/chat/messages', async (c) => {
  const channel = c.req.query('channel') || 'all'
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const limit = Math.min(100, Math.max(10, parseInt(c.req.query('limit') || '50', 10)))

  const results: Array<{
    id: string
    channel: string
    sender_id: string
    sender_name: string | null
    recipient_id?: string | null
    recipient_name?: string | null
    body: string
    created_at: string
    attachment_id?: string | null
    attachment_url?: string | null
    attachment_mime?: string | null
  }> = []

  // 1. LobbyChat messages
  if (channel === 'all' || channel === 'lobby') {
    try {
      const rows = await c.env.DB.prepare(`
        SELECT lc.id, lc.sender_id, lc.body, lc.created_at,
               COALESCE(lc.sender_name, u.display_name) as sender_name
        FROM LobbyChat lc
        LEFT JOIN Users u ON lc.sender_id = u.id
        ${channel === 'lobby' ? "WHERE lc.channel = 'global_lobby'" : ''}
        ORDER BY lc.created_at DESC
        LIMIT ?
      `).bind(limit).all<any>()
      for (const r of rows.results || []) {
        if (!q || (r.body && r.body.toLowerCase().includes(q)) || (r.sender_name && r.sender_name.toLowerCase().includes(q))) {
          results.push({
            id: r.id,
            channel: 'lobby',
            sender_id: r.sender_id,
            sender_name: r.sender_name,
            body: r.body,
            created_at: r.created_at,
          })
        }
      }
    } catch { }
  }

  // 2. PrivateMessages (DMs)
  if (channel === 'all' || channel === 'dm') {
    try {
      const rows = await c.env.DB.prepare(`
        SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at,
               pm.attachment_id, o.content_url as attachment_url, o.mime_type as attachment_mime,
               us.display_name as sender_name, ur.display_name as recipient_name
        FROM PrivateMessages pm
        LEFT JOIN Users us ON pm.sender_id = us.id
        LEFT JOIN Users ur ON pm.recipient_id = ur.id
        LEFT JOIN Objects o ON o.id = pm.attachment_id
        WHERE pm.deleted_by IS NULL
        ORDER BY pm.created_at DESC
        LIMIT ?
      `).bind(limit).all<any>()
      for (const r of rows.results || []) {
        const plainBody = decryptText(r.body ?? '')
        if (!q || (plainBody && plainBody.toLowerCase().includes(q)) || (r.sender_name && r.sender_name.toLowerCase().includes(q))) {
          results.push({
            id: r.id,
            channel: 'dm',
            sender_id: r.sender_id,
            sender_name: r.sender_name,
            recipient_id: r.recipient_id,
            recipient_name: r.recipient_name,
            body: plainBody,
            created_at: r.created_at,
            attachment_id: r.attachment_id ?? null,
            attachment_url: r.attachment_url ?? null,
            attachment_mime: r.attachment_mime ?? null,
          })
        }
      }
    } catch { }
  }

  // 3. Match chat. This is intentionally read-only in the game workspace until
  // an admin explicitly deletes a message through the danger action below.
  if (channel === 'all' || channel === 'match') {
    try {
      const rows = await c.env.DB.prepare(`
        SELECT mc.id, mc.match_id, mc.sender_id, mc.sender_name, mc.body, mc.created_at
        FROM MatchChat mc ORDER BY mc.created_at DESC LIMIT ?
      `).bind(limit).all<any>()
      for (const r of rows.results || []) {
        if (!q || String(r.body || '').toLowerCase().includes(q) || String(r.sender_name || '').toLowerCase().includes(q)) {
          results.push({ id: r.id, channel: 'match', sender_id: r.sender_id, sender_name: r.sender_name, recipient_id: r.match_id, body: r.body, created_at: r.created_at })
        }
      }
    } catch { }
  }

  // 4. User-created group chat.
  if (channel === 'all' || channel === 'group') {
    try {
      const rows = await c.env.DB.prepare(`
        SELECT gm.id, gm.group_id, gm.sender_id, gm.body, gm.created_at,
               gm.attachment_id, o.content_url as attachment_url, o.mime_type as attachment_mime,
               u.display_name AS sender_name, cg.name AS group_name
        FROM GroupMessages gm
        LEFT JOIN Users u ON u.id = gm.sender_id
        LEFT JOIN ChatGroups cg ON cg.id = gm.group_id
        LEFT JOIN Objects o ON o.id = gm.attachment_id
        ORDER BY gm.created_at DESC LIMIT ?
      `).bind(limit).all<any>()
      for (const r of rows.results || []) {
        if (!q || String(r.body || '').toLowerCase().includes(q) || String(r.sender_name || '').toLowerCase().includes(q) || String(r.group_name || '').toLowerCase().includes(q)) {
          results.push({ id: r.id, channel: 'group', sender_id: r.sender_id, sender_name: r.sender_name, recipient_id: r.group_id, recipient_name: r.group_name, body: r.body, created_at: r.created_at, attachment_id: r.attachment_id ?? null, attachment_url: r.attachment_url ?? null, attachment_mime: r.attachment_mime ?? null })
        }
      }
    } catch { }
  }

  // Sort by created_at DESC
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return c.json(results.slice(0, limit))
})

admin.delete('/chat/messages/:channel/:id', async (c) => {
  const adminId = c.get('orbitId')
  const channel = c.req.param('channel')
  const id = c.req.param('id')

  if (channel === 'lobby') {
    await c.env.DB.prepare('DELETE FROM LobbyChat WHERE id = ?').bind(id).run().catch(() => { })
  } else if (channel === 'dm') {
    await c.env.DB.prepare("UPDATE PrivateMessages SET deleted_by = ?, hidden_at = datetime('now') WHERE id = ?").bind(adminId, id).run().catch(() => { })
  } else if (channel === 'match') {
    await c.env.DB.prepare('DELETE FROM MatchChat WHERE id = ?').bind(id).run().catch(() => { })
  } else if (channel === 'group') {
    await c.env.DB.prepare('DELETE FROM GroupMessages WHERE id = ?').bind(id).run().catch(() => { })
  }

  await logAdminAction(c.env.DB, adminId, 'delete_chat_message', { id, type: channel })
  return c.json({ ok: true })
})

admin.delete('/chat/:id', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM LobbyChat WHERE id = ?').bind(id).run()
  broadcastToRoom('lobby', { type: 'lobby-chat', action: 'delete', message_id: id })
  broadcastToRoom('global', { type: 'lobby-chat', action: 'delete', message_id: id })
  await logAdminAction(c.env.DB, adminId, 'delete_chat_message', { id, type: 'chat_message' })
  return c.json({ ok: true })
})

admin.post('/chat/:id/ban', async (c) => {
  const adminId = c.get('orbitId')
  const id = c.req.param('id')
  const msg = await c.env.DB.prepare('SELECT sender_id FROM LobbyChat WHERE id = ?').bind(id).first<{ sender_id: string }>()
  if (!msg) return c.json({ error: 'Message not found' }, 404)

  const banId = crypto.randomUUID()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR REPLACE INTO Bans (id, user_id, reason, banned_by) VALUES (?, ?, ?, ?)').bind(banId, msg.sender_id, 'Inappropriate chat message', adminId),
    c.env.DB.prepare('DELETE FROM LobbyChat WHERE sender_id = ?').bind(msg.sender_id),
  ])
  await deleteUserCascade(c.env.DB, msg.sender_id, { BUCKET: c.env.BUCKET })
  broadcastToRoom('lobby', { type: 'user_banned', user_id: msg.sender_id })
  await logAdminAction(c.env.DB, adminId, 'ban_user_chat', { id: msg.sender_id, type: 'user' }, 'Banned via chat moderation')
  return c.json({ ok: true, banned_user_id: msg.sender_id })
})

// Public announcements endpoint for active announcement ticker
announcements.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT a.id, a.message, COALESCE(a.is_active, 1) as is_active, a.created_at, u.display_name as created_by_name
      FROM Announcements a
      LEFT JOIN Users u ON a.created_by = u.id
      WHERE COALESCE(a.is_active, 1) = 1
      ORDER BY a.created_at DESC
      LIMIT 1
    `).all()

    return c.json(results || [])
  } catch {
    return c.json([])
  }
})

export { admin, announcements }
