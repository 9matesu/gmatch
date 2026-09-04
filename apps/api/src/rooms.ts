import type { D1Turso } from './db'
import {
  LOBBY_PICK_SECONDS,
  LOBBY_REVEAL_SECONDS,
  LOBBY_DECIDE_SECONDS,
  ROOM_START_SECONDS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  ROOM_MAX_ROUNDS,
  LEAGUE_CHAMPION_POINTS,
  MatchRoom,
  RoomPair,
  RoomMember,
  RoomSnapshot,
  MatchCard,
  LeagueEntry,
} from '@orbit/shared'
import { addPoints } from './game'
import { broadcastToRoom } from './ws-bus'
import crypto from 'node:crypto'

const PICK_MS = LOBBY_PICK_SECONDS * 1000
const REVEAL_MS = LOBBY_REVEAL_SECONDS * 1000
const DECIDE_MS = LOBBY_DECIDE_SECONDS * 1000
const START_MS = ROOM_START_SECONDS * 1000

/** Rooms stuck in 'open' with nobody filling them for 10 minutes are closed. */
const STALE_ROOM_MS = 10 * 60 * 1000

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

export interface RoomError extends Error {
  status: number
}

function roomError(message: string, status: number): RoomError {
  const err = new Error(message) as RoomError
  err.status = status
  return err
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(crypto.randomBytes(4).readUInt32BE(0) / 0x100000000 * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function fetchRoom(db: D1Turso, roomId: string): Promise<any | null> {
  return db.prepare('SELECT * FROM MatchRooms WHERE id = ?').bind(roomId).first<any>()
}

async function activeJoinedCount(db: D1Turso, roomId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM MatchRoomPlayers WHERE room_id = ? AND status = 'joined'")
    .bind(roomId)
    .first<{ n: number }>()
  return Number(row?.n || 0)
}

function notifyRooms() {
  broadcastToRoom('lobby', { type: 'lobby', action: 'rooms' })
}

async function roomMembers(db: D1Turso, roomId: string): Promise<Array<RoomMember & { tags: string[] }>> {
  const rows = await db
    .prepare(`
      SELECT m.user_id, m.status, u.display_name, u.pfp_url, u.tags
      FROM MatchRoomPlayers m
      LEFT JOIN Users u ON u.id = m.user_id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC
    `)
    .bind(roomId)
    .all<any>()
  return rows.results.map((m) => ({
    user_id: m.user_id,
    status: m.status,
    display_name: m.display_name ?? null,
    pfp_url: m.pfp_url ?? null,
    tags: (() => {
      if (!m.tags) return []
      try {
        const p = JSON.parse(m.tags)
        return Array.isArray(p) ? p.map(String) : []
      } catch {
        return typeof m.tags === 'string' ? m.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []
      }
    })(),
  }))
}

/** Resolve a card (match-local or deck Object) to its display URL. */
export async function resolveCardUrl(db: D1Turso, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const trimmed = id.trim()
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/api/')) {
    return trimmed
  }
  const mc = await db.prepare('SELECT content_url FROM MatchCards WHERE id = ?').bind(trimmed).first<{ content_url: string }>()
  if (mc?.content_url) return mc.content_url
  const obj = await db.prepare('SELECT content_url FROM Objects WHERE id = ?').bind(trimmed).first<{ content_url: string | null }>()
  if (obj?.content_url) return obj.content_url
  const objExists = await db.prepare('SELECT 1 FROM Objects WHERE id = ?').bind(trimmed).first()
  if (objExists) return `/api/objects/${trimmed}`
  return null
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export async function createRoom(db: D1Turso, userId: string, name?: string): Promise<MatchRoom> {
  // Allow only 1 active room per user at a time: close any existing open/countdown rooms by this creator
  await db
    .prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND status IN ('open', 'countdown')")
    .bind(userId)
    .run()

  const id = crypto.randomUUID()
  let roomName = (name || '').trim().slice(0, 64)
  if (!roomName) {
    const user = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(userId).first<{ display_name: string | null }>()
      roomName = `${user?.display_name?.trim() || 'Unknown User'}'s Arena`
  }
  await db
    .prepare("INSERT INTO MatchRooms (id, name, owner_id, status, phase) VALUES (?, ?, ?, 'open', 'waiting')")
    .bind(id, roomName, userId)
    .run()
  await db.prepare("INSERT INTO MatchRoomPlayers (room_id, user_id, status, created_at) VALUES (?, ?, 'joined', CURRENT_TIMESTAMP)").bind(id, userId).run()
  notifyRooms()
  return getMatchRoom(db, id)
}

export async function joinRoom(db: D1Turso, userId: string, roomId: string, now: number = Date.now()): Promise<MatchRoom> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)
  if (room.status !== 'open' && room.status !== 'countdown') throw roomError('Room already started', 409)

  const existing = await db
    .prepare('SELECT 1 FROM MatchRoomPlayers WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
  if (existing) throw roomError('Already in this room', 409)

  const count = await activeJoinedCount(db, roomId)
  if (count >= room.capacity) throw roomError('Room is full', 409)

  await db.prepare("INSERT INTO MatchRoomPlayers (room_id, user_id, status, created_at) VALUES (?, ?, 'joined', CURRENT_TIMESTAMP)").bind(roomId, userId).run()

  const after = count + 1
  if (after >= ROOM_MIN_PLAYERS && room.status === 'open') {
    await db
      .prepare("UPDATE MatchRooms SET status = 'countdown', phase = 'countdown', pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(now + START_MS, roomId)
      .run()
  }
  notifyRooms()
  return getMatchRoom(db, roomId)
}

export async function updateRoom(db: D1Turso, userId: string, roomId: string, name?: string): Promise<MatchRoom> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)
  if (room.owner_id !== userId) throw roomError('Only room creator can edit this room', 403)
  const roomName = (name || '').trim().slice(0, 64) || room.name
  await db.prepare('UPDATE MatchRooms SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(roomName, roomId).run()
  notifyRooms()
  return getMatchRoom(db, roomId)
}

export async function forceStartRoom(db: D1Turso, userId: string, roomId: string, now: number = Date.now()): Promise<MatchRoom> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)
  if (room.owner_id !== userId) throw roomError('Only host can start the room', 403)
  const count = await activeJoinedCount(db, roomId)
  if (count < ROOM_MIN_PLAYERS) throw roomError(`Need at least ${ROOM_MIN_PLAYERS} players to start`, 400)
  await startTournament(db, room, now)
  notifyRooms()
  return getMatchRoom(db, roomId)
}

