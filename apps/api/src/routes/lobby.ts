import { Hono } from 'hono'
import crypto from 'crypto'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { joinLobby, leaveLobby, setAutoQueue, getLobbyState, playMatchCard, setMatchDecision, quitMatch, createQuickBotMatch, getLobbyImages, setLobbyImage, likeLobbyImage, getLobbyImageLikers, addLobbyComment, getLobbyComments, deleteLobbyComment, advanceLobby, advanceLobbyUnlocked, withMatchLock, expireIdleSpecialMatches, getActiveMatches, getSpectatorSnapshot } from '../lobby'
import { getLeague } from '../rooms'
import { createWsTicket, broadcastToRoom, broadcastToUser } from '../ws-bus'
import { runPeriodicMaintenance } from '../cleanup'
import { addPoints } from '../game'
import { reportContent as serviceReportContent, ReportError } from '../reports'
import { SPECIAL_MAX_TIER, SPECIAL_TIER_POINTS, SPECIAL_FINAL_POINTS, MIN_GAME_CARDS, matchEconomy } from '@orbit/shared'
import { EconomyService } from '../economy'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const lobby = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
export const wsTicket = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

// Auth is applied per-route below so that the headerless <img src> target
// GET /images/:id/content can be fetched without X-Orbit-* headers, mirroring
// objects.get('/:id') in ./objects.ts. Do NOT re-add a blanket
// lobby.use('*', orbitAuth) — it reintroduces the 401 on the lobby board tiles.

// Run match advancement at most once per process every 2s. The lobby flow is
// already advanced eagerly by the join/card/decision mutation routes and WS
// pushes; this throttle keeps the read poll cheap while still driving captures
// and timeouts for AFK players.
let lastLobbyAdvance = 0
const LOBBY_ADVANCE_INTERVAL_MS = 2000

// Maintenance (full cleanup sweep: expired content, blob sweep, daily resets)
// is heavy enough that running it inline on every lobby poll can blow the
// Worker per-request CPU/duration budget → 502 upstream. Throttle it to at
// most once per isolate per minute; the platform-level Cloudflare Cron (and
// the boot-time migrate path) drive it elsewhere too, so this is purely a
// Public tags endpoint for Landing Page tag suggestions
lobby.get('/public-tags', async (c) => {
  try {
    const userRows = await c.env.DB.prepare(
      `SELECT tags FROM Users WHERE tags IS NOT NULL AND length(tags) > 2 LIMIT 150`
    ).all<{ tags: string }>()

    const imageRows = await c.env.DB.prepare(
      `SELECT tags FROM LobbyImages WHERE tags IS NOT NULL AND length(tags) > 0 LIMIT 150`
    ).all<{ tags: string }>()

    const tagCounts: Record<string, number> = {}
    const addTag = (t: string) => {
      const clean = t.trim().toLowerCase().replace(/^#/, '')
      if (clean && clean.length >= 2 && clean.length <= 30) {
        tagCounts[clean] = (tagCounts[clean] || 0) + 1
      }
    }

    const defaults = ['social', 'art', 'photography', 'gaming', 'fashion', 'memes', 'crypto', 'music', 'lifestyle', 'fitness', 'travel', 'design', 'tech', 'vibes', 'p2p']
    defaults.forEach((d) => { tagCounts[d] = (tagCounts[d] || 0) + 1 })

    for (const r of userRows.results || []) {
      if (r.tags) {
        try {
          const arr = JSON.parse(r.tags)
          if (Array.isArray(arr)) arr.forEach((x: any) => addTag(String(x)))
        } catch {
          r.tags.split(',').forEach(addTag)
        }
      }
    }

    for (const r of imageRows.results || []) {
      if (r.tags) {
        r.tags.split(',').forEach(addTag)
      }
    }

    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count }))

    return c.json({ tags: sortedTags })
  } catch {
    return c.json({ tags: [] })
  }
})

// safety cap, not the only trigger.
let lastMaintenanceAt = 0
const MAINTENANCE_INTERVAL_MS = 60_000

