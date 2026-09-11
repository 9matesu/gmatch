import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { updateRoom, deleteRoom, forceStartRoom, joinRoom, leaveRoom, autoQueue, playRoomCard, setRoomDecision, addMatchCard, advanceRooms, listRooms, getMatchRoom, getRoomSnapshot, getLeague } from '../rooms'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const rooms = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
rooms.use('*', orbitAuth)

let lastRoomAdvance = 0
const ROOM_ADVANCE_INTERVAL_MS = 2000

function isValidImageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return ['http:', 'https:', 'data:'].includes(u.protocol) && url.length <= 8 * 1024 * 1024
  } catch {
    return false
  }
}

rooms.get('/', async (c) => {
  const now = Date.now()
  if (now - lastRoomAdvance >= ROOM_ADVANCE_INTERVAL_MS) {
    lastRoomAdvance = now
    await advanceRooms(c.env.DB, now).catch(() => {})
  }
  const roomList = await listRooms(c.env.DB)
  const league = await getLeague(c.env.DB, 10)
  return c.json({ rooms: roomList, league })
})

rooms.get('/league', async (c) => {
  return c.json({ league: await getLeague(c.env.DB, 50) })
})

rooms.post('/', async (c) => {
  return c.json({ error: 'Custom room creation has been disabled. Every player is matched automatically in the 1v1 queue.' }, 403)
})

rooms.post('/autoqueue', async (c) => {
  const userId = c.get('orbitId')
  const room = await autoQueue(c.env.DB, userId)
  await advanceRooms(c.env.DB).catch(() => {})
  return c.json({ room })
})

rooms.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const viewer = c.get('orbitId')
    const room = await getMatchRoom(c.env.DB, id)
    const snapshot = await getRoomSnapshot(c.env.DB, id, viewer)
    return c.json({ room, snapshot, is_member: room.members.some((m) => m.user_id === viewer) })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Room not found' }, err?.status || 404)
  }
})

rooms.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { name?: string }
  try {
    const room = await updateRoom(c.env.DB, c.get('orbitId'), id, body?.name)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ room })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to update room' }, err?.status || 400)
  }
})

rooms.delete('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    await deleteRoom(c.env.DB, c.get('orbitId'), id)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to delete room' }, err?.status || 400)
  }
})

rooms.post('/:id/start', async (c) => {
  const id = c.req.param('id')
  try {
    const room = await forceStartRoom(c.env.DB, c.get('orbitId'), id)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ room })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to start room' }, err?.status || 400)
  }
})

rooms.get('/:id/snapshot', async (c) => {
  const id = c.req.param('id')
  try {
    const viewer = c.get('orbitId')
    const snapshot = await getRoomSnapshot(c.env.DB, id, viewer)
    return c.json({ snapshot })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Room not found' }, err?.status || 404)
  }
})

rooms.post('/:id/join', async (c) => {
  const id = c.req.param('id')
  try {
    const room = await joinRoom(c.env.DB, c.get('orbitId'), id)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ room })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to join room' }, err?.status || 409)
  }
})

rooms.post('/:id/leave', async (c) => {
  const id = c.req.param('id')
  await leaveRoom(c.env.DB, c.get('orbitId'), id)
  await advanceRooms(c.env.DB).catch(() => {})
  return c.json({ ok: true })
})

rooms.post('/:id/cards', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({})) as { url?: string }
  const contentUrl = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!contentUrl || !isValidImageUrl(contentUrl)) {
    return c.json({ error: 'A valid image URL is required' }, 400)
  }
  const card = await addMatchCard(c.env.DB, roomId, userId, contentUrl)
  return c.json({ card }, 201)
})

rooms.post('/:id/card', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { card_id?: string }
  const cardId = body?.card_id
  if (!cardId) return c.json({ error: 'card_id is required' }, 400)
  try {
    await playRoomCard(c.env.DB, roomId, c.get('orbitId'), cardId)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to play card' }, err?.status || 500)
  }
})

rooms.post('/:id/decision', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { decision?: string }
  if (body?.decision !== 'like' && body?.decision !== 'reject') {
    return c.json({ error: "Invalid decision. Must be 'like' or 'reject'." }, 400)
  }
  try {
    const result = await setRoomDecision(c.env.DB, roomId, c.get('orbitId'), body.decision)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to record decision' }, err?.status || 500)
  }
})

rooms.post('/:id/pairs/:pairId/card', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { card_id?: string }
  const cardId = body?.card_id
  if (!cardId) return c.json({ error: 'card_id is required' }, 400)
  try {
    await playRoomCard(c.env.DB, roomId, c.get('orbitId'), cardId)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to play card' }, err?.status || 500)
  }
})

rooms.post('/:id/pairs/:pairId/decision', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { decision?: string }
  if (body?.decision !== 'like' && body?.decision !== 'reject') {
    return c.json({ error: "Invalid decision. Must be 'like' or 'reject'." }, 400)
  }
  try {
    const result = await setRoomDecision(c.env.DB, roomId, c.get('orbitId'), body.decision)
    await advanceRooms(c.env.DB).catch(() => {})
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to record decision' }, err?.status || 500)
  }
})