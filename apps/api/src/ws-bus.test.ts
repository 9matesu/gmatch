// Unit coverage for src/ws-bus.ts with fake WsConn objects (no real sockets):
// ticket issue/validate/expiry, auth handshake, subscribe, room relay,
// broadcastToRoom / broadcastToUser fan-out.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createWsTicket,
  validateTicket,
  handleIncoming,
  hasNoLiveSocket,
  broadcastToRoom,
  broadcastToUser,
  conns,
  type WsConn,
} from './ws-bus'

function fakeConn(): WsConn & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    send: (data: string) => {
      sent.push(data)
      return true
    },
    rooms: new Set<string>(),
  }
}

beforeEach(() => {
  conns.clear()
})

describe('tickets', () => {
  it('createWsTicket issues a one-time ticket that validates to its user', () => {
    const ticket = createWsTicket('user-one-001')
    expect(ticket.startsWith('wst-')).toBe(true)
    expect(validateTicket(ticket)).toBe('user-one-001')
    // one-time: second use fails
    expect(validateTicket(ticket)).toBeNull()
  })

  it('validateTicket rejects unknown tickets', () => {
    expect(validateTicket('wst-nope-nope')).toBeNull()
  })

  it('validateTicket rejects and deletes an expired ticket', () => {
    const ticket = createWsTicket('user-expire-1')
    // Force expiry by reaching into the module map via a re-issue + time skew:
    // simplest deterministic path is to monkey-patch Date.now for the check.
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 5 * 60 * 1000
      expect(validateTicket(ticket)).toBeNull()
    } finally {
      Date.now = realNow
    }
    // After expiry the entry is deleted: validating with real time also fails.
    expect(validateTicket(ticket)).toBeNull()
  })

  it('createWsTicket sweeps expired tickets from the map', () => {
    const t1 = createWsTicket('user-sweep-01')
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 5 * 60 * 1000
      // This create triggers cleanupTickets(), dropping t1.
      createWsTicket('user-sweep-02')
      expect(validateTicket(t1)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})

describe('handleIncoming: auth handshake', () => {
  it('authenticates with a valid ticket, joins global, acks ok', () => {
    const conn = fakeConn()
    conns.add(conn)
    const ticket = createWsTicket('authed-user-1')
    handleIncoming(conn, JSON.stringify({ type: 'auth', ticket }))
    expect(conn.authed).toBe(true)
    expect(conn.userId).toBe('authed-user-1')
    expect(conn.rooms.has('global')).toBe(true)
    expect(conn.sent).toEqual([JSON.stringify({ type: 'auth_ack', ok: true })])
  })

  it('acks ok:false for an invalid ticket and stays unauthenticated', () => {
    const conn = fakeConn()
    handleIncoming(conn, JSON.stringify({ type: 'auth', ticket: 'bogus-ticket' }))
    expect(conn.authed).toBeFalsy()
    expect(conn.sent).toEqual([JSON.stringify({ type: 'auth_ack', ok: false })])
  })

  it('acks ok:false when ticket is not a string', () => {
    const conn = fakeConn()
    handleIncoming(conn, JSON.stringify({ type: 'auth', ticket: 42 }))
    expect(conn.sent).toEqual([JSON.stringify({ type: 'auth_ack', ok: false })])
  })

  it('drops everything except auth for unauthenticated connections', () => {
    const conn = fakeConn()
    const other = fakeConn()
    other.authed = true
    other.rooms.add('global')
    conns.add(conn)
    conns.add(other)

    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: ['lobby'] }))
    handleIncoming(conn, JSON.stringify({ room: 'lobby', hello: 1 }))
    handleIncoming(conn, 'not json at all')
    expect(conn.rooms.size).toBe(0)
    expect(other.sent).toHaveLength(0)
  })
})