lobby.get('/', orbitAuth, async (c) => {
  const now = Date.now()
  const userId = c.get('orbitId')
  // Lazy maintenance guard — continuous expiration sweep, 3h picture wipe, and daily score reset.
  if (now - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
    lastMaintenanceAt = now
    await runPeriodicMaintenance(c.env.DB, c.env.BUCKET, now).catch(() => {})
  }
  const shouldAdvance = now - lastLobbyAdvance >= LOBBY_ADVANCE_INTERVAL_MS
  if (shouldAdvance) lastLobbyAdvance = now
  const state = await getLobbyState(c.env.DB, userId, now, shouldAdvance)

  // Attach lobby name from SystemMeta
  const nameMeta = await c.env.DB.prepare("SELECT value FROM SystemMeta WHERE key = 'lobby_name'").first<{ value: string }>()
  const lobbyName = nameMeta?.value || null

  // All recently-seen users (online in the last 60s, matching /api/users threshold)
  // Exclude bots (id LIKE 'bot_%') and admins (is_admin = 1) from the online users list
  const onlineCutoff = new Date(now - 60 * 1000).toISOString()
  const onlineUsers = await c.env.DB.prepare(
    `SELECT id, display_name, pfp_url, tags FROM Users WHERE last_seen IS NOT NULL AND datetime(last_seen) >= datetime(?) AND id NOT LIKE 'bot_%' AND COALESCE(is_admin, 0) = 0 ORDER BY last_seen DESC LIMIT 100`
  ).bind(onlineCutoff).all<{ id: string; display_name: string | null; pfp_url: string | null; tags: string | null }>()

  const safeOnlineUsers = onlineUsers.results.map(u => {
    let parsedTags: string[] = []
    if (u.tags) {
      try {
        const p = JSON.parse(u.tags)
        parsedTags = Array.isArray(p) ? p.map(String) : []
      } catch {
        parsedTags = typeof u.tags === 'string' ? u.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []
      }
    }
    return { ...u, tags: parsedTags }
  })

  return c.json({ ...state, lobby_name: lobbyName, online_users: safeOnlineUsers })
})

lobby.get('/meta', orbitAuth, async (c) => {
  const nameMeta = await c.env.DB.prepare("SELECT value FROM SystemMeta WHERE key = 'lobby_name'").first<{ value: string }>()
  return c.json({ lobby_name: nameMeta?.value || null })
})

lobby.put('/meta', orbitAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}) as { name?: string })
  const name = typeof (body as any).name === 'string' ? (body as any).name.trim().slice(0, 64) : null
  if (!name) {
    await c.env.DB.prepare("DELETE FROM SystemMeta WHERE key = 'lobby_name'").run()
    broadcastToRoom('lobby', { type: 'lobby', action: 'meta', lobby_name: null })
    return c.json({ ok: true, lobby_name: null })
  }
  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('lobby_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(name).run()
  broadcastToRoom('lobby', { type: 'lobby', action: 'meta', lobby_name: name })
  return c.json({ ok: true, lobby_name: name })
})


lobby.get('/special', orbitAuth, async (c) => {
  const userId = c.get('orbitId')
  await expireIdleSpecialMatches(c.env.DB)
  const decorate = async (match: any) => {
    const opponentId = match.user_a === userId ? match.user_b : match.user_a
    const opponent = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(opponentId).first<{ display_name: string | null }>()
    return { ...match, opponent_id: opponentId, opponent_name: opponent?.display_name?.trim() || 'Unknown User' }
  }
  const active = await c.env.DB.prepare("SELECT * FROM TierMatches WHERE status = 'active' AND (user_a = ? OR user_b = ?) ORDER BY updated_at DESC")
    .bind(userId, userId).all<any>()
  const recent = await c.env.DB.prepare("SELECT * FROM TierMatches WHERE status != 'active' AND (user_a = ? OR user_b = ?) AND datetime(updated_at) >= datetime('now', '-5 minutes') ORDER BY updated_at DESC LIMIT 10")
    .bind(userId, userId).all<any>()
  return c.json({
    active: await Promise.all(active.results.map(decorate)),
    recent: await Promise.all(recent.results.map(decorate)),
  })
})


