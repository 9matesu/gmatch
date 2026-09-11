import type { D1Turso } from './db'
import {
  LOBBY_LOBBY_SECONDS,
  LOBBY_PICK_SECONDS,
  LOBBY_REVEAL_SECONDS,
  LOBBY_DECIDE_SECONDS,
  LOBBY_ROUND_RESULT_SECONDS,
  SPECIAL_MATCH_IDLE_SECONDS,
  PICTURE_TTL_SECONDS,
  MATCH_MAX_ROUNDS,
  LEAGUE_CHAMPION_POINTS,
  DEFAULT_BOOST_CHARGES,
  MatchSnapshot,
  MatchAction,
  GameMatch,
  LiveMatchSummary,
  RoundHistoryItem,
  VOTE_POINTS,
  computeCardRarity,
  checkRarityPromotion,
  calculateDiscoveryReward,
  type CardEvaluationDelta,
  type MatchValuationSummary,
  type CardRarity,
} from '@orbit/shared'
import { applyLikeDecision, addPoints } from './game'
import { broadcastToUser, broadcastToRoom } from './ws-bus'
import { advanceRooms } from './rooms'
import { getBotConfig, getBotProfiles, pickBotDuelCard } from './bot-image-api'
import { generateFallbackName } from '@orbit/shared'
import { canUseBots } from './bots/policy'
import crypto from 'node:crypto'
import { encryptBlob } from './crypto'
import type { LocalBlobStore } from './blob'

const LOBBY_ID = 'global'
const LOBBY_IMAGE_TTL_MS = PICTURE_TTL_SECONDS * 1000
export const STALE_PLAYER_MS = 2 * 60 * 1000
const SPECIAL_MATCH_IDLE_MS = SPECIAL_MATCH_IDLE_SECONDS * 1000

const LOBBY_LOBBY_MS = LOBBY_LOBBY_SECONDS * 1000
const PICK_MS = LOBBY_PICK_SECONDS * 1000
const REVEAL_MS = LOBBY_REVEAL_SECONDS * 1000
const DECIDE_MS = LOBBY_DECIDE_SECONDS * 1000
const ROUND_RESULT_MS = LOBBY_ROUND_RESULT_SECONDS * 1000
// Result window is long enough so players can comfortably read the match outcome,
// view round histories, and click Play Again before cleanup.
const RESULT_MS = 20 * 1000

export interface LobbyError extends Error {
  status: number
}

function lobbyError(message: string, status: number): LobbyError {
  const err = new Error(message) as LobbyError
  err.status = status
  return err
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

// Serialize lobby mutations + the global advance tick so read-then-write
// sequences on the same match never interleave across the three entry points
// (serve.ts 1s tick, the 2s poll throttle, and mutation routes).
let matchLockTail: Promise<void> = Promise.resolve()
export function withMatchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = matchLockTail.then(fn, fn)
  matchLockTail = run.then(() => { }, () => { })
  return run
}

export function isBotUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return userId.startsWith('bot_')
}

export async function ensureBotReady(db: D1Turso, bot: { id: string; name: string; tags: string[]; col?: string; pfp_url?: string | null }): Promise<void> {
  await db.prepare(`
    INSERT INTO Users (id, public_key, display_name, tags, pfp_url, last_seen, is_admin)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 0)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      tags = excluded.tags,
      pfp_url = COALESCE(excluded.pfp_url, Users.pfp_url),
      last_seen = datetime('now')
  `).bind(bot.id, bot.id, bot.name, JSON.stringify(bot.tags), bot.pfp_url || null).run().catch(() => { })

  // Purge any legacy bot placeholder cards from Objects table (so they never pollute storage or admin panel)
  await db.prepare("DELETE FROM Objects WHERE owner_id LIKE 'bot_%'").run().catch(() => { })
}

async function pickBotCard(db: D1Turso, matchId: string, botId: string, opponentTags: string[] = []): Promise<string | null> {
  const botRow = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(botId).first<{ display_name: string }>()
  const botName = botRow?.display_name || 'Bot Duelist'
  const duelCard = await pickBotDuelCard(db, botId, botName, opponentTags).catch(() => null)
  const url = duelCard?.url || `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNTYwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjU2MCIgZmlsbD0iIzA5MDkwYiIvPjx0ZXh0IHg9IjIwMCIgeT0iMjg4IiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5EdWVsIENhcmQ8L3RleHQ+PC9zdmc+`
  // Store the bot card as a match-local MatchCards row so the match never
  // writes remote/data URLs into card_a/card_b and human decision validation
  // can resolve it the same way it resolves a real Object.
  const cardId = crypto.randomUUID()
  await db
    .prepare('INSERT INTO MatchCards (id, room_id, owner_id, content_url) VALUES (?, ?, ?, ?)')
    .bind(cardId, matchId, botId, url)
    .run()
  return cardId
}

/** Resolve a card (match-local or deck Object) to its display URL. */
export async function resolveCardUrl(db: D1Turso, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const mc = await db.prepare('SELECT content_url FROM MatchCards WHERE id = ?').bind(id).first<{ content_url: string }>()
  if (mc && mc.content_url) return mc.content_url
  const obj = await db.prepare('SELECT id, content_url FROM Objects WHERE id = ?').bind(id).first<{ id: string; content_url: string | null }>()
  if (obj) {
    if (obj.content_url && obj.content_url.trim()) return obj.content_url
    return `/api/objects/${obj.id}`
  }
  if (id.startsWith('data:') || id.startsWith('http://') || id.startsWith('https://') || id.startsWith('/api/')) return id
  return `/api/objects/${id}`
}

/**
 * Create a fresh 1v1 duel between a human player and a random bot (bypassing
 * the queue). Used by the Quick Match button so an impatient player can duel a
 * bot instantly instead of waiting ~2 minutes for the auto bot fallback.
 * Assumes callers already verified the player is not in a duel and has cards.
 */
export async function createQuickBotMatch(db: D1Turso, userId: string, now: number): Promise<GameMatch | null> {
  const botConfig = await getBotConfig(db).catch(() => null)
  if (botConfig) {
    const policy = canUseBots(botConfig, 'quick_match')
    if (!policy.allowed) {
      throw lobbyError(policy.reason || 'Bots are unavailable', 409)
    }
  }
const profiles = await getBotProfiles(db).catch(() => [])
    const available = profiles.filter((p) => p.enabled)
    if (available.length === 0) {
      throw lobbyError('No bot profiles configured', 409)
    }
    const bot = available[Math.floor(Math.random() * available.length)]
    await ensureBotReady(db, { id: bot.id, name: bot.name, tags: bot.tags, col: bot.color || '', pfp_url: bot.pfp_url })
    const match = await createDirectMatch(db, userId, bot.id, now)
  if (match) {
    await db
      .prepare("UPDATE LobbyPlayers SET auto_queue = 0, status = 'in_match', waiting_since = NULL WHERE user_id = ?")
      .bind(userId)
      .run()
  }
  return match
}

export async function joinLobby(db: D1Turso, userId: string, autoQueue: number = 1): Promise<void> {
  await db.prepare('UPDATE Users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').bind(userId).run().catch(() => { })
  await db
    .prepare(`
      INSERT INTO LobbyPlayers (user_id, status, auto_queue, joined_at, waiting_since)
      VALUES (?, 'waiting', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        status = CASE WHEN LobbyPlayers.status IN ('in_session', 'in_match') THEN LobbyPlayers.status ELSE 'waiting' END,
        auto_queue = excluded.auto_queue,
        joined_at = CURRENT_TIMESTAMP,
        waiting_since = COALESCE(LobbyPlayers.waiting_since, CURRENT_TIMESTAMP)
    `)
    .bind(userId, autoQueue)
    .run()
}

export async function leaveLobby(db: D1Turso, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT status FROM LobbyPlayers WHERE user_id = ? AND status = 'waiting'")
    .bind(userId)
    .first<{ status: string }>()
  if (!row) return false
  await db.prepare('DELETE FROM LobbyPlayers WHERE user_id = ?').bind(userId).run()
  return true
}

export async function setAutoQueue(db: D1Turso, userId: string, enabled: boolean): Promise<void> {
  if (!enabled) {
    await db.prepare("UPDATE LobbyPlayers SET auto_queue = 0, status = 'idle', waiting_since = NULL WHERE user_id = ?").bind(userId).run()
  } else {
    await db.prepare('UPDATE Users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').bind(userId).run().catch(() => { })
    await db
      .prepare(`
        INSERT INTO LobbyPlayers (user_id, status, auto_queue, joined_at, waiting_since)
        VALUES (?, 'waiting', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          status = CASE WHEN LobbyPlayers.status IN ('in_session', 'in_match') THEN LobbyPlayers.status ELSE 'waiting' END,
          auto_queue = 1,
          waiting_since = COALESCE(LobbyPlayers.waiting_since, CURRENT_TIMESTAMP)
      `)
      .bind(userId)
      .run()
  }
}

const ONLINE_CUTOFF_MS = 60 * 1000 // 60 seconds

// How long a queued player may sit idle (last activity) before being dropped
// from the queue entirely. Wider than ONLINE_CUTOFF so semi-idle players stay
// matchable (at lower priority) instead of being instantly booted.
const QUEUE_MAX_IDLE_MS = 15 * 60 * 1000 // 15 minutes