export async function deleteRoom(db: D1Turso, userId: string, roomId: string): Promise<void> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)
  if (room.owner_id !== userId) throw roomError('Only room creator can delete this room', 403)
  await db.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roomId).run()
  await db.prepare("UPDATE MatchRoomPlayers SET status = 'eliminated' WHERE room_id = ?").bind(roomId).run()
  notifyRooms()
}

export async function leaveRoom(db: D1Turso, userId: string, roomId: string, now: number = Date.now()): Promise<void> {
  const room = await fetchRoom(db, roomId)
  if (!room) return

  if (room.status === 'open' || room.status === 'countdown') {
    await db.prepare('DELETE FROM MatchRoomPlayers WHERE room_id = ? AND user_id = ?').bind(roomId, userId).run()
    const remaining = await activeJoinedCount(db, roomId)
    if (remaining === 0) {
      await db.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roomId).run()
    } else if (remaining < ROOM_MIN_PLAYERS) {
      await db
        .prepare("UPDATE MatchRooms SET status = 'open', phase = 'waiting', pair_deadline = NULL, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(roomId)
        .run()
    }
    notifyRooms()
    return
  }

  if (room.status === 'live') {
    // Mid-tournament abandonment: the leaver is eliminated and their unfinished
    // duels become solo byes for the remaining opponent.
    await db
      .prepare("UPDATE MatchRoomPlayers SET status = 'eliminated' WHERE room_id = ? AND user_id = ? AND status = 'joined'")
      .bind(roomId, userId)
      .run()

    const pairs = await db
      .prepare("SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND status IN ('pending', 'playing')")
      .bind(roomId, room.round_seq)
      .all<RoomPair>()
    for (const p of pairs.results) {
      const partner = p.user_a === userId ? p.user_b : p.user_a
      if (partner) {
        await db
          .prepare("UPDATE RoomDuelPairs SET user_a = ?, user_b = NULL, status = 'done', matched = 1 WHERE id = ?")
          .bind(partner, p.id)
          .run()
      } else {
        await db.prepare("UPDATE RoomDuelPairs SET status = 'done', matched = 0 WHERE id = ?").bind(p.id).run()
      }
    }
    await resolveAndAdvanceRound(db, roomId, now)
    notifyRooms()
  }
}