lobby.post('/special/:id/card', orbitAuth, async (c) => {
  return withMatchLock(async () => {
    const userId = c.get('orbitId'); const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as { card_id?: string }
    const match = await c.env.DB.prepare("SELECT * FROM TierMatches WHERE id = ? AND status = 'active'").bind(id).first<any>()
    if (!match || (match.user_a !== userId && match.user_b !== userId)) return c.json({ error: 'Special match not found' }, 404)
    const card = await c.env.DB.prepare(`
      SELECT o.id FROM Objects o
      LEFT JOIN Recipients r ON r.object_id = o.id AND r.recipient_id = ?
      WHERE o.id = ? AND (o.owner_id = ? OR r.recipient_id IS NOT NULL) AND o.is_story = 0
    `).bind(userId, body.card_id || '', userId).first()
    if (!card) return c.json({ error: 'Card not found' }, 400)
    const col = match.user_a === userId ? 'card_a' : 'card_b'
    // Guard: never overwrite an already-submitted card (a stale/duplicate
    // submission arriving after tier-advance or an opponent's play would
    // otherwise clobber the current round's card).
    await c.env.DB.prepare(`UPDATE TierMatches SET ${col} = ?, last_result = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${col} IS NULL`).bind(body.card_id, id).run()
    await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(body.card_id, match.user_a === userId ? match.user_b : match.user_a).run()
    broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
    const updated = await c.env.DB.prepare('SELECT * FROM TierMatches WHERE id = ?').bind(id).first<any>()
    // If the guarded write did not land (card already set this round), the
    // player's submission is stale — reject instead of treating it as ready.
    if (!updated || updated[col] !== body.card_id) {
      return c.json({ error: 'You already played a card this round' }, 409)
    }
    return c.json({ ok: true, ready: Boolean(updated.card_a && updated.card_b) })
  })
})

lobby.post('/special/:id/decision', orbitAuth, async (c) => {
  return withMatchLock(async () => {
    const userId = c.get('orbitId'); const id = c.req.param('id'); const body = await c.req.json().catch(() => ({})) as { decision?: string }
    const match = await c.env.DB.prepare("SELECT * FROM TierMatches WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?)").bind(id, userId, userId).first<any>()
    if (!match || !match.card_a || !match.card_b || !['like', 'reject'].includes(body.decision || '')) return c.json({ error: 'Tier match is not ready' }, 409)
    const col = match.user_a === userId ? 'decision_a' : 'decision_b'
    await c.env.DB.prepare(`UPDATE TierMatches SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${col} IS NULL`).bind(body.decision, id).run()
    broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
    const updated = await c.env.DB.prepare('SELECT * FROM TierMatches WHERE id = ?').bind(id).first<any>()
    if (!updated.decision_a || !updated.decision_b) return c.json({ ok: true, waiting: true })
    // Card-value economy: each side's payout scales with its own card's
    // reputation plus the opponent's (win). Best-effort — a failed wallet
    // credit must never wedge the match flow.
    const vp = async (oid: string) => Number((await c.env.DB.prepare('SELECT COALESCE(gacha_downloads_count, 0) AS v FROM Objects WHERE id = ?').bind(oid).first<{ v: number }>())?.v ?? 0)
    const [va, vb] = await Promise.all([vp(updated.card_a), vp(updated.card_b)])
    const econA = matchEconomy(va, vb) // from A's seat
    const econB = matchEconomy(vb, va)
    const economy = new EconomyService(c.env.DB)
    const pay = async (uid: string, gp: number, reason: string, tag: string) => {
      try {
        await economy.credit(uid, gp, { idempotencyKey: `tier-${id}-${tag}`, kind: 'reward', reference: `tier-match:${reason}` })
      } catch (err) { console.warn('[lobby] tier payout failed:', err) }
    }
    if (updated.decision_a === 'like' && updated.decision_b === 'like') {
      const newTier = Number(match.tier || 1) + 1
      if (newTier > SPECIAL_MAX_TIER) {
        // Final level matched — big payout and the match is complete.
        await c.env.DB.prepare("UPDATE TierMatches SET status='ended', last_result='both_like', last_card_a=?, last_card_b=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active' AND last_result IS NULL").bind(updated.card_a, updated.card_b, id).run()
        await Promise.all([
          addPoints(c.env.DB, match.user_a, SPECIAL_FINAL_POINTS),
          addPoints(c.env.DB, match.user_b, SPECIAL_FINAL_POINTS),
          pay(match.user_a, econA.winGp, 'mutual_like', 'final-a'),
          pay(match.user_b, econB.winGp, 'mutual_like', 'final-b'),
        ])
        await c.env.DB.prepare('DELETE FROM LobbyPlayers WHERE user_id IN (?, ?)').bind(match.user_a, match.user_b).run().catch(() => {})
        await advanceLobbyUnlocked(c.env.DB).catch(() => {})
        return c.json({ ok: true, final: true, both_like: true, tier: newTier, points: SPECIAL_FINAL_POINTS, payout: { gp: userId === match.user_a ? econA.winGp : econB.winGp, reason: 'mutual_like' } })
      }
      // Climb a level: both like -> advance, both must play new cards.
      await c.env.DB.prepare('UPDATE TierMatches SET tier=tier+1, card_a=NULL, card_b=NULL, decision_a=NULL, decision_b=NULL, last_result=\'both_like\', last_card_a=?, last_card_b=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND last_result IS NULL AND status=\'active\'').bind(updated.card_a, updated.card_b, id).run()
      await Promise.all([
        addPoints(c.env.DB, match.user_a, SPECIAL_TIER_POINTS),
        addPoints(c.env.DB, match.user_b, SPECIAL_TIER_POINTS),
        pay(match.user_a, econA.winGp, 'mutual_like', `t${match.tier}-a`),
        pay(match.user_b, econB.winGp, 'mutual_like', `t${match.tier}-b`),
      ])
      const fresh = await c.env.DB.prepare('SELECT tier FROM TierMatches WHERE id = ?').bind(id).first<{ tier: number }>()
      return c.json({ ok: true, advanced: true, both_like: true, tier: Number(fresh?.tier ?? newTier), points: SPECIAL_TIER_POINTS, payout: { gp: userId === match.user_a ? econA.winGp : econB.winGp, reason: 'mutual_like' } })
    }
    // Not a mutual like: the match ends (no auto-requeue). Both played, both
    // get the small consolation scaled to their own card.
    await c.env.DB.prepare("UPDATE TierMatches SET status='ended', last_result='ended', last_card_a=?, last_card_b=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active' AND last_result IS NULL").bind(updated.card_a, updated.card_b, id).run()
    await Promise.all([
      pay(match.user_a, econA.loseGp, 'no_match', 'end-a'),
      pay(match.user_b, econB.loseGp, 'no_match', 'end-b'),
    ])
    await c.env.DB.prepare('DELETE FROM LobbyPlayers WHERE user_id IN (?, ?)').bind(match.user_a, match.user_b).run().catch(() => {})
    await advanceLobbyUnlocked(c.env.DB).catch(() => {})
    return c.json({ ok: true, ended: true, payout: { gp: userId === match.user_a ? econA.loseGp : econB.loseGp, reason: 'no_match' } })
  })
})

