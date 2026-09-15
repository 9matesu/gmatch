import { describe, it, expect, beforeEach } from 'vitest'
import { createParty, getParty, applyWatch, joinWatch, applyChat, __resetParties, partyRoom } from './watchparty'
import { handleIncoming, conns, createWsTicket, type WsConn } from './ws-bus'

function fakeConn(): WsConn & { sent: string[] } {
  const sent: string[] = []
  return { sent, send: (d: string) => { sent.push(d); return true }, rooms: new Set<string>() }
}

function authed(conn: WsConn & { sent: string[] }, userId: string) {
  handleIncoming(conn, JSON.stringify({ type: 'auth', ticket: createWsTicket(userId) }))
}

beforeEach(() => {
  __resetParties()
  conns.clear()
})

describe('party state', () => {
  it('createParty seeds a paused frame on the media url', () => {
    const p = createParty('Test', '/api/objects/abc', '/api/objects/abc')
    expect(getParty(p.id)).toBe(p)
    expect(p.frame.action).toBe('pause')
    expect(p.members.size).toBe(0)
  })

  it('applyWatch rejects non-members, bad actions, bad positions', () => {
    const p = createParty('T', 'u', 'u')
    expect(applyWatch('ghost', { party: p.id, action: 'play', position: 5 })).toBeNull()
    joinWatch('u1', 'Alice', { party: p.id })
    expect(applyWatch('u1', { party: p.id, action: 'jump', position: 5 })).toBeNull()
    expect(applyWatch('u1', { party: p.id, action: 'play', position: -3 })).toBeNull()
    expect(applyWatch('u1', { party: p.id, action: 'play', position: NaN })).toBeNull()
    expect(applyWatch('u1', { party: p.id, action: 'play', position: 5, rate: 2 })).toBeNull()
  })

  it('applyWatch stamps server clock and rate=1', () => {
    const p = createParty('T', 'u', 'u')
    joinWatch('u1', 'Alice', { party: p.id })
    const res = applyWatch('u1', { party: p.id, action: 'play', position: 12.5 })!
    expect(res.room).toBe(partyRoom(p.id))
    expect(res.payload.type).toBe('watch.sync')
    expect(res.payload.frame.position).toBe(12.5)
    expect(res.payload.frame.rate).toBe(1)
    expect(res.payload.frame.updatedAt).toBeGreaterThan(Date.now() / 1000 - 5)
    expect(p.frame.action).toBe('play')
  })

  it('joinWatch caps members at 8 and relays the roster', () => {
    const p = createParty('T', 'u', 'u')
    for (let i = 0; i < 8; i++) expect(joinWatch(`u${i}`, `N${i}`, { party: p.id })).not.toBeNull()
    expect(joinWatch('u8', 'Late', { party: p.id })).toBeNull()
    expect(p.members.size).toBe(8)
  })

  it('applyChat relays member text with a 2s/user rate limit', () => {
    const p = createParty('T', 'u', 'u')
    expect(applyChat('ghost', 'X', { party: p.id, text: 'hi' })).toBeNull()
    joinWatch('u1', 'Alice', { party: p.id })
    const res = applyChat('u1', 'Alice', { party: p.id, text: '  hello  ' })!
    expect(res.payload.text).toBe('hello')
    expect(res.payload.from.name).toBe('Alice')
    expect(applyChat('u1', 'Alice', { party: p.id, text: 'again' })).toBeNull()
    expect(applyChat('u1', 'Alice', { party: p.id, text: '   ' })).toBeNull()
    expect(applyChat('u2', 'Bob', { party: 'missing', text: 'x' })).toBeNull()
  })
})

describe('ws relay integration', () => {
  it('watch.join subscribes the socket and broadcasts roster; watch relays sync', () => {
    const p = createParty('T', '/m', '/m')
    const a = fakeConn()
    const b = fakeConn()
    conns.add(a)
    conns.add(b)
    authed(a, 'u1')
    authed(b, 'u2')
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Alice' }))
    expect(a.rooms.has(partyRoom(p.id))).toBe(true)
    handleIncoming(b, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Bob' }))
    // both got the roster
    const rosterA = a.sent.map(JSON.parse).filter((m) => m.type === 'watch.roster')
    expect(rosterA.length).toBe(2) // own + Bob's
    // a plays -> both sockets receive the server-stamped sync (broadcastToRoom
    // includes the sender; the frame is authoritative, echoing it is harmless)
    b.sent.length = 0
    a.sent.length = 0
    handleIncoming(a, JSON.stringify({ type: 'watch', party: p.id, action: 'play', position: 3 }))
    const syncs = b.sent.map(JSON.parse).filter((m) => m.type === 'watch.sync')
    expect(syncs.length).toBe(1)
    expect(syncs[0].frame.position).toBe(3)
    expect(a.sent.length).toBe(1)
  })

  it('watch.ping answers on the socket only', () => {
    const a = fakeConn()
    authed(a, 'u1')
    a.sent.length = 0
    handleIncoming(a, JSON.stringify({ type: 'watch.ping', t0: 123 }))
    const pong = JSON.parse(a.sent[0])
    expect(pong.type).toBe('watch.pong')
    expect(pong.t0).toBe(123)
    expect(pong.t1).toBeGreaterThan(0)
  })

  it('unauthenticated watch frames are dropped', () => {
    const a = fakeConn()
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: 'x' }))
    expect(a.sent.filter((s) => s.includes('watch'))).toHaveLength(0)
  })
})