// AFK tiers used to order the pairing queue (most-active first):
//   bucket 1 = active within the last 3 minutes  (0-180s)
//   bucket 2 = active within the last 10 minutes (180-600s)
//   bucket 3 = idle 600s+ (but still within QUEUE_MAX_IDLE_MS)
// Active players pair with each other first; idle players only match once no
// active players remain.
const QUEUE_ACTIVE_BUCKET_MS = 180 * 1000 // 3 minutes
const QUEUE_IDLE_BUCKET_MS = 600 * 1000 // 10 minutes

async function cleanStalePlayers(db: D1Turso, now: number): Promise<void> {
  // Remove ANY lobby row for users who have gone offline (idle past the queue
  // max) or NULL
  await db
    .prepare(`
      DELETE FROM LobbyPlayers
      WHERE user_id IN (
        SELECT id FROM Users
        WHERE last_seen IS NULL
           OR datetime(last_seen) < datetime(?)
      )
    `)
    .bind(isoFromMs(now - QUEUE_MAX_IDLE_MS))
    .run()

  // Reset any lingering legacy session memberships
  await db
    .prepare("UPDATE LobbyPlayers SET status = 'waiting' WHERE status = 'in_session'")
    .run()
    .catch(() => { })
}

/** The user's active (or just-ended, awaiting result display) 1v1 match. */
async function activeMatchForUser(db: D1Turso, userId: string, now: number): Promise<GameMatch | null> {
  return db
    .prepare(`
      SELECT * FROM GameMatches
      WHERE (user_a = ? OR user_b = ?)
        AND (status IN ('lobby', 'playing') OR (status = 'ended' AND phase = 'result' AND phase_deadline > ?))
        AND (forfeit_user IS NULL OR forfeit_user != ?)
      ORDER BY created_at DESC LIMIT 1
    `)
    .bind(userId, userId, now, userId)
    .first<GameMatch>()
}

async function opponentProfile(db: D1Turso, opponentId: string): Promise<{ display_name: string; pfp_url: string | null }> {
  const u = await db
    .prepare('SELECT display_name, pfp_url FROM Users WHERE id = ?')
    .bind(opponentId)
    .first<{ display_name: string | null; pfp_url: string | null }>()
  return { display_name: u?.display_name?.trim() || generateFallbackName(opponentId), pfp_url: u?.pfp_url ?? null }
}

/** True when the duel produced at least one mutual-like round (a "successful match"). */
export function hasMutualLike(match: { rounds_history?: string | null; matched?: number | null }): boolean {
  try {
    const history: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')
    if (history.length > 0) return history.some((r) => r.matched)
  } catch { }
  return Boolean(match.matched)
}

/** True when EVERY round of the duel was a mutual like (a perfect 5/5 match). */
export function isPerfectMatch(match: { rounds_history?: string | null; matched?: number | null }): boolean {
  try {
    const history: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')
    return history.length > 0 && history.every((r) => r.matched)
  } catch {
    return false
  }
}