lobby.post('/special/:id/end', orbitAuth, async (c) => {
  return withMatchLock(async () => {
    const userId = c.get('orbitId'); const id = c.req.param('id')
    const match = await c.env.DB.prepare("SELECT * FROM TierMatches WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?)").bind(id, userId, userId).first<any>()
    if (!match) return c.json({ error: 'Special match not found' }, 404)
    await c.env.DB.prepare("UPDATE TierMatches SET status = 'ended', last_result = 'quit', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").bind(id).run()
    await c.env.DB.prepare('DELETE FROM LobbyPlayers WHERE user_id IN (?, ?)').bind(match.user_a, match.user_b).run().catch(() => {})
    await advanceLobbyUnlocked(c.env.DB).catch(() => {})
    broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
    return c.json({ ok: true })
  })
})

lobby.post('/join', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  // Server-side guard: refuse to pair users who have fewer than MIN_GAME_CARDS
  // cards. The client also disables the Quick Play button when the library is
  // too small, but defending here stops API calls from bypassing the gate.
  const own = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM Objects WHERE owner_id = ? AND is_story = 0').bind(orbitId).first<{ n: number }>()
  if (!own || (own.n ?? 0) < MIN_GAME_CARDS) {
    return c.json({ error: `Upload at least ${MIN_GAME_CARDS} pictures before joining the queue.` }, 400)
  }
  await joinLobby(c.env.DB, orbitId, 1)
  await advanceLobby(c.env.DB)
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  return c.json({ ok: true })
})

lobby.post('/leave', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const current = await c.env.DB.prepare('SELECT status FROM LobbyPlayers WHERE user_id = ?').bind(orbitId).first<{ status: string }>()
  if (current?.status === 'in_match') return c.json({ ok: false, error: 'Quit the active match before leaving the queue.' }, 409)
  const ok = await leaveLobby(c.env.DB, orbitId)
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  return c.json({ ok })
})

lobby.post('/autoqueue', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean }
  // Same card gate as /join — rejecting here covers the Quick Play toggle
  // which is the primary UI path (useLobby.toggleAutoQueue).
  if (body.enabled !== false) {
    const own = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM Objects WHERE owner_id = ? AND is_story = 0').bind(orbitId).first<{ n: number }>()
    if (!own || (own.n ?? 0) < MIN_GAME_CARDS) {
      return c.json({ error: `Upload at least ${MIN_GAME_CARDS} pictures before joining the queue.` }, 400)
    }
  }
  await setAutoQueue(c.env.DB, orbitId, body.enabled !== false)
  await advanceLobby(c.env.DB)
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  return c.json({ ok: true, auto_queue: body.enabled !== false })
})

