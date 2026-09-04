import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  autoQueue,
  addMatchCard,
  playRoomCard,
  setRoomDecision,
  advanceRooms,
  listRooms,
  getMatchRoom,
  getRoomSnapshot,
  getLeague,
} from './rooms'
import { LOBBY_PICK_SECONDS, LOBBY_REVEAL_SECONDS, LOBBY_DECIDE_SECONDS, ROOM_START_SECONDS, LEAGUE_CHAMPION_POINTS } from '@orbit/shared'

let env: Awaited<ReturnType<typeof createMockEnv>>

const M = 1000

function uid(i: number): string {
  return `room-user-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string, tags: string[] = []) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, encryption_pub_key, display_name, tags, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, `pk-${userId}`, null, name, JSON.stringify(tags), new Date().toISOString()]
  )
}

async function seedObject(userId: string): Promise<string> {
  const id = `obj-${userId}-${Math.random().toString(36).slice(2, 8)}`
  await env._client.execute(
    `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story) VALUES (?, ?, 0, 'image/jpeg', ?, 0)`,
    [id, userId, `data:image/jpeg;base64,x-${id}`]
  )
  return id
}

async function seedRoom(n: number, name = 'Test Room'): Promise<{ roomId: string; ids: string[] }> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) ids.push(uid(i))
  for (const id of ids) await seedUser(id, `P${id.slice(-4)}`)
  const room = await createRoom(env.DB, ids[0], name)
  for (let i = 1; i < n; i++) await joinRoom(env.DB, ids[i], room.id)
  return { roomId: room.id, ids }
}

async function currentPair(roomId: string, userId: string) {
  const snap = await getRoomSnapshot(env.DB, roomId)
  const roundSeq = snap.round_seq
  const rows = await env._client.execute(
    'SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = ? AND (user_a = ? OR user_b = ?)',
    [roomId, roundSeq, userId, userId]
  )
  return rows.rows[0] as any
}

async function playBoth(roomId: string, a: string, b: string) {
  const ca = await seedObject(a)
  const cb = await seedObject(b)
  await playRoomCard(env.DB, roomId, a, ca)
  await playRoomCard(env.DB, roomId, b, cb)
  return { ca, cb }
}

describe('rooms: lifecycle & join flow', () => {
  beforeEach(async () => {
    env = await createMockEnv()
  })

  it('creates a room with the creator as the only member', async () => {
    const a = uid(200)
    await seedUser(a, 'Alpha')
    const room = await createRoom(env.DB, a, 'Alpha Room')
    expect(room.status).toBe('open')
    expect(room.phase).toBe('waiting')
    expect(room.member_count).toBe(1)
    expect(room.capacity).toBe(4)
    expect(room.members[0].user_id).toBe(a)
  })

  it('starts a 45s countdown once a second player joins, then goes live on deadline', async () => {
    const { roomId, ids } = await seedRoom(2)
    let room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('countdown')
    expect(room.pair_deadline).toEqual(expect.any(Number))
    expect(room.phase).toBe('countdown')

    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)
    room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('live')
    expect(room.phase).toBe('pick')
    expect(room.round_seq).toBe(1)
  })

  it('does not allow joining a live room', async () => {
    const { roomId, ids } = await seedRoom(2)
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)
    const late = uid(201)
    await seedUser(late, 'Late')
    await expect(joinRoom(env.DB, late, roomId)).rejects.toThrow('already started')
  })

  it('autoqueue fills the single open room instead of creating a second one', async () => {
    const { roomId } = await seedRoom(1, 'Solo')
    // brand-new user autoqueues
    const x = uid(202)
    await seedUser(x, 'X')
    const room = await autoQueue(env.DB, x)
    expect(room.id).toBe(roomId)
    const list = await listRooms(env.DB)
    expect(list.filter((r) => r.status === 'open' || r.status === 'countdown').length).toBe(1)
  })
})

describe('rooms: tournament bracket', () => {
  beforeEach(async () => {
    env = await createMockEnv()
  })

  it('mutual like advances both to the next round; non-match eliminates both (2-player final = co-champions)', async () => {
    const { roomId, ids } = await seedRoom(2)
    const [a, b] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)

    await playBoth(roomId, a, b)
    await setRoomDecision(env.DB, roomId, a, 'like')
    const result = await setRoomDecision(env.DB, roomId, b, 'like')
    expect(result.matched).toBe(true)

    // Co-champions after the mutual 1v1 final.
    const room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('ended')
    expect(room.champions.length).toBe(2)
    expect(new Set(room.champions.map((c) => c.user_id))).toEqual(new Set([a, b]))
  })

  it('a reject in the final leaves no champions', async () => {
    const { roomId, ids } = await seedRoom(2)
    const [a, b] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)
    await playBoth(roomId, a, b)
    await setRoomDecision(env.DB, roomId, a, 'like')
    await setRoomDecision(env.DB, roomId, b, 'reject')
    const room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('ended')
    expect(room.champions.length).toBe(0)
  })

  it('4 players: two pairs; mutual pairs both advance, only mutuals face off', async () => {
    const { roomId, ids } = await seedRoom(4)
    const [a, b, c, d] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)

    // Round 1 has exactly two pairs.
    let pairs = await env._client.execute('SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = 1', [roomId])
    expect(pairs.rows).toHaveLength(2)

    // Each pair plays cards.
    for (const p of pairs.rows as any[]) {
      await playRoomCard(env.DB, roomId, p.user_a, await seedObject(p.user_a))
      await playRoomCard(env.DB, roomId, p.user_b, await seedObject(p.user_b))
    }
    // Everyone mutually likes → all 4 survive round 1.
    for (const p of pairs.rows as any[]) {
      await setRoomDecision(env.DB, roomId, p.user_a, 'like')
      await setRoomDecision(env.DB, roomId, p.user_b, 'like')
    }

    let room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('live')
    expect(room.round_seq).toBe(2)

    // Round 2 re-pairs all 4 (two pairs again).
    pairs = await env._client.execute('SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = 2', [roomId])
    expect(pairs.rows).toHaveLength(2)

    // Pair A/B mutual again, pair C/D do NOT match.
    // Resolve both round-2 pairs: A/B advance, C/D eliminated.
    for (const p of pairs.rows as any[]) {
      await playRoomCard(env.DB, roomId, p.user_a, await seedObject(p.user_a))
      await playRoomCard(env.DB, roomId, p.user_b, await seedObject(p.user_b))
    }
    const pair1 = (pairs.rows as any[])[0]
    const pair2 = (pairs.rows as any[])[1]
    await setRoomDecision(env.DB, roomId, pair1.user_a, 'like')
    await setRoomDecision(env.DB, roomId, pair1.user_b, 'like')
    await setRoomDecision(env.DB, roomId, pair2.user_a, 'like')
    await setRoomDecision(env.DB, roomId, pair2.user_b, 'reject')

    room = await getMatchRoom(env.DB, roomId)
    // Only the mutual pair survives → finalists are exactly those two.
    expect(room.status).toBe('live')
    expect(room.round_seq).toBe(3)
    const finalPairs = await env._client.execute('SELECT * FROM RoomDuelPairs WHERE room_id = ? AND round_seq = 3', [roomId])
    const finalRow = finalPairs.rows[0] as any
    expect([finalRow.user_a, finalRow.user_b].sort()).toEqual([pair1.user_a, pair1.user_b].sort())
  })

  it('timeout in pick drops no-shows; remaining players survive solo', async () => {
    const { roomId, ids } = await seedRoom(2)
    const [a, b] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)
    await playRoomCard(env.DB, roomId, a, await seedObject(a))
    // b never plays → pick deadline passes
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + LOBBY_PICK_SECONDS * M + 1)
    const room = await getMatchRoom(env.DB, roomId)
    expect(room.status).toBe('ended')
    expect(room.champions.map((c) => c.user_id)).toEqual([a])
  })
})

describe('rooms: match-local cards, spectate & league', () => {
  beforeEach(async () => {
    env = await createMockEnv()
  })

  it('match-local cards are never Objects and resolve to their URL', async () => {
    const { roomId, ids } = await seedRoom(1)
    const card = await addMatchCard(env.DB, roomId, ids[0], 'data:image/jpeg;base64,MATCHCARD')
    expect(card.id.startsWith('mcard-')).toBe(true)
    const obj = await env._client.execute('SELECT * FROM Objects WHERE id = ?', [card.id])
    expect(obj.rows).toHaveLength(0)
  })

  it('spectator snapshot hides cards until reveal, then shows them', async () => {
    const { roomId, ids } = await seedRoom(2)
    const [a, b] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)

    let snap = await getRoomSnapshot(env.DB, roomId)
    expect(snap.phase).toBe('pick')
    expect(snap.pairs.length).toBe(1)

    // Card hidden during pick.
    await playRoomCard(env.DB, roomId, a, await seedObject(a))
    snap = await getRoomSnapshot(env.DB, roomId)
    expect(snap.pairs[0].card_urls).toEqual([null, null])
    expect(snap.pairs[0].has_card.filter(Boolean)).toHaveLength(1)
    expect(snap.pairs[0].has_card.some((c, i) => c && snap.pairs[0].player_icons[i]?.user_id === a)).toBe(true)
    expect(snap.pairs[0].decided).toEqual([false, false])

    await playRoomCard(env.DB, roomId, b, await seedObject(b))
    snap = await getRoomSnapshot(env.DB, roomId)
    expect(snap.phase).toBe('reveal')
    const pair = snap.pairs[0]
    expect(pair.has_card).toEqual([true, true])
    expect(pair.card_urls.every((c) => typeof c === 'string' && c !== null)).toBe(true)
    expect(pair.decided).toEqual([false, false])
  })

  it('winners rank into the league', async () => {
    const { roomId, ids } = await seedRoom(2)
    const [a, b] = ids
    await advanceRooms(env.DB, Date.now() + ROOM_START_SECONDS * M + 1)
    await playBoth(roomId, a, b)
    await setRoomDecision(env.DB, roomId, a, 'like')
    await setRoomDecision(env.DB, roomId, b, 'like')

    const league = await getLeague(env.DB)
    const entry = league.find((l) => l.user_id === a)
    expect(entry).toBeDefined()
    expect(entry!.wins).toBe(1)
    expect(entry!.points).toBe(LEAGUE_CHAMPION_POINTS)
  })
})