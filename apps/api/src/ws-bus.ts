// Shared WebSocket bus: ticket auth + room-filtered broadcast.
// Connections start UNauthenticated with no room memberships and are closed
// after a short grace window unless they authenticate with a
// { type: 'auth', ticket } message. Once authenticated a connection joins the
// legacy 'global' swarm room and may subscribe to more rooms ('lobby') via a
// { type: 'subscribe', rooms: [...] } control message.

export interface WsConn {
  send: (data: string) => boolean
  rooms: Set<string>
  userId?: string
  authed?: boolean
}

const TICKET_TTL_MS = 2 * 60 * 1000
const tickets = new Map<string, { userId: string; expiresAt: number }>()
export const conns = new Set<WsConn>()

function cleanupTickets() {
  const now = Date.now()
  for (const [t, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(t)
  }
}

export function createWsTicket(userId: string): string {
  cleanupTickets()
  const ticket = `wst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS })
  return ticket
}

export function validateTicket(ticket: string): string | null {
  const entry = tickets.get(ticket)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    tickets.delete(ticket)
    return null
  }
  tickets.delete(ticket)
  return entry.userId
}

// Watch Party relay: tiny JSON control frames (never media bytes).
import {
  applyWatch, joinWatch, watchPong, applyChat, deleteChat, leaveWatch,
  kickWatch, banWatch, muteWatch, transferHost, settingsWatch, queueOps, touchRooms,
} from './watchparty'

export function handleIncoming(conn: WsConn, data: string): void {
  let msg: any
  try {
    msg = JSON.parse(data)
  } catch {
    msg = null
  }

  // Anonymous connections may only present an auth ticket. Everything else is
  // dropped until a valid one-time ticket is proven (see ws.ts grace timer).
  if (msg && msg.type === 'auth') {
    const userId = typeof msg.ticket === 'string' ? validateTicket(msg.ticket) : null
    if (userId) {
      conn.userId = userId
      conn.authed = true
      // Legacy swarm behavior: authenticated peers join the 'global' room so
      // the P2P relay keeps working. Room-specific subscriptions ('lobby')
      // still apply on top via the 'subscribe' message.
      conn.rooms.add('global')
    }
    conn.send(JSON.stringify({ type: 'auth_ack', ok: Boolean(userId) }))
    return
  }

  // Unauthenticated connections are not relayed into any room.
  if (!conn.authed) return

  if (!msg || typeof msg !== 'object') {
    for (const c of conns) {
      if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
    }
    return
  }

  if (msg.type === 'subscribe') {
    if (Array.isArray(msg.rooms)) {
      for (const r of msg.rooms) if (typeof r === 'string') conn.rooms.add(r)
    }
    return
  }

  // Watch Room frames. join subscribes the socket to the party room; control
  // frames are re-stamped with the SERVER clock and relayed to the room so
  // every peer advances from the same instant.
  if (msg.type === 'watch.ping') {
    touchRooms(conn.userId || '')
    conn.send(JSON.stringify(watchPong(msg.t0)))
    return
  }
  if (msg.type === 'watch.join') {
    const res = joinWatch(conn.userId || '', (msg.name || '').slice(0, 40), msg)
    if (res) {
      conn.rooms.add(res.room)
      broadcastToRoom(res.room, res.payload)
    }
    return
  }
  if (msg.type === 'watch') {
    const res = applyWatch(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.chat') {
    const res = applyChat(conn.userId || '', msg.name, msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.chat.del') {
    const res = deleteChat(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.leave') {
    const res = leaveWatch(conn.userId || '', msg)
    if (res) {
      conn.rooms.delete(res.room)
      broadcastToRoom(res.room, res.payload)
    }
    return
  }
  if (msg.type === 'watch.kick' || msg.type === 'watch.ban') {
    const res = msg.type === 'watch.kick' ? kickWatch(conn.userId || '', msg) : banWatch(conn.userId || '', msg)
    if (res) {
      broadcastToRoom(res.room, res.payload)
      // Tell the target directly + evict its room membership.
      for (const c of conns) {
        if (c.userId === res.kicked) {
          c.rooms.delete(res.room)
          c.send(JSON.stringify({ type: 'watch.kicked', party: msg.party }))
        }
      }
    }
    return
  }
  if (msg.type === 'watch.mute') {
    const res = muteWatch(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.host') {
    const res = transferHost(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.settings') {
    const res = settingsWatch(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (msg.type === 'watch.queue') {
    const res = queueOps(conn.userId || '', msg)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }

  if (msg.type === 'lobby') {
    broadcastToRoom('lobby', msg)
    return
  }

  const room = msg.room
  const payload = JSON.stringify(msg)
  if (room) {
    for (const c of conns) {
      if (c !== conn && c.authed && c.rooms.has(room)) c.send(payload)
    }
  } else {
    for (const c of conns) {
      if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
    }
  }
}

export function broadcastToRoom(room: string, payload: unknown): void {
  // Array payloads fan out as individual messages (watch joins return a
  // snapshot + system-note bundle; listeners switch on msg.type).
  const list = Array.isArray(payload) ? payload : [payload]
  for (const item of list) {
    const payloadStr = JSON.stringify(item)
    for (const c of conns) {
      if (c.rooms.has(room)) c.send(payloadStr)
    }
  }
}

export function broadcastToUser(userId: string, payload: unknown): void {
  const payloadStr = JSON.stringify(payload)
  for (const c of conns) {
    if (c.userId === userId) c.send(payloadStr)
  }
}
