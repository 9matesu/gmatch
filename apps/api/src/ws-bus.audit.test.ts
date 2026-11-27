// Audit rodada 5 regression locks: subscribe-room spoofing (A1) and
// client lobby injection (A2). See docs/AUDIT-2026-09-13.md for history.
import { describe, it, expect, beforeEach } from 'vitest'
import { handleIncoming, conns, MAX_RELAY_FRAME_BYTES, type WsConn } from './ws-bus'

function fakeConn(): WsConn & { sent: string[] } {
  const conn = {
    rooms: new Set<string>(),
    authed: false,
    userId: '',
    send: null as unknown as (d: string) => void,
  } as WsConn & { sent: string[] }
  conn.sent = []
  conn.send = (d: string) => { conn.sent.push(d) }
  return conn
}

function authed(userId = 'u1'): WsConn & { sent: string[] } {
  const c = fakeConn()
  c.authed = true
  c.userId = userId
  c.rooms.add('global')
  conns.add(c)
  return c
}

beforeEach(() => {
  for (const c of conns) conns.delete(c)
})

describe('audit A1: subscribe allowlist', () => {
  it('lobby and global stay subscribable', () => {
    const conn = authed()
    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: ['lobby', 'global'] }))
    expect(conn.rooms.has('lobby')).toBe(true)
  })

  it('watch:* rooms cannot be subscribed (membership mints via watch.join)', () => {
    const conn = authed()
    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: ['watch:abc12345'] }))
    expect(conn.rooms.has('watch:abc12345')).toBe(false)
  })

  it('arbitrary room names are rejected; a peer cannot be spied on', () => {
    const conn = authed('spy')
    const peer = authed('peer')
    // Server-side code that relays into a room still works for a member:
    peer.rooms.add('room-x')
    handleIncoming(conn, JSON.stringify({ type: 'subscribe', rooms: ['room-x'] }))
    expect(conn.rooms.has('room-x')).toBe(false)
  })
})

describe('audit A2: lobby room is server-only', () => {
  it('client lobby frames are not relayed', () => {
    const sender = authed('sender')
    const peer = authed('peer')
    peer.rooms.add('lobby')
    handleIncoming(sender, JSON.stringify({ type: 'lobby', action: 'updated' }))
    expect(peer.sent).toHaveLength(0)
  })
})

describe('relay frame bound', () => {
  it('relays a normal announcement whole', () => {
    const sender = authed('sender')
    const peer = authed('peer')
    const frame = {
      type: 'SWARM_FRAME',
      swarm: { type: 'IMAGE_ANNOUNCE', payload: { id: 'obj-1', caption: 'hello' } },
    }
    handleIncoming(sender, JSON.stringify(frame))
    expect(peer.sent).toHaveLength(1)
    const relayed = JSON.parse(peer.sent[0])
    expect(relayed.type).toBe('SWARM_FRAME')
    expect(relayed.relayedBy).toBe('sender')
    expect(relayed.swarm.payload.id).toBe('obj-1')
  })

  it('drops an oversized frame instead of fanning it out', () => {
    // The relay copies one payload to every authed socket in the room, so an
    // unbounded frame is an amplification vector.
    const sender = authed('sender')
    const peer = authed('peer')
    const huge = 'x'.repeat(MAX_RELAY_FRAME_BYTES + 1024)
    handleIncoming(sender, JSON.stringify({
      type: 'SWARM_FRAME',
      swarm: { type: 'IMAGE_ANNOUNCE', payload: { id: 'obj-1', caption: huge } },
    }))
    expect(peer.sent).toHaveLength(0)
  })

  it('a top-level SWARM_CHUNK is still refused (audit A2)', () => {
    // The client used to split big announcements into top-level SWARM_CHUNK
    // frames — which this relay drops, so those announcements were LOST.
    // The client now sends the frame whole; this locks the relay's half of
    // that contract.
    const sender = authed('sender')
    const peer = authed('peer')
    handleIncoming(sender, JSON.stringify({
      type: 'SWARM_CHUNK',
      transferId: 'tr-1',
      index: 0,
      total: 2,
      chunk: 'abc',
    }))
    expect(peer.sent).toHaveLength(0)
  })
})
