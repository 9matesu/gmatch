// Audit rodada 5 regression locks: subscribe-room spoofing (A1) and
// client lobby injection (A2). See docs/AUDIT-2026-09-13.md for history.
import { describe, it, expect, beforeEach } from 'vitest'
import { handleIncoming, conns, type WsConn } from './ws-bus'

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