lobby.post('/quick-match', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const own = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM Objects WHERE owner_id = ? AND is_story = 0').bind(orbitId).first<{ n: number }>()
  if (!own || (own.n ?? 0) < MIN_GAME_CARDS) {
    return c.json({ error: `Upload at least ${MIN_GAME_CARDS} pictures before dueling a bot.` }, 400)
  }
  const existing = await c.env.DB
    .prepare("SELECT id FROM GameMatches WHERE status IN ('lobby', 'playing') AND (user_a = ? OR user_b = ?)")
    .bind(orbitId, orbitId)
    .first<{ id: string }>()
  if (existing) return c.json({ error: 'Finish your active match before starting a Quick Match.' }, 409)

  let match = null
  try {
    match = await withMatchLock(async () => {
      const locked = await c.env.DB
        .prepare("SELECT id FROM GameMatches WHERE status IN ('lobby', 'playing') AND (user_a = ? OR user_b = ?)")
        .bind(orbitId, orbitId)
        .first<{ id: string }>()
      if (locked) return null
      return createQuickBotMatch(c.env.DB, orbitId, Date.now())
    })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not start a Quick Match.' }, err?.status || 409)
  }
  if (!match) return c.json({ error: 'Finish your active match before starting a Quick Match.' }, 409)
  await advanceLobby(c.env.DB)
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  return c.json({ ok: true, match: { id: match.id } })
})

lobby.get('/matches', orbitAuth, async (c) => {
  const matches = await getActiveMatches(c.env.DB)
  return c.json({ matches })
})

lobby.get('/match/:matchId/spectate', orbitAuth, async (c) => {
  const matchId = c.req.param('matchId') || ''
  const snap = await getSpectatorSnapshot(c.env.DB, matchId)
  if (!snap) return c.json({ error: 'Match not found or ended' }, 404)
  return c.json({ snapshot: snap })
})

lobby.get('/league', orbitAuth, async (c) => {
  const league = await getLeague(c.env.DB, 50)
  return c.json({ league })
})

lobby.post('/match/:matchId/card', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const matchId = c.req.param('matchId') || ''
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const cardId = typeof body.card_id === 'string' ? body.card_id : ''
  if (!cardId) return c.json({ error: 'card_id is required' }, 400)
  try {
    const match = await playMatchCard(c.env.DB, matchId, orbitId, cardId)
    await advanceLobby(c.env.DB)
    return c.json({ ok: true, match })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to play card' }, err?.status || 500)
  }
})

lobby.post('/match/:matchId/decision', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const matchId = c.req.param('matchId') || ''
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const decision = body.decision
  if (!['like', 'reject', 'boost'].includes(decision)) {
    return c.json({ error: "Invalid decision. Must be 'like', 'reject', or 'boost'." }, 400)
  }
  try {
    const result = await setMatchDecision(c.env.DB, matchId, orbitId, decision)
    await advanceLobby(c.env.DB)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to record decision' }, err?.status || 500)
  }
})

lobby.post('/match/:matchId/quit', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const matchId = c.req.param('matchId') || ''
  try {
    await quitMatch(c.env.DB, matchId, orbitId)
    await advanceLobby(c.env.DB)
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to leave match' }, err?.status || 500)
  }
})