describe('handleIncoming: authenticated dispatch', () => {
  function authedConn(userId = 'u1'): WsConn & { sent: string[] } {
    const c = fakeConn()
    c.authed = true
    c.userId = userId
    c.rooms.add('global')
    conns.add(c)
    return c
  }

  it('hasNoLiveSocket ignores the closing socket, counts other authed ones', () => {
    const a = authedConn('u1')
    const b = authedConn('u2')
    expect(hasNoLiveSocket('u1', a)).toBe(true)
    expect(hasNoLiveSocket('u2', a)).toBe(false)
    b.authed = false
    expect(hasNoLiveSocket('u2', a)).toBe(true) // pending re-auth does not count
    const unauthed = fakeConn()
    unauthed.userId = 'u1'
    conns.add(unauthed)
    expect(hasNoLiveSocket('u1', a)).toBe(true) // junk socket doesn't keep presence
  })

  it('subscribe adds allowlisted rooms and ignores junk or spoofed names', () => {
    const conn = authedConn()
    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: ['lobby', 42, null, 'room-x', 'watch:steal'] }))
    expect(conn.rooms.has('lobby')).toBe(true)
    expect(conn.rooms.has('room-x')).toBe(false)
    expect(conn.rooms.has('watch:steal')).toBe(false)
    expect(conn.rooms.size).toBe(2) // global + lobby
  })

  it('subscribe with a non-array rooms is a no-op', () => {
    const conn = authedConn()
    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: 'lobby' }))
    expect(conn.rooms.has('lobby')).toBe(false)
  })

  it('client lobby frames are dropped (server is the only lobby publisher)', () => {
    const sender = authedConn('sender')
    const lobbyPeer = authedConn('lobby-peer')
    lobbyPeer.rooms.add('lobby')
    const globalPeer = authedConn('global-peer')

    handleIncoming(sender, JSON.stringify({ type: 'lobby', action: 'ping' }))
    expect(lobbyPeer.sent).toHaveLength(0)
    expect(globalPeer.sent).toHaveLength(0)
    expect(sender.sent).toHaveLength(0)
  })

  it('named-room frames no longer fan out (audit A2: rooms are server-published)', () => {
    const sender = authedConn('s')
    const lobbyMember = fakeConn()
    lobbyMember.authed = true
    lobbyMember.rooms.add('lobby')
    conns.add(lobbyMember)

    handleIncoming(sender, JSON.stringify({ type: 'feed', room: 'lobby', action: 'new' }))
    // A spoofed room selector must not deliver to lobby subscribers; the
    // frame only rides the global swarm as legacy relay.
    expect(lobbyMember.sent).toHaveLength(0)
  })

  it('relays SWARM_FRAME want/chunk to global peers (local-first retransmit)', () => {
    const sender = authedConn('s')
    const peer = authedConn('p')
    const outsider = fakeConn()
    outsider.authed = true
    outsider.rooms.add('lobby')
    conns.add(outsider)

    handleIncoming(sender, JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_WANT', id: 'obj-1' } }))
    expect(peer.sent).toHaveLength(1)
    expect(outsider.sent).toHaveLength(0)

    handleIncoming(sender, JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_CHUNK', id: 'obj-1', index: 0, total: 1, mimeType: 'image/jpeg', dataBase64: 'aGk=' } }))
    expect(peer.sent).toHaveLength(2)
  })

  it('drops malformed SWARM_FRAME shapes fail-closed', () => {
    const sender = authedConn('s')
    const peer = authedConn('p')
    handleIncoming(sender, JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_EVIL' } }))
    handleIncoming(sender, JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_CHUNK', id: 'x', dataBase64: 'z'.repeat(200 * 1024) } }))
    handleIncoming(sender, JSON.stringify({ type: 'SWARM_FRAME' }))
    expect(peer.sent).toHaveLength(0)
  })

  it('roomless messages fan out to the global swarm', () => {
    const sender = authedConn('s')
    const peer = authedConn('p')
    handleIncoming(sender, JSON.stringify({ chat: 'hi' }))
    expect(peer.sent).toEqual([JSON.stringify({ chat: 'hi' })])
  })

  it('non-object JSON (number) relays raw to global peers', () => {
    const sender = authedConn('s')
    const peer = authedConn('p')
    handleIncoming(sender, '12345')
    expect(peer.sent).toEqual(['12345'])
  })

  it('unparseable JSON relays raw to global peers', () => {
    const sender = authedConn('s')
    const peer = authedConn('p')
    const unauthed = fakeConn()
    conns.add(unauthed)
    handleIncoming(sender, '{{not json')
    expect(peer.sent).toEqual(['{{not json'])
    expect(unauthed.sent).toHaveLength(0)
  })
})

describe('broadcast helpers', () => {
  it('broadcastToRoom sends to every member including unauthenticated ones with the room', () => {
    const member = fakeConn()
    member.rooms.add('lobby')
    const lurker = fakeConn()
    lurker.rooms.add('lobby')
    conns.add(member)
    conns.add(lurker)
    const other = fakeConn()
    other.rooms.add('global')
    conns.add(other)

    broadcastToRoom('lobby', { type: 'x' })
    expect(member.sent).toEqual([JSON.stringify({ type: 'x' })])
    expect(lurker.sent).toHaveLength(1)
    expect(other.sent).toHaveLength(0)
  })

  it('broadcastToUser targets only that user\'s connections', () => {
    const c1 = fakeConn()
    c1.userId = 'target'
    const c2 = fakeConn()
    c2.userId = 'target'
    const c3 = fakeConn()
    c3.userId = 'other'
    conns.add(c1)
    conns.add(c2)
    conns.add(c3)

    broadcastToUser('target', { type: 'pm' })
    expect(c1.sent).toEqual([JSON.stringify({ type: 'pm' })])
    expect(c2.sent).toHaveLength(1)
    expect(c3.sent).toHaveLength(0)
  })
})