export async function recordLeagueRank(db: D1Turso, winnerId: string | null, loserId: string | null, isDraw = false): Promise<void> {
  if (isDraw) {
    for (const uid of [winnerId, loserId].filter(Boolean) as string[]) {
      await db
        .prepare(`
          INSERT INTO LeagueRank (user_id, wins, points, updated_at)
          VALUES (?, 0, 10, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            points = points + 10,
            updated_at = CURRENT_TIMESTAMP
        `)
        .bind(uid)
        .run()
      await addPoints(db, uid, 10)
    }
    return
  }
  if (winnerId) {
    await db
      .prepare(`
        INSERT INTO LeagueRank (user_id, wins, points, updated_at)
        VALUES (?, 1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          wins = wins + 1,
          points = points + ?,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(winnerId, LEAGUE_CHAMPION_POINTS, LEAGUE_CHAMPION_POINTS)
      .run()
    await addPoints(db, winnerId, LEAGUE_CHAMPION_POINTS)
  }
  if (loserId) {
    await db
      .prepare(`
        INSERT INTO LeagueRank (user_id, wins, points, updated_at)
        VALUES (?, 0, 5, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          points = points + 5,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(loserId)
      .run()
    await addPoints(db, loserId, 5)
  }
}

async function snapshotForUser(db: D1Turso, match: GameMatch, userId: string): Promise<MatchSnapshot> {
  const me = match.user_a === userId ? 'a' : 'b'
  const opponentId = me === 'a' ? match.user_b : match.user_a
  const rawMine = me === 'a' ? match.card_a : match.card_b
  const rawTheirs = me === 'a' ? match.card_b : match.card_a
  const revealed = ['reveal', 'decide', 'round_result', 'result'].includes(match.phase)
  const myDecision = (me === 'a' ? match.decision_a : match.decision_b) as any
  const theirDecision = (me === 'a' ? match.decision_b : match.decision_a) as any
  const myDecided = Boolean(myDecision)
  const theirDecided = Boolean(theirDecision)
  const showTheirDecision = ['round_result', 'result'].includes(match.phase) || (match.phase === 'decide' && theirDecided)
  const opp = await opponentProfile(db, opponentId)
  const myPlayedCards: string[] = JSON.parse((me === 'a' ? match.played_cards_a : match.played_cards_b) || '[]')
  const roundsHistory: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')

  const resolvedHistory = await Promise.all(
    roundsHistory.map(async (rh) => ({
      ...rh,
      card_a_url: await resolveCardUrl(db, rh.card_a),
      card_b_url: await resolveCardUrl(db, rh.card_b),
    }))
  )

  // Boost charges remaining this match (server-derived from rounds + pending).
  const myDecideCol = me === 'a' ? 'decision_a' : 'decision_b'
  const boostsUsed = roundsHistory.filter((r) => r[myDecideCol] === 'boost').length + (myDecision === 'boost' ? 1 : 0)
  const boostsRemaining = Math.max(0, DEFAULT_BOOST_CHARGES - boostsUsed)

  return {
    id: match.id,
    phase: match.phase,
    status: match.status,
    round_seq: match.round_seq || 1,
    max_rounds: match.max_rounds || MATCH_MAX_ROUNDS,
    score_mine: me === 'a' ? Number(match.score_a || 0) : Number(match.score_b || 0),
    score_opponent: me === 'a' ? Number(match.score_b || 0) : Number(match.score_a || 0),
    rounds_history: resolvedHistory,
    played_cards: myPlayedCards,
    phase_deadline: match.phase_deadline,
    my_card: rawMine ?? null,
    my_decided: myDecided,
    my_decision: myDecision ?? null,
    boosts_remaining: boostsRemaining,
    opponent: { id: opponentId, display_name: opp.display_name, pfp_url: opp.pfp_url },
    opponent_card: revealed ? (rawTheirs ?? null) : null,
    opponent_played: Boolean(rawTheirs),
    opponent_decided: theirDecided,
    opponent_decision: showTheirDecision ? (theirDecision ?? null) : null,
    matched: Boolean(match.matched),
    result: match.result ?? null,
    forfeit_user: match.forfeit_user ?? null,
    quit_user_id: match.forfeit_user ?? null,
    is_spectating: false,
    valuation_summary:
      match.phase === 'result' ? await buildValuationSummary(db, match, me, userId) : null,
  }
}

/**
 * Build a server-authoritative card valuation summary for a resolved match.
 * Each card is individually valued: every vote cast on it during the duel adds
 * a persistent point delta (VOTE_POINTS) to that card's reputation score, which
 * feeds the gMatch economy (rarity tiers, deck value, discovery influence).
 */
async function buildValuationSummary(
  db: D1Turso,
  match: GameMatch,
  me: 'a' | 'b',
  userId: string
): Promise<MatchValuationSummary | null> {
  const rounds: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')
  if (rounds.length === 0) return null

  const opponentId = me === 'a' ? match.user_b : match.user_a
  const opp = await opponentProfile(db, opponentId)

  // Collect every card referenced across rounds and their current reputation.
  const cardIds = new Set<string>()
  for (const r of rounds) {
    if (r.card_a) cardIds.add(r.card_a)
    if (r.card_b) cardIds.add(r.card_b)
  }
  const currentScores = new Map<string, number>()
  if (cardIds.size > 0) {
    const rows = await db
      .prepare(`SELECT id, gacha_downloads_count FROM Objects WHERE id IN (${Array.from(cardIds).map(() => '?').join(',')})`)
      .bind(...Array.from(cardIds))
      .all<{ id: string; gacha_downloads_count?: number }>()
    for (const row of rows.results || []) {
      if (row?.id) currentScores.set(row.id, Math.max(0, Number(row.gacha_downloads_count || 0)))
    }
  }

  // Track cumulative deltas per card so "before" scores are current − match deltas.
  const cumulativeDelta = new Map<string, number>()
  const cardUrl = new Map<string, string | null>()
  const myCardDeltas: CardEvaluationDelta[] = []
  const opponentCardDeltas: CardEvaluationDelta[] = []

  for (const r of rounds) {
    // I vote on my opponent's card; my opponent votes on mine.
    const myVote: 'like' | 'reject' | 'boost' | null = (me === 'a' ? r.decision_a : r.decision_b) as any || null
    const theirVote: 'like' | 'reject' | 'boost' | null = (me === 'a' ? r.decision_b : r.decision_a) as any || null
    const myCardId = me === 'a' ? r.card_a : r.card_b
    const oppCardId = me === 'a' ? r.card_b : r.card_a

    const myDelta = theirVote ? VOTE_POINTS[theirVote] : 0
    const oppDelta = myVote ? VOTE_POINTS[myVote] : 0

    cumulativeDelta.set(myCardId || '', (cumulativeDelta.get(myCardId || '') || 0) + myDelta)
    cumulativeDelta.set(oppCardId || '', (cumulativeDelta.get(oppCardId || '') || 0) + oppDelta)
    if (myCardId && !cardUrl.has(myCardId)) cardUrl.set(myCardId, await resolveCardUrl(db, myCardId))
    if (oppCardId && !cardUrl.has(oppCardId)) cardUrl.set(oppCardId, await resolveCardUrl(db, oppCardId))

    if (myCardId) {
      const current = currentScores.get(myCardId) || 0
      const prev = Math.max(0, current - (cumulativeDelta.get(myCardId) || 0) + myDelta)
      const next = Math.max(0, prev + myDelta)
      const promo = checkRarityPromotion(prev, next)
      myCardDeltas.push({
        cardId: myCardId,
        cardUrl: cardUrl.get(myCardId) ?? null,
        vote: theirVote,
        pointDelta: myDelta,
        previousScore: prev,
        newScore: next,
        promoted: promo.promoted,
        newRarity: promo.newRarity,
      })
    }

    if (oppCardId) {
      const current = currentScores.get(oppCardId) || 0
      const prev = Math.max(0, current - (cumulativeDelta.get(oppCardId) || 0) + oppDelta)
      opponentCardDeltas.push({
        cardId: oppCardId,
        cardUrl: cardUrl.get(oppCardId) ?? null,
        vote: myVote,
        pointDelta: oppDelta,
        previousScore: prev,
        newScore: Math.max(0, prev + oppDelta),
      })
    }
  }

  const myDeltaTotal = myCardDeltas.reduce((acc, d) => acc + d.pointDelta, 0)
  const oppDeltaTotal = opponentCardDeltas.reduce((acc, d) => acc + d.pointDelta, 0)

  const myDeckBefore = myCardDeltas.reduce((acc, d) => acc + d.previousScore, 0)
  const myDeckAfter = myDeckBefore + myDeltaTotal
  const oppDeckBefore = opponentCardDeltas.reduce((acc, d) => acc + d.previousScore, 0)
  const oppDeckAfter = oppDeckBefore + oppDeltaTotal

  const myVotes = rounds.map((r) => ((me === 'a' ? r.decision_a : r.decision_b) as 'like' | 'reject' | 'boost') || null)
  const discoveryInfluenceEarned = myVotes.reduce((acc, v) => {
    if (!v) return acc
    return acc + calculateDiscoveryReward(VOTE_POINTS[v], v)
  }, 0)

  // Card of the match: highest positive delta across both decks.
  const allDeltas = [
    ...myCardDeltas.map((d) => ({ ...d, ownerId: userId, ownerName: 'You' })),
    ...opponentCardDeltas.map((d) => ({ ...d, ownerId: opponentId, ownerName: opp.display_name || 'Opponent' })),
  ]
  const best = allDeltas.reduce<typeof allDeltas[number] | null>(
    (acc, d) => (d.pointDelta > 0 && (!acc || d.pointDelta > acc.pointDelta) ? d : acc),
    null
  )

  const promotions: Array<{ cardId: string; oldRarity: CardRarity; newRarity: CardRarity }> = []
  for (const d of myCardDeltas) {
    if (d.promoted && d.newRarity) {
      const oldRarity = computeCardRarity(d.previousScore).rarity
      promotions.push({ cardId: d.cardId, oldRarity, newRarity: d.newRarity })
    }
  }

  return {
    matchId: match.id,
    playerDeckValueBefore: myDeckBefore,
    playerDeckValueAfter: myDeckAfter,
    playerTotalDelta: myDeltaTotal,
    opponentDeckValueBefore: oppDeckBefore,
    opponentDeckValueAfter: oppDeckAfter,
    opponentTotalDelta: oppDeltaTotal,
    myCardDeltas,
    opponentCardDeltas,
    cardOfTheMatch: best
      ? { cardId: best.cardId, cardUrl: best.cardUrl, ownerId: best.ownerId, ownerName: best.ownerName, pointDelta: best.pointDelta, rarity: computeCardRarity(currentScores.get(best.cardId)).rarity }
      : null,
    discoveryInfluenceEarned,
    promotions,
  }
}

export async function getSpectatorSnapshot(db: D1Turso, matchId: string): Promise<MatchSnapshot | null> {
  const match = await fetchMatch(db, matchId)
  if (!match) return null
  const isLive = match.status === 'lobby' || match.status === 'playing'
  const isResultWindow = match.status === 'ended' && match.phase === 'result' && match.phase_deadline > Date.now()
  if (!isLive && !isResultWindow) return null
  const revealed = ['reveal', 'decide', 'round_result', 'result'].includes(match.phase)
  const oppA = await opponentProfile(db, match.user_a)
  const oppB = await opponentProfile(db, match.user_b)
  const roundsHistory: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')

  const resolvedHistory = await Promise.all(
    roundsHistory.map(async (rh) => ({
      ...rh,
      card_a_url: await resolveCardUrl(db, rh.card_a),
      card_b_url: await resolveCardUrl(db, rh.card_b),
    }))
  )

  const cardAUrl = revealed && match.card_a ? await resolveCardUrl(db, match.card_a) : null
  const cardBUrl = revealed && match.card_b ? await resolveCardUrl(db, match.card_b) : null

  return {
    id: match.id,
    phase: match.phase,
    status: match.status,
    round_seq: match.round_seq || 1,
    max_rounds: match.max_rounds || MATCH_MAX_ROUNDS,
    score_mine: match.score_a || 0,
    score_opponent: match.score_b || 0,
    rounds_history: resolvedHistory,
    played_cards: [],
    phase_deadline: match.phase_deadline,
    my_card: cardAUrl,
    my_decided: Boolean(match.decision_a),
    my_decision: match.decision_a ?? null,
    opponent: { id: match.user_b, display_name: oppB.display_name, pfp_url: oppB.pfp_url },
    opponent_card: cardBUrl,
    opponent_played: Boolean(match.card_b),
    opponent_decided: Boolean(match.decision_b),
    opponent_decision: match.decision_b ?? null,
    matched: Boolean(match.matched),
    result: match.result ?? null,
    forfeit_user: match.forfeit_user ?? null,
    is_spectating: true,
    user_a_info: {
      id: match.user_a,
      display_name: oppA.display_name,
      pfp_url: oppA.pfp_url,
      card: cardAUrl,
      decided: Boolean(match.decision_a),
      decision: match.decision_a ?? null,
      score: match.score_a || 0,
    },
    user_b_info: {
      id: match.user_b,
      display_name: oppB.display_name,
      pfp_url: oppB.pfp_url,
      card: cardBUrl,
      decided: Boolean(match.decision_b),
      decision: match.decision_b ?? null,
      score: match.score_b || 0,
    },
  }
}

export async function getActiveMatches(db: D1Turso): Promise<LiveMatchSummary[]> {
  const rows = await db
    .prepare("SELECT * FROM GameMatches WHERE status IN ('lobby', 'playing') ORDER BY created_at DESC LIMIT 20")
    .bind()
    .all<GameMatch>()
  const summaries: LiveMatchSummary[] = []
  for (const m of rows.results) {
    const oppA = await opponentProfile(db, m.user_a)
    const oppB = await opponentProfile(db, m.user_b)
    summaries.push({
      id: m.id,
      round_seq: m.round_seq || 1,
      max_rounds: m.max_rounds || MATCH_MAX_ROUNDS,
      phase: m.phase,
      status: m.status,
      phase_deadline: m.phase_deadline,
      user_a: {
        id: m.user_a,
        display_name: oppA.display_name,
        pfp_url: oppA.pfp_url,
        score: m.score_a || 0,
      },
      user_b: {
        id: m.user_b,
        display_name: oppB.display_name,
        pfp_url: oppB.pfp_url,
        score: m.score_b || 0,
      },
    })
  }
  return summaries
}

/** Push a per-user match event to both participants. */
async function pushMatchEvent(db: D1Turso, match: GameMatch, action: MatchAction): Promise<void> {
  interface Ev {
    type: 'match'
    action: MatchAction
    match: MatchSnapshot
  }
  for (const userId of [match.user_a, match.user_b]) {
    const snap = await snapshotForUser(db, match, userId)
    const ev: Ev = { type: 'match', action, match: snap }
    broadcastToUser(userId, ev)
  }
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
}

// ---------------------------------------------------------------------------
// Match lifecycle & Multi-Pairing Queue
// ---------------------------------------------------------------------------

/** Create fresh matches for all pairs of eligible waiting players. */
async function pairFromQueue(db: D1Turso, now: number, _skipBots = false): Promise<boolean> {
  // Find users currently in active matches
  const activeRows = await db
    .prepare("SELECT user_a, user_b FROM GameMatches WHERE status IN ('lobby', 'playing')")
    .bind()
    .all<{ user_a: string; user_b: string }>()
  const inMatchUserIds = new Set<string>()
  for (const r of activeRows.results) {
    inMatchUserIds.add(r.user_a)
    inMatchUserIds.add(r.user_b)
  }

  // Pairing eligibility: players idle up to QUEUE_MAX_IDLE_MS remain
  // matchable, but the ORDER BY tiers them by activity (most-active first) so
  // an active player is never held back behind an AFK player.
  const eligibleNow = isoFromMs(now)
  const bucketActive = isoFromMs(now - QUEUE_ACTIVE_BUCKET_MS)
  const bucketIdle = isoFromMs(now - QUEUE_IDLE_BUCKET_MS)

  const waiting = await db
    .prepare(`
      SELECT lp.user_id, COALESCE(lp.waiting_since, lp.joined_at) AS queued_at
      FROM LobbyPlayers lp
      JOIN Users u ON u.id = lp.user_id
      WHERE lp.status = 'waiting'
        AND (lp.auto_queue IS NULL OR lp.auto_queue = 1)
        AND (lp.ready_at IS NULL OR lp.ready_at <= ?)
        AND u.last_seen IS NOT NULL
        AND datetime(u.last_seen) >= datetime(?)
      ORDER BY
        CASE
          WHEN datetime(u.last_seen) >= datetime(?) THEN 1
          WHEN datetime(u.last_seen) >= datetime(?) THEN 2
          ELSE 3
        END ASC,
        queued_at ASC
    `)
    .bind(eligibleNow, isoFromMs(now - QUEUE_MAX_IDLE_MS), bucketActive, bucketIdle)
    .all<{ user_id: string; queued_at: string }>()

  // Filter out any user who is already locked in a duel
  const eligible = waiting.results.filter((p) => !inMatchUserIds.has(p.user_id))
  if (eligible.length === 0) return false

  let pairedAny = false
  let i = 0

  // Pair human players together first
  for (; i + 1 < eligible.length; i += 2) {
    const a = eligible[i].user_id
    const b = eligible[i + 1].user_id
    const id = crypto.randomUUID()
    await db
      .prepare(`
        INSERT INTO GameMatches (
          id, user_a, user_b, status, phase, round_seq, max_rounds,
          score_a, score_b, played_cards_a, played_cards_b, rounds_history,
          phase_deadline, phase_version
        )
        VALUES (?, ?, ?, 'lobby', 'lobby', 1, ?, 0, 0, '[]', '[]', '[]', ?, 1)
      `)
      .bind(id, a, b, MATCH_MAX_ROUNDS, now + LOBBY_LOBBY_MS)
      .run()

    await db.prepare("UPDATE LobbyPlayers SET status = 'in_match', waiting_since = NULL WHERE user_id IN (?, ?)").bind(a, b).run()
    const match = await db.prepare('SELECT * FROM GameMatches WHERE id = ?').bind(id).first<GameMatch>()
    if (match) await pushMatchEvent(db, match, 'opened')
    pairedAny = true
  }

  return pairedAny
}

/**
 * Create a fresh 1v1 duel between two specific users (bypassing the queue).
 * Used by the match-invite accept path so a challenged matchup is identical
 * to an auto-paired one. Both users are set in_match and a match event is
 * pushed to each. Assumes callers already verified neither is in a duel.
 */
export async function createDirectMatch(db: D1Turso, userA: string, userB: string, now: number): Promise<GameMatch | null> {
  const id = crypto.randomUUID()
  await db
    .prepare(`
      INSERT INTO GameMatches (
        id, user_a, user_b, status, phase, round_seq, max_rounds,
        score_a, score_b, played_cards_a, played_cards_b, rounds_history,
        phase_deadline, phase_version
      )
      VALUES (?, ?, ?, 'lobby', 'lobby', 1, ?, 0, 0, '[]', '[]', '[]', ?, 1)
    `)
    .bind(id, userA, userB, MATCH_MAX_ROUNDS, now + LOBBY_LOBBY_MS)
    .run()

  await db
    .prepare(`
      INSERT INTO LobbyPlayers (user_id, status, auto_queue, joined_at, waiting_since)
      VALUES (?, 'in_match', 0, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        status = 'in_match',
        auto_queue = 0,
        waiting_since = NULL
    `)
    .bind(userA)
    .run()
  await db
    .prepare(`
      INSERT INTO LobbyPlayers (user_id, status, auto_queue, joined_at, waiting_since)
      VALUES (?, 'in_match', 0, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        status = 'in_match',
        auto_queue = 0,
        waiting_since = NULL
    `)
    .bind(userB)
    .run()
  const match = await db.prepare('SELECT * FROM GameMatches WHERE id = ?').bind(id).first<GameMatch>()
  if (match) await pushMatchEvent(db, match, 'opened')
  return match
}

async function fetchMatch(db: D1Turso, matchId: string): Promise<GameMatch | null> {
  return db.prepare('SELECT * FROM GameMatches WHERE id = ?').bind(matchId).first<GameMatch>()
}

async function setPhase(match: GameMatch, phase: GameMatch['phase'], deadline: number): Promise<void> {
  match.phase = phase
  match.phase_deadline = deadline
  match.phase_version = match.phase_version + 1
}

async function persistPhase(db: D1Turso, match: GameMatch): Promise<void> {
  await db
    .prepare("UPDATE GameMatches SET status = ?, phase = ?, phase_deadline = ?, phase_version = ? WHERE id = ?")
    .bind(match.status, match.phase, match.phase_deadline, match.phase_version, match.id)
    .run()
}

/** Resolve a completed match and clean up lobby players. */
export async function resolveMatch(db: D1Turso, match: GameMatch, now: number, result: string): Promise<void> {
  match.status = 'ended'
  match.phase = 'result'
  match.phase_deadline = now + RESULT_MS
  match.result = result
  // Mark both participants forfeited so `activeMatchForUser` stops returning
  // the ended match for EITHER player during the result window. Without this,
  // a resolved match keeps re-appearing on the staying player's next lobby
  // poll (and on the quitter's) — the "match never ends" zombie panel.
  match.forfeit_user = 'both'
  match.phase_version = match.phase_version + 1
  await db
    .prepare('UPDATE GameMatches SET status = ?, phase = ?, phase_deadline = ?, matched = ?, result = ?, forfeit_user = ?, phase_version = ? WHERE id = ?')
    .bind(match.status, match.phase, match.phase_deadline, match.matched ? 1 : 0, match.result, match.forfeit_user, match.phase_version, match.id)
    .run()

  // Clean up any temporary Recipient access granted during the match.
  // Cards are unique and are never transferred or exchanged between players.
  try {
    const cardsA: string[] = JSON.parse(match.played_cards_a || '[]')
    const cardsB: string[] = JSON.parse(match.played_cards_b || '[]')
    if (match.card_a && !cardsA.includes(match.card_a)) cardsA.push(match.card_a)
    if (match.card_b && !cardsB.includes(match.card_b)) cardsB.push(match.card_b)

    for (const cId of cardsA) {
      await db.prepare('DELETE FROM Recipients WHERE object_id = ? AND recipient_id = ?').bind(cId, match.user_b).run().catch(() => { })
    }
    for (const cId of cardsB) {
      await db.prepare('DELETE FROM Recipients WHERE object_id = ? AND recipient_id = ?').bind(cId, match.user_a).run().catch(() => { })
    }

    if (isPerfectMatch(match)) {
      // Perfect match bonus: 100 points to both players
      await addPoints(db, match.user_a, 100)
      await addPoints(db, match.user_b, 100)
      await db
        .prepare('INSERT INTO LeagueRank (user_id, wins, points, updated_at) VALUES (?, 0, 100, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET points = points + 100, updated_at = CURRENT_TIMESTAMP')
        .bind(match.user_a).run().catch(() => { })
      await db
        .prepare('INSERT INTO LeagueRank (user_id, wins, points, updated_at) VALUES (?, 0, 100, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET points = points + 100, updated_at = CURRENT_TIMESTAMP')
        .bind(match.user_b).run().catch(() => { })
    }
  } catch (err) {
    console.error('[lobby] Failed to finalize match cleanup:', err)
  }

  // Clean up lobby player rows so players are not stuck in_match. Re-joining is
  // opt-in: the player presses "Quick Play" again after the match ends.
  await db
    .prepare('DELETE FROM LobbyPlayers WHERE user_id IN (?, ?)')
    .bind(match.user_a, match.user_b)
    .run()
    .catch(() => { })

  // Archive the resolved duel for the admin-only match-report browser. The
  // GameMatches row itself is deleted a few seconds after the result phase
  // (advanceLobbyUnlocked), so this copy is the only durable record.
  try {
    const isPerfect = isPerfectMatch(match)
    const hasMatch = hasMutualLike(match)
    const endedAt = new Date().toISOString()
    const users = await db
      .prepare('SELECT id, display_name, pfp_url FROM Users WHERE id IN (?, ?)')
      .bind(match.user_a, match.user_b)
      .all<{ id: string; display_name: string | null; pfp_url: string | null }>()
    const nameOf = (uid: string) => {
      const u = users.results?.find((r) => r.id === uid)
      return { name: u?.display_name ?? null, pfp: u?.pfp_url ?? null }
    }
    const a = nameOf(match.user_a)
    const b = nameOf(match.user_b)
    await db
      .prepare(`
        INSERT INTO MatchArchive
          (id, user_a, user_b, user_a_name, user_a_pfp, user_b_name, user_b_pfp,
           score_a, score_b, result, rounds_history, matched, perfect, created_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        match.id,
        match.user_a,
        match.user_b,
        a.name, a.pfp, b.name, b.pfp,
        Number(match.score_a || 0),
        Number(match.score_b || 0),
        result,
        match.rounds_history || '[]',
        hasMatch ? 1 : 0,
        isPerfect ? 1 : 0,
        match.created_at || endedAt,
        endedAt
      )
      .run()
  } catch  {
  }

  // Persistent notification for both players when the duel resolves (the bell
  // surfaces the outcome even if the player is away from the lobby tab).
  try {
    const { createNotification } = await import('./notifications')
    const isPerfect = isPerfectMatch(match)
    const meWon = result === 'winner_a' ? match.user_a : result === 'winner_b' ? match.user_b : null
    const isDraw = result === 'draw'
    const isNoMatch = result === 'no_match'
    const isQuit = result === 'quit'
    const title = isPerfect ? 'Perfect match!' : meWon ? 'You won the match!' : isDraw ? 'Match drawn' : isNoMatch ? 'No match' : 'Match over'
    const body = isPerfect
      ? '5/5 mutual likes — both sides get the cards & +100 each'
      : meWon
        ? 'You won the duel — check the result for your winnings'
        : isQuit
          ? 'Your opponent left — the match has ended'
          : isNoMatch
            ? 'Neither side liked — the match ended without a match'
            : 'Your duel has ended — view the rounds and play again'
    for (const uid of [match.user_a, match.user_b]) {
      const notif = await createNotification(db, uid, 'match_result', title, body, { match_id: match.id, result })
      if (notif) broadcastToUser(uid, { type: 'notification', action: 'new', notification: notif })
    }
  } catch  {
  }
}

async function advanceBotMoves(db: D1Turso, match: GameMatch, now: number): Promise<boolean> {
  const isA = isBotUser(match.user_a)
  const isB = isBotUser(match.user_b)
  if (!isA && !isB) return false

  let modified = false

  if (match.phase === 'pick') {
    if (isA && !match.card_a) {
      let opponentTags: string[] = []
      try {
        const uRow = await db.prepare('SELECT tags FROM Users WHERE id = ?').bind(match.user_b).first<{ tags: string }>()
        if (uRow?.tags) {
          const parsed = JSON.parse(uRow.tags)
          if (Array.isArray(parsed)) opponentTags = parsed
        }
      } catch { }

      const card = await pickBotCard(db, match.id, match.user_a, opponentTags)
      if (card) {
        match.card_a = card
        const played: string[] = JSON.parse(match.played_cards_a || '[]')
        if (!played.includes(card)) played.push(card)
        match.played_cards_a = JSON.stringify(played)
        match.phase_version += 1
        await db.prepare('UPDATE GameMatches SET card_a = ?, played_cards_a = ?, phase_version = ? WHERE id = ?').bind(card, match.played_cards_a, match.phase_version, match.id).run()
        modified = true
      }
    }
    if (isB && !match.card_b) {
      let opponentTags: string[] = []
      try {
        const uRow = await db.prepare('SELECT tags FROM Users WHERE id = ?').bind(match.user_a).first<{ tags: string }>()
        if (uRow?.tags) {
          const parsed = JSON.parse(uRow.tags)
          if (Array.isArray(parsed)) opponentTags = parsed
        }
      } catch { }

      const card = await pickBotCard(db, match.id, match.user_b, opponentTags)
      if (card) {
        match.card_b = card
        const played: string[] = JSON.parse(match.played_cards_b || '[]')
        if (!played.includes(card)) played.push(card)
        match.played_cards_b = JSON.stringify(played)
        match.phase_version += 1
        await db.prepare('UPDATE GameMatches SET card_b = ?, played_cards_b = ?, phase_version = ? WHERE id = ?').bind(card, match.played_cards_b, match.phase_version, match.id).run()
        modified = true
      }
    }
    if (match.card_a && match.card_b) {
      await setPhase(match, 'reveal', now + REVEAL_MS)
      await persistPhase(db, match)
      await pushMatchEvent(db, match, 'reveal')
      return true
    }
  }

  if (match.phase === 'decide') {
    if (isA && !match.decision_a) {
      const dec = Math.random() < 0.85 ? 'like' : (Math.random() < 0.5 ? 'boost' : 'reject')
      match.decision_a = dec
      match.phase_version += 1
      await db.prepare('UPDATE GameMatches SET decision_a = ?, phase_version = ? WHERE id = ?').bind(dec, match.phase_version, match.id).run()
      modified = true
    }
    if (isB && !match.decision_b) {
      const dec = Math.random() < 0.85 ? 'like' : (Math.random() < 0.5 ? 'boost' : 'reject')
      match.decision_b = dec
      match.phase_version += 1
      await db.prepare('UPDATE GameMatches SET decision_b = ?, phase_version = ? WHERE id = ?').bind(dec, match.phase_version, match.id).run()
      modified = true
    }
  }

  return modified
}

/**
 * Advance in-progress matches based on phase deadlines.
 */
async function advanceMatches(db: D1Turso, now: number): Promise<void> {
  const matches = await db
    .prepare("SELECT * FROM GameMatches WHERE status IN ('lobby', 'playing')")
    .bind()
    .all<GameMatch>()

  for (const match of matches.results) {
    const phaseAdvanced = await advanceBotMoves(db, match, now)

    // Re-fetch if bot advanced the phase so we process the new phase in this tick
    if (phaseAdvanced) {
      const refreshed = await fetchMatch(db, match.id)
      if (refreshed) {
        // Copy refreshed state back to match for continued processing
        Object.assign(match, refreshed)
      }
    }

    if (now < match.phase_deadline) continue

    if (match.phase === 'lobby') {
      match.status = 'playing'
      await setPhase(match, 'pick', now + PICK_MS)
      await persistPhase(db, match)
      await pushMatchEvent(db, match, 'phase')
      continue
    }

    if (match.phase === 'pick') {
      // Both players played on time → reveal. Otherwise → forfeit / expired.
      if (match.card_a && match.card_b) {
        await setPhase(match, 'reveal', now + REVEAL_MS)
        await persistPhase(db, match)
        await pushMatchEvent(db, match, 'reveal')
      } else {
        if (!match.card_a && match.card_b) match.forfeit_user = match.user_a
        else if (match.card_a && !match.card_b) match.forfeit_user = match.user_b
        else match.forfeit_user = 'both'
        await db.prepare('UPDATE GameMatches SET forfeit_user = ? WHERE id = ?').bind(match.forfeit_user, match.id).run()
        await resolveMatch(db, match, now, 'expired')
        await pushMatchEvent(db, match, 'cancelled')
      }
      continue
    }

    if (match.phase === 'reveal') {
      await setPhase(match, 'decide', now + DECIDE_MS)
      await persistPhase(db, match)
      await pushMatchEvent(db, match, 'phase')
      continue
    }

    if (match.phase === 'round_result') {
      const nextRound = (match.round_seq || 1) + 1
      const nextDeadline = now + PICK_MS
      match.round_seq = nextRound
      match.status = 'playing'
      match.phase = 'pick'
      match.phase_deadline = nextDeadline
      match.card_a = null
      match.card_b = null
      match.decision_a = null
      match.decision_b = null
      match.phase_version += 1

      await db
        .prepare(`
          UPDATE GameMatches
          SET round_seq = ?, status = 'playing', phase = 'pick', phase_deadline = ?,
              card_a = NULL, card_b = NULL, decision_a = NULL, decision_b = NULL,
              matched = 0, phase_version = ?
          WHERE id = ?
        `)
        .bind(nextRound, nextDeadline, match.phase_version, match.id)
        .run()

      await pushMatchEvent(db, match, 'round_advance')
      continue
    }

    if (match.phase === 'decide') {
      if (!match.decision_a) match.decision_a = 'reject'
      if (!match.decision_b) match.decision_b = 'reject'
      const roundMatched = ['like', 'boost'].includes(match.decision_a || '') && ['like', 'boost'].includes(match.decision_b || '')
      match.matched = roundMatched ? 1 : 0
      if (roundMatched) {
        match.score_a = (match.score_a || 0) + 1
        match.score_b = (match.score_b || 0) + 1
      }

      const history: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')
      history.push({
        round: match.round_seq || 1,
        card_a: match.card_a,
        card_b: match.card_b,
        decision_a: match.decision_a,
        decision_b: match.decision_b,
        matched: roundMatched,
        result: roundMatched ? 'match' : 'no_match',
      })
      match.rounds_history = JSON.stringify(history)

      const maxRounds = match.max_rounds || MATCH_MAX_ROUNDS
      const currentRound = match.round_seq || 1

      if (maxRounds > 1 && currentRound < maxRounds) {
        match.phase = 'round_result'
        match.phase_deadline = now + ROUND_RESULT_MS
        match.phase_version += 1

        await db
          .prepare(`
            UPDATE GameMatches
            SET phase = 'round_result', phase_deadline = ?,
                score_a = ?, score_b = ?, matched = ?, decision_a = ?, decision_b = ?,
                rounds_history = ?, phase_version = ?
            WHERE id = ?
          `)
          .bind(match.phase_deadline, match.score_a, match.score_b, match.matched, match.decision_a, match.decision_b, match.rounds_history, match.phase_version, match.id)
          .run()

        await pushMatchEvent(db, match, 'round_result')
      } else {
        const winnerId = match.score_a > match.score_b ? match.user_a : match.score_b > match.score_a ? match.user_b : null
        const loserId = match.score_a > match.score_b ? match.user_b : match.score_b > match.score_a ? match.user_a : null
        // Match-result points are always awarded on resolution (no mutual-like
        // requirement): the duel winner takes the points, draws split them.
        await recordLeagueRank(db, winnerId, loserId, match.score_a === match.score_b)

        const finalResult =
          match.score_a > match.score_b
            ? 'winner_a'
            : match.score_b > match.score_a
              ? 'winner_b'
              : match.score_a === 0 && match.score_b === 0
                ? 'no_match'
                : 'draw'

        await db
          .prepare(`
            UPDATE GameMatches
            SET score_a = ?, score_b = ?, decision_a = ?, decision_b = ?, rounds_history = ?
            WHERE id = ?
          `)
          .bind(match.score_a, match.score_b, match.decision_a, match.decision_b, match.rounds_history, match.id)
          .run()

        await resolveMatch(db, match, now, finalResult)
        await pushMatchEvent(db, match, 'result')
      }
      continue
    }
  }
}

/**
 * End special-tier matches that have seen no activity for the idle window and
 * re-queue both players.
 */
export async function expireIdleSpecialMatches(db: D1Turso, now: number = Date.now()): Promise<void> {
  const cutoff = isoFromMs(now - SPECIAL_MATCH_IDLE_MS)
  const idle = await db
    .prepare("SELECT id, user_a, user_b FROM TierMatches WHERE status = 'active' AND updated_at IS NOT NULL AND datetime(updated_at) < datetime(?)")
    .bind(cutoff)
    .all<{ id: string; user_a: string; user_b: string }>()
  if (idle.results.length === 0) return

  for (const m of idle.results) {
    await db
      .prepare("UPDATE TierMatches SET status = 'ended', last_result = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .bind(m.id)
      .run()
    await joinLobby(db, m.user_a)
    await joinLobby(db, m.user_b)
  }
}

/** Unlocked core of advanceLobby — call inside withMatchLock only. */
export async function advanceLobbyUnlocked(db: D1Turso, now: number = Date.now(), skipBots = false): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO Lobbies (id, status) VALUES (?, 'waiting')").bind(LOBBY_ID).run()
  await cleanStalePlayers(db, now)
  await expireIdleSpecialMatches(db, now)
  await advanceMatches(db, now)
  await advanceRooms(db, now)
  // Clean up ended matches after deadline (and their match-local bot cards).
  const ended = await db
    .prepare("SELECT id FROM GameMatches WHERE status = 'ended' AND phase = 'result' AND phase_deadline < ?")
    .bind(now - REVEAL_MS - 2000)
    .all<{ id: string }>()
  const endedIds = (ended.results || []).map((r) => r.id)
  // Safety sweep: any row stuck 'ended' but NOT in the clean result state
  // (e.g. resolveMatch crashed between the status write and the phase write)
  // would otherwise sit forever and block neither player from the queue.
  const orphaned = await db
    .prepare("SELECT id FROM GameMatches WHERE status = 'ended' AND (phase != 'result' OR phase_deadline IS NULL OR phase_deadline < ?)")
    .bind(now - RESULT_MS - 2000)
    .all<{ id: string }>()
  for (const r of orphaned.results || []) {
    if (!endedIds.includes(r.id)) endedIds.push(r.id)
  }
  if (endedIds.length > 0) {
    await db
      .prepare(`DELETE FROM GameMatches WHERE id IN (${endedIds.map(() => '?').join(',')})`)
      .bind(...endedIds)
      .run()
    await db
      .prepare(`DELETE FROM MatchCards WHERE room_id IN (${endedIds.map(() => '?').join(',')})`)
      .bind(...endedIds)
      .run()
  }
  await pairFromQueue(db, now, skipBots)
}

/** Advance lobby with option to skip bot pairing (for admin force-match). */
export async function advanceLobbyWithOptions(db: D1Turso, now: number = Date.now(), skipBots = false): Promise<void> {
  await withMatchLock(() => advanceLobbyUnlocked(db, now, skipBots))
}

export async function advanceLobby(db: D1Turso, now: number = Date.now()): Promise<void> {
  await withMatchLock(() => advanceLobbyUnlocked(db, now))
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export async function playMatchCard(db: D1Turso, matchId: string, userId: string, cardId: string): Promise<GameMatch> {
  return withMatchLock(async () => {
    const match = await fetchMatch(db, matchId)
    if (!match) throw lobbyError('Match not found', 404)
    if (match.status !== 'lobby' && match.status !== 'playing') throw lobbyError('Match not active', 410)
    if (match.user_a !== userId && match.user_b !== userId) throw lobbyError('Forbidden', 403)
    if (match.phase !== 'pick' && match.phase !== 'lobby') throw lobbyError('Match is not in the card-picking phase', 409)

    const col = match.user_a === userId ? 'card_a' : 'card_b'
    const playedCol = match.user_a === userId ? 'played_cards_a' : 'played_cards_b'
    if ((col === 'card_a' ? match.card_a : match.card_b)) throw lobbyError('You already played a card this round', 409)

    const playedCards: string[] = JSON.parse((match.user_a === userId ? match.played_cards_a : match.played_cards_b) || '[]')
    const opponent = match.user_a === userId ? match.user_b : match.user_a

    // The player's eligible deck for this duel: every non-story object they
    // own, minus any card originally sent by the opponent. Received cards are
    // intentionally excluded — the client pick grid only surfaces owned cards
    // (deriveMyCards), so exhaustion must be measured against the same set.
    // Canonical cards whose moderation state is not 'active' (hidden/banned)
    // are also excluded so moderated cards cannot enter a match.
    const eligibleRows = await db
      .prepare(`
        SELECT o.id, o.sender_id FROM Objects o
        WHERE o.owner_id = ? AND o.is_story = 0
          AND (o.sender_id IS NULL OR o.sender_id != ?)
          AND NOT EXISTS (
            SELECT 1 FROM Cards c WHERE c.media_object_id = o.id AND c.moderation_state != 'active'
          )
      `)
      .bind(userId, opponent)
      .all<{ id: string; sender_id?: string | null }>()
    const eligible = eligibleRows.results

    // A card may only be played once per match — no re-sending the same card
    // even when the deck is otherwise exhausted (enforced by the 5-card gate
    // so a compliant player always has enough distinct cards for the rounds).
    if (playedCards.includes(cardId)) {
      throw lobbyError('You already played this card in this match', 409)
    }

    const card = eligible.find((c) => c.id === cardId)
    if (!card) throw lobbyError('Card not found or not eligible', 400)
    if (card.sender_id && card.sender_id === opponent) {
      throw lobbyError('You cannot play this card against the player who originally sent it to you', 400)
    }

    if (!playedCards.includes(cardId)) playedCards.push(cardId)
    // Optimistic-guard the write so a stale/duplicate cannot overwrite a card
    // that has since been set by a newer in-flight call.
    const write = await db
      .prepare(`UPDATE GameMatches SET ${col} = ?, ${playedCol} = ?, phase_version = phase_version + 1 WHERE id = ? AND ${col} IS NULL`)
      .bind(cardId, JSON.stringify(playedCards), matchId)
      .run()
    if (Number((write as any).meta?.changes || 0) !== 1) {
      throw lobbyError('You already played a card this round', 409)
    }

    await db
      .prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)')
      .bind(cardId, opponent)
      .run()

    const refreshed = (await fetchMatch(db, matchId))!
    // Re-check status/phase: if the advance tick resolved the match (forfeit /
    // expired / result) between our guard-read and this block, do NOT re-enter
    // a reveal phase over an ended match (that would create an uncollectable
    // zombie row that never advances and never gets cleaned up).
    if (refreshed.status !== 'lobby' && refreshed.status !== 'playing') {
      return refreshed
    }
    if (refreshed.card_a && refreshed.card_b) {
      if (refreshed.status === 'lobby') {
        refreshed.status = 'playing'
        refreshed.phase_version = refreshed.phase_version + 1
      }
      await setPhase(refreshed, 'reveal', Date.now() + REVEAL_MS)
      await persistPhase(db, refreshed)
      await pushMatchEvent(db, refreshed, 'reveal')
    } else {
      await pushMatchEvent(db, refreshed, 'opponent_played')
    }
    return refreshed
  })
}

export async function setMatchDecision(
  db: D1Turso,
  matchId: string,
  userId: string,
  decision: string
): Promise<{ match: GameMatch; matched: boolean; points_awarded: number }> {
  return withMatchLock(async () => {
    if (!['like', 'reject', 'boost'].includes(decision)) {
      throw lobbyError("Invalid decision. Must be 'like', 'reject', or 'boost'.", 400)
    }

    const match = await fetchMatch(db, matchId)
    if (!match) throw lobbyError('Match not found', 404)
    if (match.status !== 'playing') throw lobbyError('Match not active', 410)
    if (match.user_a !== userId && match.user_b !== userId) throw lobbyError('Forbidden', 403)
    if (match.phase !== 'decide' && match.phase !== 'reveal') throw lobbyError('Match is not in the deciding phase', 409)

    // Server-authoritative boost charge enforcement: each player may cast at
    // most DEFAULT_BOOST_CHARGES boosts per match, regardless of client state.
    if (decision === 'boost') {
      const myCol: 'decision_a' | 'decision_b' = match.user_a === userId ? 'decision_a' : 'decision_b'
      const history: RoundHistoryItem[] = JSON.parse(match.rounds_history || '[]')
      const boostsUsed = history.filter((r) => r[myCol] === 'boost').length
      const pendingMine = myCol === 'decision_a' ? match.decision_a : match.decision_b
      if (boostsUsed + (pendingMine === 'boost' ? 1 : 0) >= DEFAULT_BOOST_CHARGES) {
        throw lobbyError('No boosts remaining this match', 400)
      }
    }

    const mine = match.user_a === userId ? 'a' : 'b'
    const theirCard = mine === 'a' ? match.card_b : match.card_a
    if (!theirCard) throw lobbyError('Opponent has not picked a card yet', 409)

    // Bot opponents play match-local MatchCards (never permanent Objects). A
    // human can still decide on them, but no reputation score is recorded
    // because bot cards are ephemeral and not owned by a real user.
    const botCard = await db
      .prepare("SELECT id, owner_id FROM MatchCards WHERE id = ?")
      .bind(theirCard)
      .first<{ id: string; owner_id: string }>()
    if (!botCard) {
      const card = await db
        .prepare('SELECT id FROM Objects WHERE id = ? AND is_story = 0')
        .bind(theirCard)
        .first<{ id: string }>()
      if (!card) throw lobbyError('Opponent card is no longer available', 410)
    }

    const col = mine === 'a' ? 'decision_a' : 'decision_b'
    const write = await db.prepare(`UPDATE GameMatches SET ${col} = ?, phase_version = phase_version + 1 WHERE id = ? AND ${col} IS NULL`).bind(decision, matchId).run()
    if (Number((write as any).meta?.changes || 0) !== 1) {
      throw lobbyError('You already decided this round', 409)
    }
    const result = botCard ? null : await applyLikeDecision(db, userId, theirCard, decision)

    const refreshed = (await fetchMatch(db, matchId))!
    // The decide-phase timer may have resolved this match (auto-reject + requeue)
    // while our guard-read was in flight. If it is no longer playing, back out
    // cleanly instead of resurrecting the ended match into a new round and
    // wiping the current cards / double-awarding points.
    if (refreshed.status !== 'playing' || (refreshed.phase !== 'decide' && refreshed.phase !== 'reveal')) {
      return { match: refreshed, matched: refreshed.matched === 1, points_awarded: 0 }
    }

    const isPositiveA = refreshed.decision_a === 'like' || refreshed.decision_a === 'boost'
    const isPositiveB = refreshed.decision_b === 'like' || refreshed.decision_b === 'boost'
    const roundMatched = Boolean(isPositiveA && isPositiveB)
    refreshed.matched = roundMatched ? 1 : 0

    const resolved = Boolean(refreshed.decision_a && refreshed.decision_b)
    if (resolved) {
      if (roundMatched) {
        refreshed.score_a = (refreshed.score_a || 0) + 1
        refreshed.score_b = (refreshed.score_b || 0) + 1
      }

      const history: RoundHistoryItem[] = JSON.parse(refreshed.rounds_history || '[]')
      history.push({
        round: refreshed.round_seq || 1,
        card_a: refreshed.card_a,
        card_b: refreshed.card_b,
        decision_a: refreshed.decision_a,
        decision_b: refreshed.decision_b,
        matched: roundMatched,
        result: roundMatched ? 'match' : 'no_match',
      })
      refreshed.rounds_history = JSON.stringify(history)

      const maxRounds = refreshed.max_rounds || MATCH_MAX_ROUNDS
      const currentRound = refreshed.round_seq || 1

      // In 5-round duel: ALWAYS play all 5 rounds to completion.
      // An intermediate round (currentRound < maxRounds) transitions to 'round_result'
      // for ROUND_RESULT_MS (3 seconds) so both players see each other's decisions and cards.
      if (maxRounds > 1 && currentRound < maxRounds) {
        refreshed.phase = 'round_result'
        refreshed.phase_deadline = Date.now() + ROUND_RESULT_MS
        refreshed.phase_version += 1

        await db
          .prepare(`
            UPDATE GameMatches
            SET phase = 'round_result', phase_deadline = ?,
                score_a = ?, score_b = ?, matched = ?, rounds_history = ?, phase_version = ?
            WHERE id = ?
          `)
          .bind(refreshed.phase_deadline, refreshed.score_a, refreshed.score_b, refreshed.matched, refreshed.rounds_history, refreshed.phase_version, matchId)
          .run()

        await pushMatchEvent(db, refreshed, 'round_result')
      } else {
        // Final round finished or 1-round match: resolve match
        const winnerId = refreshed.score_a > refreshed.score_b ? refreshed.user_a : refreshed.score_b > refreshed.score_a ? refreshed.user_b : null
        const loserId = refreshed.score_a > refreshed.score_b ? refreshed.user_b : refreshed.score_b > refreshed.score_a ? refreshed.user_a : null
        // Match-result points are always awarded on resolution (no mutual-like
        // requirement): the duel winner takes the points, draws split them.
        await recordLeagueRank(db, winnerId, loserId, refreshed.score_a === refreshed.score_b)

        const finalResult =
          refreshed.score_a > refreshed.score_b
            ? 'winner_a'
            : refreshed.score_b > refreshed.score_a
              ? 'winner_b'
              : refreshed.score_a === 0 && refreshed.score_b === 0
                ? 'no_match'
                : 'draw'

        await db
          .prepare(`
            UPDATE GameMatches
            SET score_a = ?, score_b = ?, rounds_history = ?
            WHERE id = ?
          `)
          .bind(refreshed.score_a, refreshed.score_b, refreshed.rounds_history, matchId)
          .run()

        await resolveMatch(db, refreshed, Date.now(), finalResult)
        await pushMatchEvent(db, refreshed, 'result')
      }
    } else {
      await db.prepare('UPDATE GameMatches SET matched = ? WHERE id = ?').bind(refreshed.matched, matchId).run()
      await pushMatchEvent(db, refreshed, 'decided')
    }

    return { match: refreshed, matched: roundMatched, points_awarded: result?.points_awarded ?? 0 }
  })
}

export async function quitMatch(db: D1Turso, matchId: string, userId: string): Promise<void> {
  return withMatchLock(async () => {
    // Clear user from in_match immediately
    await db.prepare("UPDATE LobbyPlayers SET status = 'waiting' WHERE user_id = ?").bind(userId).run().catch(() => { })

    const match = await fetchMatch(db, matchId)
    if (!match) return
    if (match.user_a !== userId && match.user_b !== userId) return

    if (match.status === 'ended') {
      await db.prepare('UPDATE GameMatches SET forfeit_user = ? WHERE id = ?').bind(userId, matchId).run().catch(() => { })
      // Clean up LobbyPlayers so activeMatchForUser doesn't return this match
      await db.prepare('DELETE FROM LobbyPlayers WHERE user_id IN (?, ?)').bind(match.user_a, match.user_b).run().catch(() => { })
      broadcastToUser(userId, { type: 'match', action: 'cancelled', match: null })
      broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
      return
    }

    match.forfeit_user = userId
    await db.prepare('UPDATE GameMatches SET forfeit_user = ? WHERE id = ?').bind(userId, matchId).run().catch(() => { })

    const winner = match.user_a === userId ? match.user_b : match.user_a
    await recordLeagueRank(db, winner, userId).catch(() => { })

    const others = match.user_a === userId ? match.user_b : match.user_a
    await resolveMatch(db, match, Date.now(), 'quit')

    broadcastToUser(userId, { type: 'match', action: 'cancelled', match: null })
    const stayerSnap = await snapshotForUser(db, match, others)
    broadcastToUser(others, { type: 'match', action: 'opponent_left', match: stayerSnap })
    broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  })
}

// ---------------------------------------------------------------------------
// State snapshot
// ---------------------------------------------------------------------------

export interface LobbySnapshot {
  status: string
  waiting_count: number
  fallback_starts_in_ms: number | null
  auto_queue?: boolean
  players: Array<{
    user_id: string
    status: string
    auto_queue?: boolean
    joined_at: string
    waiting_since?: string | null
    display_name?: string | null
    pfp_url?: string | null
    tags?: string[] | string | null
  }>
  match?: MatchSnapshot | null
  active_matches?: LiveMatchSummary[]
}

export async function getLobbyState(
  db: D1Turso,
  userId: string | null,
  now: number = Date.now(),
  shouldAdvance: boolean = true
): Promise<LobbySnapshot> {
  if (userId) {
    await db.prepare('UPDATE Users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').bind(userId).run().catch(() => { })
  }

  if (shouldAdvance) await advanceLobby(db, now)

  const onlineCutoff = isoFromMs(now - ONLINE_CUTOFF_MS)

  const players = await db
    .prepare(`
      SELECT lp.user_id, lp.status, lp.auto_queue, lp.joined_at, COALESCE(lp.waiting_since, lp.joined_at) AS waiting_since, u.display_name, u.pfp_url, u.tags
      FROM LobbyPlayers lp
      LEFT JOIN Users u ON u.id = lp.user_id
      WHERE u.last_seen IS NOT NULL
        AND datetime(u.last_seen) >= datetime(?)
        AND COALESCE(u.is_admin, 0) = 0
      ORDER BY lp.joined_at ASC
    `)
    .bind(onlineCutoff)
    .all<any>()

  const waitingCount = players.results.filter((p) => p.status === 'waiting' && (p.auto_queue ?? 1) === 1).length

  let match: MatchSnapshot | null = null
  if (userId) {
    const active = await activeMatchForUser(db, userId, now)
    if (active) match = await snapshotForUser(db, active, userId)
  }

  const activeMatches = await getActiveMatches(db)
  const selfRow = userId ? players.results.find((p: any) => p.user_id === userId) : null

  return {
    status: 'waiting',
    waiting_count: waitingCount,
    fallback_starts_in_ms: null,
    auto_queue: selfRow ? Boolean(selfRow.auto_queue ?? 1) : false,
    players: players.results.map((player: any) => {
      let parsedTags: string[] = []
      if (player.tags) {
        try {
          const p = JSON.parse(player.tags)
          parsedTags = Array.isArray(p) ? p.map(String) : []
        } catch {
          parsedTags = typeof player.tags === 'string' ? player.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []
        }
      }
      return {
        ...player,
        auto_queue: Boolean(player.auto_queue ?? 1),
        tags: parsedTags,
      }
    }),
    match,
    active_matches: activeMatches,
  }
}

export interface LobbyImageRow {
  id: string
  owner_id: string
  content_url: string
  mime_type: string | null
  caption: string | null
  tags: string | null
  likes_count: number
  created_at: string
  expires_at: string
  uploader_name: string | null
  reports_count: number
  hidden_at: string | null
  is_proxied: number
  proxied_mime: string | null
}

export async function setLobbyImage(
  db: D1Turso,
  ownerId: string,
  opts: {
    id?: string
    contentUrl: string
    caption?: string | null
    tags?: string[] | null
    mimeType?: string | null
    isProxied?: number
    proxiedMime?: string | null
  }
): Promise<LobbyImageRow> {
  // Allow the caller to supply a pre-generated id so a paired blob write
  // (lobby/<id> under BUCKET) and this row INSERT can reference the same
  // key. When omitted, fall back to a fresh UUID to keep existing callers
  // (tests, scripts) unchanged.
  const id = opts.id || crypto.randomUUID()
  const expiresAt = isoFromMs(Date.now() + LOBBY_IMAGE_TTL_MS)
  const isProxied = opts.isProxied ?? 0
  const proxiedMime = opts.proxiedMime ?? null
  const tags = Array.isArray(opts.tags) ? JSON.stringify(opts.tags) : null
  // Lookup uploader display_name once so the LIST endpoint can show "uploaded
  // by <name>" without a join per row.
  const uploader = await db
    .prepare("SELECT display_name FROM Users WHERE id = ?")
    .bind(ownerId)
    .first<{ display_name: string | null }>()
  const uploaderName = uploader?.display_name || null
  await db
    .prepare(
      "INSERT INTO LobbyImages (id, owner_id, content_url, mime_type, caption, tags, expires_at, uploader_name, is_proxied, proxied_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, ownerId, opts.contentUrl, opts.mimeType || null, opts.caption || null, tags, expiresAt, uploaderName, isProxied, proxiedMime)
    .run()
  return {
    id,
    owner_id: ownerId,
    content_url: opts.contentUrl,
    mime_type: opts.mimeType || null,
    caption: opts.caption || null,
    tags,
    likes_count: 0,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    uploader_name: uploaderName,
    reports_count: 0,
    hidden_at: null,
    is_proxied: isProxied,
    proxied_mime: proxiedMime,
  }
}

function decodeLobbyDataUrl(url: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) return null
  return { mimeType: match[1], bytes: new Uint8Array(Buffer.from(match[2], 'base64')) }
}

/** Promote a lobby upload to a permanent post owned by its uploader. */
export async function promoteLobbyImageToPost(
  db: D1Turso,
  bucket: LocalBlobStore | undefined,
  image: Pick<LobbyImageRow, 'id' | 'owner_id' | 'content_url' | 'mime_type' | 'caption' | 'tags' | 'likes_count' | 'created_at'>,
): Promise<boolean> {
  if (await db.prepare('SELECT id FROM Objects WHERE id = ?').bind(image.id).first()) return false

  const inline = decodeLobbyDataUrl(image.content_url)
  let bytes = inline?.bytes || null
  const mimeType = inline?.mimeType || image.mime_type || 'image/jpeg'
  if (!bytes && bucket) {
    const blob = await bucket.get(`lobby/${image.id}`)
    if (blob?.body) bytes = new Uint8Array(await new Response(blob.body).arrayBuffer())
  }
  if (!bytes || bytes.length === 0) return false

  const contentUrl = bytes.length <= 128 * 1024
    ? `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
    : `/api/objects/${image.id}`
  if (bytes.length > 128 * 1024 && bucket) {
    await bucket.put(`objects/${image.id}`, encryptBlob(bytes), { httpMetadata: { contentType: mimeType } })
  }

  await db.prepare(`
    INSERT INTO Objects (id, owner_id, size_bytes, mime_type, created_at, content_url, post_caption, post_tags, like_count, is_public, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
  `).bind(
    image.id,
    image.owner_id,
    bytes.length,
    mimeType,
    image.created_at,
    contentUrl,
    image.caption || null,
    image.tags || null,
    Number(image.likes_count || 0),
  ).run()
  await db.prepare('UPDATE Users SET posts_count = COALESCE(posts_count, 0) + 1 WHERE id = ?').bind(image.owner_id).run().catch(() => { })
  return true
}

export async function promoteLobbyImagesToPosts(db: D1Turso, bucket?: LocalBlobStore): Promise<number> {
  const rows = await db.prepare(`
    SELECT id, owner_id, content_url, mime_type, caption, tags, likes_count, created_at
    FROM LobbyImages WHERE content_url IS NOT NULL AND content_url != ''
  `).all<LobbyImageRow>()
  let promoted = 0
  for (const image of rows.results || []) {
    if (await promoteLobbyImageToPost(db, bucket, image)) promoted += 1
  }
  return promoted
}

export async function likeLobbyImage(db: D1Turso, imageId: string, userId: string): Promise<{ likes_count: number }> {
  // Insert into the per-user audit ledger (LobbyLikes) — ignore duplicate so
  // a re-like from the same user is a no-op rather than a count increment.
  await db
    .prepare("INSERT OR IGNORE INTO LobbyLikes (user_id, image_id) VALUES (?, ?)")
    .bind(userId, imageId)
    .run()
  // Bump the denormalised counter only when a new like actually happened.
  await db
    .prepare('UPDATE LobbyImages SET likes_count = (SELECT COUNT(*) FROM LobbyLikes WHERE image_id = ?) WHERE id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime(\'now\'))')
    .bind(imageId, imageId)
    .run()
  const row = await db.prepare('SELECT likes_count FROM LobbyImages WHERE id = ?').bind(imageId).first<{ likes_count: number }>()
  return { likes_count: Number(row?.likes_count || 0) }
}

export async function getLobbyImageLikers(db: D1Turso, imageId: string, limit = 25): Promise<{ display_name: string | null; user_id: string }[]> {
  const rows = await db
    .prepare(
      `SELECT LobbyLikes.user_id, Users.display_name
       FROM LobbyLikes
       LEFT JOIN Users ON Users.id = LobbyLikes.user_id
       WHERE LobbyLikes.image_id = ?
       ORDER BY LobbyLikes.created_at DESC
       LIMIT ?`
    )
    .bind(imageId, limit)
    .all<{ display_name: string | null; user_id: string }>()
  return rows.results
}

export async function addLobbyComment(
  db: D1Turso,
  imageId: string,
  userId: string,
  body: string
): Promise<{ id: string; image_id: string; user_id: string; body: string; created_at: string; display_name: string | null }> {
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await db
    .prepare("INSERT INTO LobbyComments (id, image_id, user_id, body) VALUES (?, ?, ?, ?)")
    .bind(id, imageId, userId, body)
    .run()
  const uploader = await db
    .prepare("SELECT display_name FROM Users WHERE id = ?")
    .bind(userId)
    .first<{ display_name: string | null }>()
  return { id, image_id: imageId, user_id: userId, body, created_at: createdAt, display_name: uploader?.display_name || null }
}

export async function getLobbyComments(db: D1Turso, imageId: string): Promise<{ id: string; user_id: string; body: string; created_at: string; display_name: string | null }[]> {
  const rows = await db
    .prepare(
      `SELECT LobbyComments.id, LobbyComments.user_id, LobbyComments.body, LobbyComments.created_at, Users.display_name
       FROM LobbyComments
       LEFT JOIN Users ON Users.id = LobbyComments.user_id
       WHERE LobbyComments.image_id = ? AND LobbyComments.hidden_at IS NULL
       ORDER BY LobbyComments.created_at ASC
       LIMIT 200`
    )
    .bind(imageId)
    .all<{ id: string; user_id: string; body: string; created_at: string; display_name: string | null }>()
  return rows.results
}

export async function deleteLobbyComment(db: D1Turso, commentId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  const row = await db
    .prepare("SELECT user_id FROM LobbyComments WHERE id = ?")
    .bind(commentId)
    .first<{ user_id: string }>()
  if (!row) return false
  if (!isAdmin && row.user_id !== userId) return false
  await db.prepare("UPDATE LobbyComments SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?").bind(commentId).run()
  return true
}

export async function getLobbyImages(db: D1Turso): Promise<LobbyImageRow[]> {
  const rows = await db
    .prepare(`
      SELECT id, owner_id, content_url, mime_type, caption, tags, likes_count, created_at, expires_at,
             uploader_name, reports_count, hidden_at, is_proxied, proxied_mime
      FROM LobbyImages
      WHERE (content_url IS NOT NULL AND content_url != '')
        AND hidden_at IS NULL
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY created_at DESC
      LIMIT 100
    `)
    .all<LobbyImageRow>()
  return rows.results
}
