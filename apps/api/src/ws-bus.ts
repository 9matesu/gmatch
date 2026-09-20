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
  kickWatch, banWatch, muteWatch, transferHost, settingsWatch, queueOps, touchRooms, leaveAll, disbandWatch,
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
    // Audit A1: room membership is minted server-side (watch.join, auth).
    // A client may only ask for the two broadcast rooms; anything else —
    // especially `watch:<id>`, whose ids ship in the public browse list —
    // is a spoof.
    const ALLOWED = new Set(['lobby', 'global'])
    if (Array.isArray(msg.rooms)) {
      for (const r of msg.rooms) if (typeof r === 'string' && ALLOWED.has(r)) conn.rooms.add(r)
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
      // Send full state snapshot ONLY to the joiner socket
      conn.send(JSON.stringify(res.snapshot || (Array.isArray(res.payload) ? res.payload[0] : res.payload)))
      // Broadcast system join notice + lightweight roster to other members in the room
      const othersPayload = res.broadcastPayload || (Array.isArray(res.payload) ? res.payload.slice(1) : [])
      if (othersPayload && (!Array.isArray(othersPayload) || othersPayload.length > 0)) {
        broadcastToRoomExcept(res.room, conn, othersPayload)
      }
    } else if (typeof msg.party === 'string') {
      // Room died (GC/eviction pre-persistence, or a creator wipe): say so
      // once, on the requester's socket, so no ghost room loops 404s.
      conn.send(JSON.stringify({ type: 'watch.gone', party: msg.party }))
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
  if (msg.type === 'watch.disband') {
    const res = disbandWatch(conn.userId || '', msg)
    if (res) {
      // Everyone in the room (host included) gets gone + leaves the room.
      for (const c of conns) {
        if (c.rooms.has(res.room)) {
          c.rooms.delete(res.room)
          c.send(JSON.stringify({ type: 'watch.gone', party: res.partyId }))
        }
      }
    }
    return
  }

  // Local-first timeline media: bytes stay on the poster's disk
  // (IndexedDB in the packaged app) and are retransmitted peer-to-peer on
  // demand. The WS relay is the guaranteed fallback when direct WebRTC is
  // unavailable, so SWARM_FRAME envelopes ride the global room. Only the
  // three swarm shapes relay; anything else with a `type` key stays dropped
  // (audit A2: feed/lobby/user_banned... forgery guard).
  if (msg.type === 'SWARM_FRAME' && msg.swarm && typeof msg.swarm === 'object') {
    const inner = msg.swarm as { type?: unknown; dataBase64?: unknown }
    if (inner.type === 'SWARM_WANT' || inner.type === 'SWARM_HAVE') {
      for (const c of conns) {
        if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
      }
      return
    }
    if (inner.type === 'SWARM_CHUNK' && typeof inner.dataBase64 === 'string' && inner.dataBase64.length <= 128 * 1024) {
      for (const c of conns) {
        if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
      }
      return
    }
    return
  }
  // Audit A2: the lobby room is server-published only (routes/lobby,
  // babecock, posts), and no client flow needed the named-room pass-through
  // either (it was the injection vector). The global swarm now carries ONLY
  // the legacy P2P wire: opaque envelopes keyed `t`, SWARM_FRAME above, or
  // raw non-JSON. Any other frame with a server-managed `type` key without
  // a handler above is a forgery (feed/lobby/user_banned...) and is dropped.
  // ponytail: add per-type relay allowlist if a client->client type returns.
  if (typeof msg.type === 'string') return
  for (const c of conns) {
    if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
  }
}

/** True when no OTHER authed socket still holds this user's presence.
 * Exported seam for the leave-grace decision in watchDisconnect. */
export function hasNoLiveSocket(userId: string, closing: WsConn): boolean {
  for (const c of conns) if (c !== closing && c.userId === userId && c.authed) return false
  return true
}

// Presence: the last socket of a user closing means they left every watch
// room (system note + roster, host promoted). A network blip closes the old
// socket seconds before the replacement authenticates, so the check runs on
// a grace window instead of inline; other tabs still open = stay. Shared by
// BOTH WS entry points (routes/ws.ts worker + serve.ts node) so rooms
// behave identically on fly and CF.
const LEAVE_GRACE_MS = 8_000
export function watchDisconnect(conn: WsConn): void {
  const userId = conn.userId
  if (!userId) return
  setTimeout(() => {
    if (!hasNoLiveSocket(userId, conn)) return
    for (const res of leaveAll(userId)) {
      if (conn.rooms.has(res.room)) broadcastToRoom(res.room, res.payload)
    }
  }, LEAVE_GRACE_MS)
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

export function broadcastToRoomExcept(room: string, exclude: WsConn, payload: unknown): void {
  const list = Array.isArray(payload) ? payload : [payload]
  for (const item of list) {
    const payloadStr = JSON.stringify(item)
    for (const c of conns) {
      if (c !== exclude && c.rooms.has(room)) c.send(payloadStr)
    }
  }
}

export function broadcastToUser(userId: string, payload: unknown): void {
  const payloadStr = JSON.stringify(payload)
  for (const c of conns) {
    if (c.userId === userId) c.send(payloadStr)
  }
}