lobby.get('/match/:matchId/chat', orbitAuth, async (c) => {
  const userId = c.get('orbitId')
  const matchId = c.req.param('matchId')
  const gm = await c.env.DB.prepare('SELECT user_a, user_b FROM GameMatches WHERE id = ?').bind(matchId).first<{ user_a: string; user_b: string }>()
  const tm = gm ? null : await c.env.DB.prepare('SELECT user_a, user_b FROM TierMatches WHERE id = ?').bind(matchId).first<{ user_a: string; user_b: string }>()
  const matchUsers = gm || tm
  if (!matchUsers || (matchUsers.user_a !== userId && matchUsers.user_b !== userId)) {
    return c.json({ error: 'Match not found or you are not a participant' }, 404)
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, match_id, sender_id, sender_name, body, created_at FROM MatchChat
     WHERE match_id = ? AND hidden_at IS NULL ORDER BY created_at ASC LIMIT 50`
  ).bind(matchId).all<{ id: string; match_id: string; sender_id: string; sender_name: string | null; body: string; created_at: string }>()
  return c.json({ messages: rows.results })
})

lobby.post('/match/:matchId/chat', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const matchId = c.req.param('matchId')
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 500) : ''
  if (!text) return c.json({ error: 'Message cannot be empty' }, 400)

  // Must be a participant in the match (5-round duel or special ladder).
  const gm = await c.env.DB.prepare('SELECT user_a, user_b FROM GameMatches WHERE id = ?').bind(matchId).first<{ user_a: string; user_b: string }>()
  let peerId: string | null = null
  if (gm && (gm.user_a === orbitId || gm.user_b === orbitId)) {
    peerId = gm.user_a === orbitId ? gm.user_b : gm.user_a
  } else {
    const tm = await c.env.DB.prepare('SELECT user_a, user_b FROM TierMatches WHERE id = ?').bind(matchId).first<{ user_a: string; user_b: string }>()
    if (!tm || (tm.user_a !== orbitId && tm.user_b !== orbitId)) {
      return c.json({ error: 'Match not found or you are not a participant' }, 404)
    }
    peerId = tm.user_a === orbitId ? tm.user_b : tm.user_a
  }

  const user = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const message = {
    id,
    match_id: matchId,
    sender_id: orbitId,
    sender_name: user?.display_name?.trim() || 'Unknown User',
    body: text,
    created_at: createdAt,
  }
  await c.env.DB.prepare(
    'INSERT INTO MatchChat (id, match_id, sender_id, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, matchId, orbitId, message.sender_name, text, createdAt).run()

  // Only broadcast to the peer — the sender receives the message from the
  // POST response, so no dedup race can duplicate it in the sender's chat.
  if (peerId) broadcastToUser(peerId, { type: 'chat', action: 'new', match_id: matchId, message })
  return c.json({ ok: true, message })
})

lobby.get('/images', orbitAuth, async (c) => {
  const images = await getLobbyImages(c.env.DB)
  // Replace base64 data URLs with a lightweight content endpoint reference
  // to avoid serving megabytes of base64 in the list JSON response.
  const mapped = images.map((img) => {
    if (img.content_url && img.content_url.startsWith('data:')) {
      return { ...img, content_url: `/api/lobby/images/${img.id}/content` }
    }
    return img
  })
  return c.json(mapped)
})

lobby.get('/images/:id/content', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    "SELECT content_url, expires_at, hidden_at FROM LobbyImages WHERE id = ?"
  ).bind(id).first<{ content_url: string; expires_at: string | null; hidden_at: string | null }>()

  if (!row || !row.content_url || row.hidden_at) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Genuine expiry is the one case where it is safe to delete the row: it is
  // strictly past its TTL, so cleanup will wipe it anyway. Deleting here is a
  // latency optimization, not a correctness requirement.
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    await c.env.DB.prepare("DELETE FROM LobbyImages WHERE id = ?").bind(id).run().catch(() => {})
    if (c.env.BUCKET) await c.env.BUCKET.delete(`lobby/${id}`).catch(() => {})
    return c.json({ error: 'Expired' }, 404)
  }

  // Serve base64 data URL as a proper image response
  if (row.content_url.startsWith('data:')) {
    const commaIdx = row.content_url.indexOf(',')
    const header = commaIdx !== -1 ? row.content_url.slice(0, commaIdx) : ''
    const b64 = commaIdx !== -1 ? row.content_url.slice(commaIdx + 1) : row.content_url
    const mime = header.replace(/^data:/i, '').replace(/;base64$/i, '').trim() || 'image/jpeg'
    const buf = Buffer.from(b64, 'base64')
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'Content-Length': String(buf.length),
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // Blob-spilled lobby image: content_url was stored as the self-referential
  // endpoint path (/api/lobby/images/<id>/content) so the LIST payload stayed
  // small. The actual bytes live under BUCKET at lobby/<id> (unencrypted — the
  // lobby board is intentionally not encrypted at rest; only match cards via
  // /api/objects use XChaCha20-Poly1305). Read them and serve with the MIME
  // detected from magic bytes, since the inline data: branch above already
  // consumed the obvious case.
  if (row.content_url.includes(`/lobby/images/${id}/content`) || row.content_url.endsWith(`/images/${id}/content`) || (c.env.BUCKET && !row.content_url.startsWith('http') && !row.content_url.startsWith('data:'))) {
    if (!c.env.BUCKET) return c.json({ error: 'Storage not available' }, 503)
    const blob = await c.env.BUCKET.get(`lobby/${id}`)
    const body = blob?.body ?? null
    if (!blob || !body) return c.json({ error: 'Object not found' }, 404)
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const bytes = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const mime = detectMediaMime(bytes, undefined) || 'image/jpeg'
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'Content-Length': String(bytes.length),
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // Other relative URL — construct absolute URL for redirect
  if (row.content_url.startsWith('/')) {
    const origin = new URL(c.req.url).origin
    return Response.redirect(`${origin}${row.content_url}`, 302)
  }

  // External http(s) URLs are no longer transparent-redirected — that would
  // leak the client IP to the remote host. Lobby uploads now always go through
  // proxyAndStoreExternal and store a /api/lobby/images/<id>/content path or
  // an inline data: URL instead. A raw //external URL here means a legacy row
  // from before the proxy — return 410 Gone so clients refresh and the
  // cleanup sweep eventually deletes it.
  if (row.content_url.startsWith('http://') || row.content_url.startsWith('https://')) {
    return c.json({ error: 'External URL disabled — re-upload required' }, 410)
  }

  return c.json({ error: 'Invalid content URL' }, 404)
})

import { isValidMediaMagicBytes, detectMediaMime } from './objects'
import { proxyAndStoreExternal } from '../proxy'
lobby.post('/images/:id/like', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const userId = c.get('orbitId')
  const result = await likeLobbyImage(c.env.DB, id, userId)
  broadcastToRoom('lobby', { type: 'lobby', action: 'like', image_id: id })
  return c.json(result)
})

lobby.get('/images/:id/likers', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const likers = await getLobbyImageLikers(c.env.DB, id)
  return c.json({ likers })
})

lobby.post('/images/:id/comments', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const userId = c.get('orbitId')
  const body = (await c.req.json().catch(() => ({ body: '' }) as { body: string })).body
  const trimmed = (body || '').trim().slice(0, 500)
  if (!trimmed) return c.json({ error: 'Comment cannot be empty' }, 400)
  const comment = await addLobbyComment(c.env.DB, id, userId, trimmed)
  broadcastToRoom('lobby', { type: 'lobby', action: 'comment', image_id: id })
  return c.json(comment, 201)
})

lobby.get('/images/:id/comments', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const comments = await getLobbyComments(c.env.DB, id)
  return c.json(comments)
})

lobby.delete('/comments/:commentId', orbitAuth, async (c) => {
  const commentId = c.req.param('commentId') || ''
  if (!commentId) return c.json({ error: 'Missing comment id' }, 400)
  const userId = c.get('orbitId')
  const adminRow = await c.env.DB.prepare('SELECT is_admin FROM Users WHERE id = ?').bind(userId).first<{ is_admin: number }>()
  const isAdmin = Boolean(adminRow?.is_admin)
  const ok = await deleteLobbyComment(c.env.DB, commentId, userId, isAdmin)
  if (!ok) return c.json({ error: 'Not found or not authorised' }, 403)
  return c.json({ ok: true })
})

lobby.post('/images/:id/report', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const userId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({ category: 'inappropriate', reason: '' }) as { category: string; reason: string })
  const category = (body?.category || 'inappropriate').slice(0, 32)
  const reason = (body?.reason || '').slice(0, 500)
  try {
    const result = await serviceReportContent(c.env.DB, userId, 'lobby_image', id, category, reason)
    if (result.reported) broadcastToRoom('lobby', { type: 'lobby', action: 'images' })
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})

lobby.post('/images', orbitAuth, async (c) => {
  try {
    const orbitId = c.get('orbitId')
    const formData = await c.req.formData()
    const imageFile = formData.get('image') as File | null
    const linkUrl = (formData.get('url') as string | null)?.trim() || null
    const caption = (formData.get('caption') as string | null)?.trim() || null
    const tags = (formData.get('tags') as string | null)?.split(/[\n,]+/).map((tag) => tag.trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 10) || []

    if (!imageFile && !linkUrl) {
      return c.json({ error: 'Provide either a media file or a URL' }, 400)
    }

    // Pre-allocate the lobby image id so the DB row, the optional BUCKET blob
    // and the content_url all reference the SAME id. Previously setLobbyImage
    // generated its own uuid when opts.id was missing, diverging from the
    // blob key the inner branches had just written.
    const id = crypto.randomUUID()
    let contentUrl: string
    let mimeType: string | null = null
    let isProxied = 0
    let proxiedMime: string | null = null
    if (linkUrl) {
      // External URLs are no longer 302-redirected to: clients would resolve
      // the remote host themselves, leaking their IP to the originating
      // server. Proxy + EXIF-strip + store in our own blob store. Recognised
      // sources (Twitter/X, Discord, Tenor, Giphy, Reddit, Instagram) get a
      // per-source media URL extracted before fetch.
      const proxied = await proxyAndStoreExternal(linkUrl, c.env.BUCKET, 'lobby', id)
      if (!proxied) {
        return c.json({ error: 'Could not fetch or validate the URL' }, 400)
      }
      contentUrl = proxied.storedUrl
      mimeType = proxied.mimeType
      isProxied = proxied.isProxied
      proxiedMime = proxied.proxiedMime
    } else {
      const arrayBuffer = await imageFile!.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      if (bytes.length > 50 * 1024 * 1024) {
        return c.json({ error: 'File exceeds 50MB limit' }, 400)
      }
      if (!isValidMediaMagicBytes(bytes)) {
        return c.json({ error: 'Invalid media format' }, 400)
      }
      const mime = detectMediaMime(bytes, imageFile!.type || imageFile!.name)

      if (bytes.length <= 128 * 1024) {
        contentUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
      } else {
        if (c.env.BUCKET) {
          await c.env.BUCKET.put(`lobby/${id}`, bytes, {
            httpMetadata: { contentType: mime },
          })
        }
        contentUrl = `/api/lobby/images/${id}/content`
      }
      mimeType = mime
    }

    const image = await setLobbyImage(c.env.DB, orbitId, { id, contentUrl, caption, tags, mimeType, isProxied, proxiedMime })
    broadcastToRoom('lobby', { type: 'lobby', action: 'images' })
    return c.json(image, 201)
  } catch (err) {
    console.error('[lobby] POST /images failed:', err)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

wsTicket.post('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const ticket = createWsTicket(orbitId)
  return c.json({ ticket, expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString() })
})

// Server-persisted lobby chat stream: recent history replay + WS push of new
// messages. The P2P swarm relay still fans messages out in real-time, but the
// DB row is the source of truth for a page reload or a late joiner.
lobby.get('/chat', orbitAuth, async (c) => {
  const channel = c.req.query('channel')
  try {
    if (channel) {
const rows = await c.env.DB.prepare(
        `SELECT id, sender_id, sender_name, body, created_at, COALESCE(channel, 'global_lobby') as channel FROM LobbyChat
         WHERE COALESCE(channel, 'global_lobby') = ? AND hidden_at IS NULL AND datetime(created_at) >= datetime('now', '-12 hours')
         ORDER BY created_at ASC
         LIMIT 500`
      ).bind(channel).all<{ id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel: string }>()
      return c.json({ messages: rows.results })
    }

    const rows = await c.env.DB.prepare(
       `SELECT id, sender_id, sender_name, body, created_at, COALESCE(channel, 'global_lobby') as channel FROM LobbyChat
        WHERE hidden_at IS NULL AND datetime(created_at) >= datetime('now', '-12 hours')
        ORDER BY created_at ASC
        LIMIT 500`
    ).all<{ id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel: string }>()
    return c.json({ messages: rows.results })
  } catch {
    const rows = await c.env.DB.prepare(
      `SELECT id, sender_id, sender_name, body, created_at FROM LobbyChat
       WHERE hidden_at IS NULL AND datetime(created_at) >= datetime('now', '-12 hours')
       ORDER BY created_at ASC
       LIMIT 500`
    ).all<{ id: string; sender_id: string; sender_name: string | null; body: string; created_at: string }>()
    return c.json({ messages: rows.results })
  }
})

lobby.post('/chat', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  let body: any = {}
  try { body = await c.req.json() } catch { body = {} }
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 500) : ''
  if (!text) return c.json({ error: 'Message cannot be empty' }, 400)

  const channel = typeof body.channel === 'string' && body.channel ? body.channel : 'global_lobby'
  const user = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
  const id = typeof body.id === 'string' && body.id.length <= 64 ? body.id : crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const message = { id, sender_id: orbitId, sender_name: user?.display_name?.trim() || 'Unknown User', body: text, created_at: createdAt, channel }
  
  try {
    await c.env.DB.prepare(
      'INSERT INTO LobbyChat (id, sender_id, sender_name, body, created_at, channel) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, orbitId, message.sender_name, text, createdAt, channel).run()
  } catch {
    await c.env.DB.prepare(
      'INSERT INTO LobbyChat (id, sender_id, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, orbitId, message.sender_name, text, createdAt).run()
  }

  // Push to the auth'd lobby room AND the legacy global swarm room so every
  // connected client (including the sender's own other tabs) gets the same
  // authoritative copy. Clients dedupe by id, so the P2P relay duplicate is
  // harmless.
  broadcastToRoom('lobby', { type: 'lobby-chat', action: 'new', message, channel })
  broadcastToRoom('global', { type: 'lobby-chat', action: 'new', message, channel })
  return c.json({ ok: true, message })
})