/** Autoqueue: fill the single filling room, otherwise auto-create one. */
export async function autoQueue(db: D1Turso, userId: string): Promise<MatchRoom> {
  const rows = await db
    .prepare(`
      SELECT r.id FROM MatchRooms r
      WHERE r.status IN ('open', 'countdown')
        AND (SELECT COUNT(*) FROM MatchRoomPlayers m WHERE m.room_id = r.id AND m.status = 'joined') < r.capacity
      ORDER BY r.created_at ASC
    `)
    .bind()
    .all<{ id: string }>()

  if (rows.results.length === 1) {
    return joinRoom(db, userId, rows.results[0].id).catch(() => createRoom(db, userId))
  }
  return createRoom(db, userId)
}

// ---------------------------------------------------------------------------
// Match-local cards
// ---------------------------------------------------------------------------

/** Add a card image for tournament use only — never an Object, never in your deck. */
export async function addMatchCard(db: D1Turso, roomId: string, ownerId: string, contentUrl: string): Promise<MatchCard> {
  const id = `mcard-${crypto.randomUUID()}`
  await db
    .prepare("INSERT INTO MatchCards (id, room_id, owner_id, content_url) VALUES (?, ?, ?, ?)")
    .bind(id, roomId, ownerId, contentUrl)
    .run()
  return { id, room_id: roomId, owner_id: ownerId, content_url: contentUrl, created_at: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Tournament engine
// ---------------------------------------------------------------------------

async function startTournament(db: D1Turso, room: any, now: number): Promise<void> {
  const members = await roomMembers(db, room.id)
  const active = members.filter((m) => m.status === 'joined').map((m) => m.user_id)
  if (active.length < ROOM_MIN_PLAYERS) return

  await createRoundPairs(db, room.id, active, 1)
  await db
    .prepare("UPDATE MatchRooms SET status = 'live', phase = 'pick', round_seq = 1, pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(now + PICK_MS, room.id)
    .run()
}

/** Pair up an ordered list of active users into this round's duels.
 *  Odd player out gets a byepass (auto-advance) so the round stays paired. */
async function createRoundPairs(db: D1Turso, roomId: string, players: string[], roundSeq: number): Promise<void> {
  const ids = shuffled(players)
  for (let i = 0; i < ids.length; i += 2) {
    if (i + 1 >= ids.length) {
      await db
        .prepare("INSERT INTO RoomDuelPairs (id, room_id, round_seq, user_a, user_b, status) VALUES (?, ?, ?, ?, NULL, 'byepass')")
        .bind(crypto.randomUUID(), roomId, roundSeq, ids[i])
        .run()
    } else {
      await db
        .prepare("INSERT INTO RoomDuelPairs (id, room_id, round_seq, user_a, user_b, status) VALUES (?, ?, ?, ?, ?, 'playing')")
        .bind(crypto.randomUUID(), roomId, roundSeq, ids[i], ids[i + 1])
        .run()
    }
  }
}

async function roundPairs(db: D1Turso, roomId: string, roundSeq: number): Promise<RoomPair[]> {
  const rows = await db
    .prepare('SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? ORDER BY created_at ASC, rowid ASC')
    .bind(roomId, roundSeq)
    .all<RoomPair>()
  return rows.results
}

/** Count a player's mutual-match wins within a room (used for the round-cap fallback). */
async function playerMatchStreak(db: D1Turso, roomId: string, userId: string): Promise<number> {
  const rows = await db
    .prepare("SELECT COUNT(*) AS n FROM RoomDuelPairs WHERE room_id = ? AND matched = 1 AND (user_a = ? OR user_b = ?)")
    .bind(roomId, userId, userId)
    .first<{ n: number }>()
  return Number(rows?.n || 0)
}

/** Compute survivors, mark eliminated/champion players and seed the next round
 *  (or end the room). Called once every pair in the current round is settled. */
async function resolveAndAdvanceRound(db: D1Turso, roomId: string, now: number): Promise<void> {
  const room = await fetchRoom(db, roomId)
  if (!room || room.status !== 'live') return

  const allPairs = await roundPairs(db, roomId, room.round_seq)
  const liveCount = allPairs.filter((p) => p.status !== 'done' && p.status !== 'byepass').length

  // Not everything settled yet — never eliminate anyone before the round is done.
  if (liveCount > 0) return

  const pairing = allPairs.filter((p) => p.status !== 'byepass')
  const survivors = new Set<string>()

  for (const p of pairing) {
    if (p.status === 'done' && p.matched) {
      if (p.user_a) survivors.add(p.user_a)
      if (p.user_b) survivors.add(p.user_b)
    }
  }

  // Solo byepass pairs always carry their player forward.
  for (const p of allPairs) {
    if (p.status === 'byepass' && p.user_a) survivors.add(p.user_a)
  }

  const members = await roomMembers(db, roomId)
  const joined = members.filter((m) => m.status === 'joined')

  // Any joined member not a survivor is eliminated.
  for (const m of joined) {
    if (!survivors.has(m.user_id)) {
      await db
        .prepare("UPDATE MatchRoomPlayers SET status = 'eliminated' WHERE room_id = ? AND user_id = ? AND status = 'joined'")
        .bind(roomId, m.user_id)
        .run()
    }
  }

  const alive = joined.filter((m) => survivors.has(m.user_id)).map((m) => m.user_id)

  // The 1v1 final: this just-resolved round had exactly two distinct fighters
  // and they mutually matched — crown both co-champions.
  const distinct = new Set(allPairs.flatMap((p) => [p.user_a, p.user_b].filter(Boolean))).size
  if (distinct <= 2 && alive.length === 2) {
    for (const u of alive) {
      await db
        .prepare("UPDATE MatchRoomPlayers SET status = 'champion' WHERE room_id = ? AND user_id = ?")
        .bind(roomId, u)
        .run()
      await recordChampion(db, roomId, u)
    }
    await db.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', pair_deadline = NULL, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roomId).run()
    return
  }

  if (alive.length === 0) {
    await db.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', pair_deadline = NULL, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roomId).run()
    return
  }

  if (alive.length === 1) {
    await db
      .prepare("UPDATE MatchRoomPlayers SET status = 'champion' WHERE room_id = ? AND user_id = ?")
      .bind(roomId, alive[0])
      .run()
    await recordChampion(db, roomId, alive[0])
    await db.prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', pair_deadline = NULL, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(roomId).run()
    return
  }

  let finalists = alive
  if (room.round_seq >= ROOM_MAX_ROUNDS && alive.length > 2) {
    // Round cap: force the top two (by mutual-match streak) into the 1v1.
    const ranked = await Promise.all(alive.map(async (u) => ({ u, streak: await playerMatchStreak(db, roomId, u) })))
    ranked.sort((a, b) => b.streak - a.streak)
    finalists = [ranked[0].u, ranked[1].u]
    for (const m of alive) {
      if (!finalists.includes(m)) {
        await db.prepare("UPDATE MatchRoomPlayers SET status = 'eliminated' WHERE room_id = ? AND user_id = ? AND status = 'joined'").bind(roomId, m).run()
      }
    }
  }

  const nextSeq = Number(room.round_seq) + 1
  await createRoundPairs(db, roomId, finalists, nextSeq)
  await db
    .prepare("UPDATE MatchRooms SET status = 'live', phase = 'pick', round_seq = ?, pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nextSeq, now + PICK_MS, roomId)
    .run()
}

async function recordChampion(db: D1Turso, roomId: string, userId: string): Promise<void> {
  // Champion points only count when the champion actually had a mutual-like
  // connection somewhere in the room battle (a successful match).
  const pair = await db
    .prepare('SELECT COUNT(*) AS n FROM RoomDuelPairs WHERE room_id = ? AND (user_a = ? OR user_b = ?) AND matched = 1')
    .bind(roomId, userId, userId)
    .first<{ n: number }>()
  if (Number(pair?.n || 0) === 0) return
  await db
    .prepare(`
      INSERT INTO LeagueRank (user_id, wins, points, updated_at)
      VALUES (?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        wins = wins + 1,
        points = points + ?,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(userId, LEAGUE_CHAMPION_POINTS, LEAGUE_CHAMPION_POINTS)
    .run()
  await addPoints(db, userId, LEAGUE_CHAMPION_POINTS)
}

/** A settled pair where both like = a mutual match; everything else is a miss. */
async function settlePair(db: D1Turso, pairId: string, decisions: { a: string; b: string }): Promise<void> {
  const matched = decisions.a === 'like' && decisions.b === 'like' ? 1 : 0
  await db.prepare("UPDATE RoomDuelPairs SET status = 'done', matched = ? WHERE id = ?").bind(matched, pairId).run()
}

async function allRoundPairsDone(db: D1Turso, roomId: string, roundSeq: number): Promise<boolean> {
  const rows = await db
    .prepare("SELECT COUNT(*) AS n FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND status NOT IN ('done', 'byepass')")
    .bind(roomId, roundSeq)
    .first<{ n: number }>()
  return Number(rows?.n || 0) === 0
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export async function playRoomCard(db: D1Turso, roomId: string, userId: string, cardId: string, now: number = Date.now()): Promise<void> {
  const room = await fetchRoom(db, roomId)
  if (!room || room.status !== 'live') throw roomError('Room not active', 410)
  if (room.phase !== 'pick') throw roomError('Not in the card-picking phase', 409)

  const pair = await db
    .prepare("SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND (user_a = ? OR user_b = ?) AND status = 'playing'")
    .bind(roomId, room.round_seq, userId, userId)
    .first<RoomPair>()
  if (!pair) throw roomError('No active duel for this round', 409)

  // Accept match-local cards (any room member may have just uploaded) or your own deck objects.
  const mc = await db.prepare('SELECT owner_id FROM MatchCards WHERE id = ?').bind(cardId).first<{ owner_id: string }>()
  const obj = await db.prepare('SELECT owner_id FROM Objects WHERE id = ? AND is_story = 0').bind(cardId).first<{ owner_id: string }>()
  if (mc && mc.owner_id !== userId) throw roomError('Card not yours', 403)
  if (!mc && (!obj || obj.owner_id !== userId)) throw roomError('Card not found or not eligible', 400)

  const col = pair.user_a === userId ? 'card_a' : 'card_b'
  await db.prepare(`UPDATE RoomDuelPairs SET ${col} = ? WHERE id = ?`).bind(cardId, pair.id).run()

  const refreshed = await db.prepare('SELECT * FROM RoomDuelPairs WHERE id = ?').bind(pair.id).first<RoomPair>()
  if (refreshed && refreshed.card_a && refreshed.card_b) {
    const allCards = await db
      .prepare("SELECT COUNT(*) AS n FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND status = 'playing' AND (card_a IS NULL OR card_b IS NULL)")
      .bind(roomId, room.round_seq)
      .first<{ n: number }>()
    if (Number(allCards?.n || 0) === 0) {
      await db
        .prepare("UPDATE MatchRooms SET phase = 'reveal', pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(now + REVEAL_MS, roomId)
        .run()
    }
  }
  notifyRooms()
}

export async function setRoomDecision(
  db: D1Turso,
  roomId: string,
  userId: string,
  decision: string,
  now: number = Date.now()
): Promise<{ matched: boolean }> {
  if (decision !== 'like' && decision !== 'reject') throw roomError("Invalid decision. Must be 'like' or 'reject'.", 400)
  const room = await fetchRoom(db, roomId)
  if (!room || room.status !== 'live') throw roomError('Room not active', 410)
  if (room.phase !== 'decide' && room.phase !== 'reveal') throw roomError('Not in the deciding phase', 409)

  const pair = await db
    .prepare("SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND (user_a = ? OR user_b = ?) AND status = 'playing'")
    .bind(roomId, room.round_seq, userId, userId)
    .first<RoomPair>()
  if (!pair) throw roomError('No active duel for this round', 409)

  const theirCard = pair.user_a === userId ? pair.card_b : pair.card_a
  if (!theirCard) throw roomError('Opponent has not picked a card yet', 409)

  const col = pair.user_a === userId ? 'decision_a' : 'decision_b'
  await db.prepare(`UPDATE RoomDuelPairs SET ${col} = ? WHERE id = ? AND ${col} IS NULL`).bind(decision, pair.id).run()

  const refreshed = await db.prepare('SELECT * FROM RoomDuelPairs WHERE id = ?').bind(pair.id).first<RoomPair>()
  const aDecided = Boolean(refreshed?.decision_a)
  const bDecided = Boolean(refreshed?.decision_b)

  if (aDecided && bDecided) {
    await settlePair(db, pair.id, { a: refreshed!.decision_a!, b: refreshed!.decision_b! })
    if (await allRoundPairsDone(db, roomId, room.round_seq)) {
      await resolveAndAdvanceRound(db, roomId, now)
    }
  }
  notifyRooms()
  return { matched: Boolean(refreshed?.decision_a === 'like' && refreshed?.decision_b === 'like') }
}

// ---------------------------------------------------------------------------
// State machine advance / cleanup
// ---------------------------------------------------------------------------

export async function advanceRooms(db: D1Turso, now: number = Date.now()): Promise<void> {
  const rooms = await db.prepare("SELECT * FROM MatchRooms WHERE status IN ('open', 'countdown', 'live')").bind().all<any>()

  for (const room of rooms.results) {
    if (room.status === 'countdown') {
      if (room.pair_deadline && now >= room.pair_deadline) {
        await startTournament(db, room, now)
      }
      continue
    }

    if (room.status === 'live' && room.phase !== 'ended') {
      const deadline = room.pair_deadline
      if (!deadline || now < deadline) continue

      if (room.phase === 'pick') {
        // No-shows drop out; whoever did play survives solo.
        const pairs = await roundPairs(db, room.id, room.round_seq)
        for (const p of pairs) {
          if (p.status !== 'playing') continue
          if (p.card_a && p.card_b) continue
          if (!p.card_a && !p.card_b) {
            await db.prepare("UPDATE RoomDuelPairs SET status = 'done', matched = 0 WHERE id = ?").bind(p.id).run()
          } else if (p.card_a) {
            await db.prepare("UPDATE RoomDuelPairs SET status = 'done', matched = 1, user_b = NULL WHERE id = ?").bind(p.id).run()
          } else {
            await db.prepare("UPDATE RoomDuelPairs SET status = 'done', matched = 1, user_a = NULL WHERE id = ?").bind(p.id).run()
          }
        }
        if (await allRoundPairsDone(db, room.id, room.round_seq)) {
          await resolveAndAdvanceRound(db, room.id, now)
        } else {
          await db.prepare("UPDATE MatchRooms SET phase = 'pick', pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(now + PICK_MS, room.id).run()
        }
        continue
      }

      if (room.phase === 'reveal') {
        await db
          .prepare("UPDATE MatchRooms SET phase = 'decide', pair_deadline = ?, phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(now + DECIDE_MS, room.id)
          .run()
        continue
      }

      if (room.phase === 'decide') {
        const pairs = await roundPairs(db, room.id, room.round_seq)
        for (const p of pairs) {
          if (p.status !== 'playing') continue
          const da = p.decision_a || 'reject'
          const db2 = p.decision_b || 'reject'
          await settlePair(db, p.id, { a: da, b: db2 })
        }
        await resolveAndAdvanceRound(db, room.id, now)
        continue
      }
    }
  }

  // Close stale open rooms nobody filled.
  await db
    .prepare("UPDATE MatchRooms SET status = 'ended', phase = 'ended', phase_version = phase_version + 1, updated_at = CURRENT_TIMESTAMP WHERE status IN ('open', 'countdown') AND datetime(updated_at) < datetime(?)")
    .bind(isoFromMs(now - STALE_ROOM_MS))
    .run()
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function getMatchRoom(db: D1Turso, roomId: string): Promise<MatchRoom> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)
  const members = await roomMembers(db, roomId)
  const activeMembers = members.filter((m) => m.status === 'joined')
  const tags = Array.from(new Set(activeMembers.flatMap((m) => (m as any).tags || []))).slice(0, 8)
  const member_count = activeMembers.length
  const eliminated_count = members.filter((m) => m.status === 'eliminated').length
  const champions = members.filter((m) => m.status === 'champion').map(({ status: _s, ...rest }) => rest)
  return {
    id: room.id,
    name: room.name,
    owner_id: room.owner_id,
    status: room.status,
    phase: room.phase,
    capacity: room.capacity,
    round_seq: room.round_seq,
    tags,
    created_at: room.created_at,
    updated_at: room.updated_at,
    members: members.map(({ status: _s, ...rest }) => rest),
    member_count,
    eliminated_count,
    champions,
    pair_deadline: room.pair_deadline,
  }
}

export async function listRooms(db: D1Turso): Promise<MatchRoom[]> {
  const rows = await db
    .prepare("SELECT * FROM MatchRooms WHERE status IN ('open', 'countdown', 'live') ORDER BY created_at DESC LIMIT 50")
    .bind()
    .all<any>()
  const out: MatchRoom[] = []
  for (const r of rows.results) out.push(await getMatchRoom(db, r.id))
  return out
}

/** Public, spectator-safe snapshot: cards are withheld until the reveal phase. */
export async function getRoomSnapshot(db: D1Turso, roomId: string, viewerId?: string): Promise<RoomSnapshot> {
  const room = await fetchRoom(db, roomId)
  if (!room) throw roomError('Room not found', 404)

  const members = await roomMembers(db, roomId)
  const champions = members.filter((m) => m.status === 'champion')
  const revealAll = ['decide', 'reveal', 'ended'].includes(room.phase)

  let roundSeq = Number(room.round_seq)
  let pairs = await roundPairs(db, roomId, roundSeq)
  if (pairs.length === 0 && room.round_seq > 0 && room.status === 'ended') {
    roundSeq = Math.max(0, Number(room.round_seq) - 1)
    pairs = await roundPairs(db, roomId, roundSeq)
  } else if (pairs.length === 0) {
    roundSeq = 0
  }

  const pairViews = await Promise.all(
    pairs.filter((p) => p.status !== 'byepass').map(async (p) => {
      const cardA = revealAll ? await resolveCardUrl(db, p.card_a) : null
      const cardB = revealAll ? await resolveCardUrl(db, p.card_b) : null
      return {
        id: p.id,
        round_seq: p.round_seq,
        player_icons: [
          p.user_a ? (members.find((m) => m.user_id === p.user_a) as any) || { user_id: p.user_a } : null,
          p.user_b ? (members.find((m) => m.user_id === p.user_b) as any) || { user_id: p.user_b } : null,
        ].filter(Boolean).map((u: any) => ({ user_id: u.user_id, display_name: u.display_name ?? null, pfp_url: u.pfp_url ?? null })),
        card_urls: [cardA, cardB],
        has_card: [Boolean(p.card_a), Boolean(p.card_b)],
        decided: [Boolean(p.decision_a), Boolean(p.decision_b)],
        matched: Boolean(p.matched),
        status: p.status,
      }
    })
  )

  return {
    id: room.id,
    name: room.name,
    status: room.status,
    phase: room.phase,
    round_seq: roundSeq,
    pair_deadline: room.pair_deadline,
    members: members.map(({ tags: _t, ...rest }) => rest),
    champions: champions.map(({ tags: _t, ...rest }) => rest),
    pairs: pairViews,
  }
}

// ---------------------------------------------------------------------------
// League
// ---------------------------------------------------------------------------

export async function getLeague(db: D1Turso, limit: number = 20): Promise<LeagueEntry[]> {
  const rows = await db
    .prepare(`
      SELECT lr.user_id, u.display_name, lr.wins, lr.points
      FROM LeagueRank lr
      LEFT JOIN Users u ON u.id = lr.user_id
      ORDER BY lr.points DESC, lr.wins DESC
      LIMIT ?
    `)
    .bind(limit)
    .all<any>()
  return rows.results.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name ?? null,
    wins: Number(r.wins || 0),
    points: Number(r.points || 0),
    tier: Math.floor(Number(r.points || 0) / (LEAGUE_CHAMPION_POINTS / 2)),
  }))
}
