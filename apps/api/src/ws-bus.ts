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

/**
 * The largest client-to-client frame the relay will fan out.
 *
 * The relay copies one payload to every authed socket in the room, so the
 * frame size multiplies by the roster. 512 KB is far above a real
 * announcement (an object descriptor with a caption and tags is ~1 KB) and
 * far below a media blob, which never travels this path — bytes ride the
 * swarm chunk frames.
 */
export const MAX_RELAY_FRAME_BYTES = 512 * 1024

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
  kickWatch, banWatch, muteWatch, transferHost, settingsWatch, queueOps, watchReady, touchRooms, leaveAll, disbandWatch,
} from './watchparty'
import { parseWatchFrame, isRecord, type WatchFrame } from '@orbit/protocol'

export function handleIncoming(conn: WsConn, data: string): void {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(data)
  } catch {
    parsed = null
  }

  // Anonymous connections may only present an auth ticket. Everything else is
  // dropped until a valid one-time ticket is proven (see ws.ts grace timer).
  if (isRecord(parsed) && parsed.type === 'auth') {
    const userId = typeof parsed.ticket === 'string' ? validateTicket(parsed.ticket) : null
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

  if (!isRecord(parsed)) {
    for (const c of conns) {
      if (c !== conn && c.authed && c.rooms.has('global')) c.send(data)
    }
    return
  }

  const msg = parsed

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
  //
  // The frame is NARROWED first: parseWatchFrame copies only the known
  // fields, with the type each field must have. A handler never sees a raw
  // JSON value, so a string can never be read as a number and an unknown key
  // can never reach a handler.
  const frameType = typeof msg.type === 'string' ? msg.type : ''
  const isWatchFrame = frameType === 'watch' || frameType.startsWith('watch.')
  const watch: WatchFrame | null = isWatchFrame ? parseWatchFrame(msg) : null
  if (isWatchFrame && !watch) return

  if (frameType === 'watch.ping') {
    touchRooms(conn.userId || '')
    conn.send(JSON.stringify(watchPong(msg.t0)))
    return
  }
  if (frameType === 'watch.join' && watch) {
    const res = joinWatch(conn.userId || '', (watch.name ?? '').slice(0, 40), watch)
    if (res) {
      conn.rooms.add(res.room)
      // Send full state snapshot ONLY to the joiner socket
      conn.send(JSON.stringify(res.snapshot || (Array.isArray(res.payload) ? res.payload[0] : res.payload)))
      // Broadcast system join notice + lightweight roster to other members in the room
      const othersPayload = res.broadcastPayload || (Array.isArray(res.payload) ? res.payload.slice(1) : [])
      if (othersPayload && (!Array.isArray(othersPayload) || othersPayload.length > 0)) {
        broadcastToRoomExcept(res.room, conn, othersPayload)
      }
    } else if (typeof watch.party === 'string') {
      // Room died (GC/eviction pre-persistence, or a creator wipe): say so
      // once, on the requester's socket, so no ghost room loops 404s.
      conn.send(JSON.stringify({ type: 'watch.gone', party: watch.party }))
    }
    return
  }
  if (frameType === 'watch' && watch) {
    const res = applyWatch(conn.userId || '', watch)
    if (res) {
      broadcastToRoom(res.room, res.payload)
      return
    }
    // Refused frames used to vanish with no signal: applyWatch returns null for
    // a non-host, a non-member, a bad position and for the 200ms transport
    // throttle. The client showed "playing" and the user pressed pause and
    // nothing happened, with zero evidence anywhere. Tell the sender, so the
    // UI can be optimistic and a dropped command is explainable.
    conn.send(JSON.stringify({ type: 'watch.nack', party: watch.party, action: watch.action }))
    return
  }
  if (frameType === 'watch.chat' && watch) {
    const res = applyChat(conn.userId || '', watch.name ?? '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.chat.del' && watch) {
    const res = deleteChat(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.leave' && watch) {
    const res = leaveWatch(conn.userId || '', watch)
    if (res) {
      conn.rooms.delete(res.room)
      broadcastToRoom(res.room, res.payload)
    }
    return
  }
  if ((frameType === 'watch.kick' || frameType === 'watch.ban') && watch) {
    const res = frameType === 'watch.kick' ? kickWatch(conn.userId || '', watch) : banWatch(conn.userId || '', watch)
    if (res) {
      broadcastToRoom(res.room, res.payload)
      // Tell the target directly + evict its room membership.
      for (const c of conns) {
        if (c.userId === res.kicked) {
          c.rooms.delete(res.room)
          c.send(JSON.stringify({ type: 'watch.kicked', party: watch.party }))
        }
      }
    }
    return
  }
  if (frameType === 'watch.mute' && watch) {
    const res = muteWatch(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.host' && watch) {
    const res = transferHost(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.settings' && watch) {
    const res = settingsWatch(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.queue' && watch) {
    const res = queueOps(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.ready' && watch) {
    const res = watchReady(conn.userId || '', watch)
    if (res) broadcastToRoom(res.room, res.payload)
    return
  }
  if (frameType === 'watch.disband' && watch) {
    const res = disbandWatch(conn.userId || '', watch)
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
  // unavailable, so SWARM_FRAME envelopes ride the global room. Only explicit
  // client-to-client shapes relay; anything else with a `type` key stays
  // dropped (audit A2: feed/lobby/user_banned... forgery guard).
  //
  // Announcements (IMAGE_ANNOUNCE et al) used to be sent as BARE frames, which
  // this guard refused — so peer posts only ever reached peers over a direct
  // WebRTC channel and vanished on every other path. They now ride the same
  // SWARM_FRAME envelope, and the relay stamps `relayedBy` with the identity
  // the socket PROVED at auth, so a receiver can tell a real sender from a
  // forged `user.id` in the payload.
  if (msg.type === 'SWARM_FRAME' && isRecord(msg.swarm)) {
    const inner = msg.swarm
    const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
    const relayable =
      inner.type === 'SWARM_WANT' ||
      inner.type === 'SWARM_HAVE' ||
      (inner.type === 'SWARM_CHUNK' &&
        typeof inner.dataBase64 === 'string' &&
        inner.dataBase64.length <= 128 * 1024) ||
      // swarm-v1 transfer key: the per-transfer DEK, sealed to the FETCHER's
      // ephemeral offer key. The relay cannot open it (it holds no private
      // key), so forwarding it leaks nothing — but WITHOUT this frame the
      // relay path could never decrypt a chunk, which silently broke the
      // "guaranteed fallback" for every peer that cannot punch a direct
      // WebRTC hole.
      (inner.type === 'SWARM_KEY' &&
        bounded(inner.transferId, 128) &&
        bounded(inner.wrapped, 1024)) ||
      // Durable-replication evidence: the seeder's challenge and the
      // fetcher's signed receipt (challenge-bound, read-back verified).
      (inner.type === 'SWARM_CHALLENGE' &&
        bounded(inner.id, 256) &&
        bounded(inner.challenge, 1024)) ||
      (inner.type === 'SWARM_RECEIPT' &&
        bounded(inner.id, 256) &&
        !!inner.receipt &&
        typeof inner.receipt === 'object') ||
      // Signed social operations and their acks: the operation carries its
      // own signature, and the receiver's authorizer decides (the relay
      // never reads or rewrites it).
      (inner.type === 'SWARM_OP' && !!inner.operation && typeof inner.operation === 'object') ||
      (inner.type === 'SWARM_OP_ACK' &&
        bounded(inner.operationId, 256) &&
        bounded(inner.actorId, 256)) ||
      // Announce shapes: an object's metadata + its provider link, never bytes.
      inner.type === 'IMAGE_ANNOUNCE' ||
      inner.type === 'MESSAGE' ||
      inner.type === 'STORY_ANNOUNCE' ||
      inner.type === 'CHAT' ||
      inner.type === 'PRESENCE'
    if (!relayable) return
    // Bound the RELAYED frame. The relay fans the same payload out to every
    // authed socket in the room, so an unbounded frame is an amplification
    // vector (one sender, N copies). The client used to "solve" this by
    // splitting big announcements into top-level SWARM_CHUNK frames — which
    // this relay refuses (audit A2 drops any top-level frame with a `type`
    // key), so a >30 KB announcement was silently LOST rather than split.
    // The frame now travels whole and the bound is enforced here.
    if (data.length > MAX_RELAY_FRAME_BYTES) return
    const relayed = conn.userId
      ? JSON.stringify({ type: 'SWARM_FRAME', swarm: msg.swarm, relayedBy: conn.userId })
      : data
    for (const c of conns) {
      if (c !== conn && c.authed && c.rooms.has('global')) c.send(relayed)
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
