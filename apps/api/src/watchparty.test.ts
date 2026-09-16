import { describe, it, expect, beforeEach } from 'vitest'
import {
  createParty, getParty, listParties, applyWatch, joinWatch, leaveWatch, leaveAll, applyChat,
  deleteChat, kickWatch, banWatch, muteWatch, transferHost, settingsWatch,
  queueOps, setPartyMedia, __resetParties, partyRoom, IDLE_MS, MAX_QUEUE, isPartyMediaObject,
  serializeParties, restoreParties, liveMediaObjectIds, type Party,
} from './watchparty'
import { handleIncoming, conns, createWsTicket, type WsConn } from './ws-bus'

function fakeConn(): WsConn & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    send: (data: string) => { sent.push(data); return true },
    rooms: new Set<string>(),
  }
}

function authed(conn: WsConn & { sent: string[] }, userId: string) {
  handleIncoming(conn, JSON.stringify({ type: 'auth', ticket: createWsTicket(userId) }))
}

beforeEach(() => {
  __resetParties()
  conns.clear()
})

function makeParty(creator = 'u1'): Party {
  return createParty('T', 'u', 'u', undefined, creator)
}

describe('room model (host, private, queue, chat history)', () => {
  it('createParty sets host and auto-joins the creator', () => {
    const p = makeParty()
    expect(p.hostId).toBe('u1')
    expect(p.members.has('u1')).toBe(true)
    expect(p.isPrivate).toBe(false)
    expect(p.lockVideo).toBe(false)
    expect(p.queue).toEqual([])
  })

  it('joinWatch returns full snapshot: roster+host, frame, chat, queue', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    const res = joinWatch('u3', 'Cleo', { party: p.id })!
    const pl = Array.isArray(res.payload) ? res.payload.find((x: any) => x.type === 'watch.roster') : res.payload
    expect(pl.party).toBe(p.id)
    expect(pl.host).toBe('u1')
    expect(pl.members).toEqual([
      { id: 'u1', name: '', muted: false },
      { id: 'u2', name: 'Bob', muted: false },
      { id: 'u3', name: 'Cleo', muted: false },
    ])
    expect(pl.frame).toBeTruthy()
    expect(Array.isArray(pl.chat)).toBe(true)
    expect(Array.isArray(pl.queue)).toBe(true)
  })

  it('applyWatch stamps the acting member name on the frame', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    const res = applyWatch('u2', { party: p.id, action: 'play', position: 4 })!
    expect(res.payload.frame.by).toBe('Bob')
  })

  it('leaveWatch removes member and broadcasts system + roster; host promotes', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    const res = leaveWatch('u1', { party: p.id })!
    expect(p.members.has('u1')).toBe(false)
    expect(p.hostId).toBe('u2') // promotion
    expect(res.payload.find((r: any) => r.type === 'watch.system') !== undefined || res.payload.type === 'watch.system').toBe(true)
  })

  it('leaveAll covers every room the user was in', () => {
    const a = makeParty('uA')
    const b = makeParty('uB')
    joinWatch('u9', 'Ghost', { party: a.id })
    joinWatch('u9', 'Ghost', { party: b.id })
    const results = leaveAll('u9')
    expect(results.length).toBe(2)
    expect(a.members.has('u9')).toBe(false)
    expect(b.members.has('u9')).toBe(false)
  })

  it('last member leaving deletes the party', () => {
    const p = makeParty()
    leaveWatch('u1', { party: p.id })
    expect(getParty(p.id)).toBeNull()
  })
})

describe('moderation', () => {
  it('non-host kick is null; host kick removes the target', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    expect(kickWatch('u2', { party: p.id, target: 'u1' })).toBeNull()
    const res = kickWatch('u1', { party: p.id, target: 'u2' })!
    expect(p.members.has('u2')).toBe(false)
    expect(res.kicked).toBe('u2')
  })

  it('ban blocks rejoin for the party lifetime', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    const res = banWatch('u1', { party: p.id, target: 'u2' })!
    expect(p.bans.has('u2')).toBe(true)
    expect(res.kicked).toBe('u2')
    expect(joinWatch('u2', 'Bob', { party: p.id })).toBeNull()
  })

  it('mute blocks chat for that member; unmute restores', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    expect(muteWatch('u2', { party: p.id, target: 'u1' })).toBeNull() // not host
    const r = muteWatch('u1', { party: p.id, target: 'u2', on: true })!
    expect(r.payload.muted).toEqual({ u2: true })
    applyChat('u2', 'Bob', { party: p.id, text: 'hello?' })
    expect(p.chat.length).toBe(0)
    muteWatch('u1', { party: p.id, target: 'u2', on: false })
    expect(applyChat('u2', 'Bob', { party: p.id, text: 'hello' })).not.toBeNull()
  })

  it('host transfer moves hostId and is host-only', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    expect(transferHost('u2', { party: p.id, target: 'u1' })).toBeNull()
    transferHost('u1', { party: p.id, target: 'u2' })
    expect(p.hostId).toBe('u2')
    expect(transferHost('u2', { party: p.id, target: 'nobody' })).toBeNull()
  })

  it('settings clamps: name length, booleans; host-only', () => {
    const p = makeParty()
    expect(settingsWatch('u2', { party: p.id, name: 'x' })).toBeNull()
    joinWatch('u2', 'Bob', { party: p.id })
    settingsWatch('u1', { party: p.id, name: 'a'.repeat(99), isPrivate: true, lockVideo: true })
    expect(p.name.length).toBe(40)
    expect(p.isPrivate).toBe(true)
    expect(p.lockVideo).toBe(true)
  })

  it('listParties hides private rooms', () => {
    const p = makeParty()
    settingsWatch('u1', { party: p.id, isPrivate: true })
    expect(listParties().find((x) => x.id === p.id)).toBeUndefined()
  })
})

describe('chat', () => {
  it('chat history lives on the party, capped at 80, with ids', () => {
    const p = makeParty()
    for (let i = 0; i < 90; i++) {
      // bypass rate limit: nudge lastChat ts manually per user rotation
      p.lastChat.set('u1', 0)
      applyChat('u1', 'Host', { party: p.id, text: `m${i}` })
    }
    expect(p.chat.length).toBe(80)
    expect(p.chat[79].text).toBe('m89')
    expect(p.chat[79].id.length).toBeGreaterThan(0)
  })

  it('deleteChat by author or host; strangers dropped', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    p.lastChat.set('u2', 0)
    const res = applyChat('u2', 'Bob', { party: p.id, text: 'oops' })!
    const msgId = res.payload.msgId
    expect(deleteChat('u3', { party: p.id, msgId })).toBeNull()
    const del = deleteChat('u2', { party: p.id, msgId })!
    expect(del.payload.msgId).toBe(msgId)
    expect(p.chat.some((m) => m.id === msgId)).toBe(false)
    expect(deleteChat('u1', { party: p.id, msgId: 'zz' })).toBeNull()
  })
})

describe('queue', () => {
  it('queueOps add/remove/next mutates + returns room payload', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    queueOps('u2', { party: p.id, op: 'add', name: 'a', url: '/api/objects/a' })
    queueOps('u1', { party: p.id, op: 'add', name: 'b', url: '/api/objects/b' } )
    expect(p.queue.length).toBe(2)
    expect(p.queue[0].id.length).toBe(8)
    const firstId = p.queue[0].id
    const next = queueOps('u1', { party: p.id, op: 'next' })!
    expect(p.current).toBe(firstId)
    expect(p.mediaUrl).toBe('/api/objects/a')
    expect(next.payload.current).toBe(firstId)
    queueOps('u1', { party: p.id, op: 'remove', id: firstId })
    expect(p.queue.length).toBe(1)
    expect(p.queue[0].name).toBe('b')
  })

  it('queueOps move reorders by id (drag-and-drop queue)', () => {
    const p = makeParty()
    queueOps('u1', { party: p.id, op: 'add', name: 'a', url: '/api/objects/a' })
    queueOps('u1', { party: p.id, op: 'add', name: 'b', url: '/api/objects/b' })
    queueOps('u1', { party: p.id, op: 'add', name: 'c', url: '/api/objects/c' })
    const [a, b, c] = p.queue.map((q) => q.id)
    const res = queueOps('u1', { party: p.id, op: 'move', id: a, before: c })!
    expect(p.queue.map((q) => q.name)).toEqual(['b', 'a', 'c'])
    expect(res.payload.queue.map((q: any) => q.name)).toEqual(['b', 'a', 'c'])
    // unknown ids drop the frame
    expect(queueOps('u1', { party: p.id, op: 'move', id: 'zzzzzzzz', before: a })).toBeNull()
    expect(queueOps('u1', { party: p.id, op: 'move', id: a, before: 'zzzzzzzz' })).toBeNull()
    // missing 'before' appends to the end
    queueOps('u1', { party: p.id, op: 'move', id: b })
    expect(p.queue.map((q) => q.name)).toEqual(['a', 'c', 'b'])
  })

  it('disband closes the room host-only; members get watch.gone', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    const hostSock = fakeConn(); authed(hostSock, 'u1'); conns.add(hostSock)
    hostSock.rooms.add(partyRoom(p.id))
    const memberSock = fakeConn(); authed(memberSock, 'u2'); conns.add(memberSock)
    memberSock.rooms.add(partyRoom(p.id))
    // non-host cannot disband
    handleIncoming(memberSock, JSON.stringify({ type: 'watch.disband', party: p.id }))
    expect(getParty(p.id)).toBeTruthy()
    handleIncoming(hostSock, JSON.stringify({ type: 'watch.disband', party: p.id }))
    expect(getParty(p.id)).toBeFalsy()
    expect(memberSock.sent.some((s) => s.includes('"watch.gone"') && s.includes(p.id))).toBe(true)
    // the host's own socket also learns the room is gone
    expect(hostSock.sent.some((s) => s.includes('"watch.gone"'))).toBe(true)
  })

  it('lockVideo blocks member queue ops but not the host', () => {
    const p = makeParty()
    joinWatch('u2', 'Bob', { party: p.id })
    p.lockVideo = true
    expect(queueOps('u2', { party: p.id, op: 'add', name: 'x', url: '/api/objects/x' })).toBeNull()
    expect(queueOps('u1', { party: p.id, op: 'add', name: 'x', url: '/api/objects/x' })).not.toBeNull()
  })

  it('queue caps at MAX_QUEUE dropping oldest non-current', () => {
    const p = makeParty()
    for (let i = 0; i < MAX_QUEUE + 5; i++) {
      queueOps('u1', { party: p.id, op: 'add', name: `q${i}`, url: `/api/objects/${i}` })
    }
    expect(p.queue.length).toBe(MAX_QUEUE)
    expect(p.queue[MAX_QUEUE - 1].name).toBe(`q${MAX_QUEUE + 4}`)
  })

  it('room idle window covers an overnight run', () => {
    expect(IDLE_MS).toBeGreaterThanOrEqual(4 * 60 * 60_000)
  })

  it("'next' keeps the room playing when the previous frame was playing", () => {
    const p = makeParty()
    queueOps('u1', { party: p.id, op: 'add', name: 'a', url: '/api/objects/a' })
    queueOps('u1', { party: p.id, op: 'add', name: 'b', url: '/api/objects/b' })
    queueOps('u1', { party: p.id, op: 'play', id: p.queue[0].id })
    applyWatch('u1', { party: p.id, action: 'play', position: 60 })
    const res = queueOps('u1', { party: p.id, op: 'next' })!
    expect(res.payload.frame.action).toBe('play')
    expect(res.payload.frame.position).toBe(0)
  })

  it("'next' on a paused room stays paused; manual 'play' starts playback", () => {
    const p = makeParty()
    queueOps('u1', { party: p.id, op: 'add', name: 'a', url: '/api/objects/a' })
    queueOps('u1', { party: p.id, op: 'add', name: 'b', url: '/api/objects/b' })
    const n = queueOps('u1', { party: p.id, op: 'next' })!
    expect(n.payload.frame.action).toBe('pause')
    queueOps('u1', { party: p.id, op: 'play', id: p.queue[1].id })
    expect(p.frame.action).toBe('play')
  })

  it("'next' wraps past the last entry (loop), single entry replays itself", () => {
    const p = makeParty()
    queueOps('u1', { party: p.id, op: 'add', name: 'solo', url: '/api/objects/s' })
    queueOps('u1', { party: p.id, op: 'play', id: p.queue[0].id })
    applyWatch('u1', { party: p.id, action: 'play', position: 90 })
    const before = p.frame
    const res = queueOps('u1', { party: p.id, op: 'next' })!
    expect(res.payload.current).toBe(p.queue[0].id)
    expect(res.payload.frame.position).toBe(0)
    expect(p.frame).not.toBe(before) // replay = a NEW stamped frame, so clients reseek
    expect(p.frame.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
  })
})

describe('ws relay integration', () => {
  it('watch.join subscribes the socket and broadcasts roster; watch relays sync', () => {
    const p = makeParty('u0')
    const a = fakeConn()
    const b = fakeConn()
    conns.add(a)
    conns.add(b)
    authed(a, 'u1')
    authed(b, 'u2')
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Alice' }))
    expect(a.rooms.has(partyRoom(p.id))).toBe(true)
    handleIncoming(b, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Bob' }))
    const rosterA = a.sent.map(JSON.parse).filter((m) => m.type === 'watch.roster')
    expect(rosterA.length).toBe(2)
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

  it('watch.join for a dead party answers watch.gone on that socket only', () => {
    const a = fakeConn()
    conns.add(a)
    authed(a, 'u1')
    a.sent.length = 0
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: 'zzzzzzzz' }))
    expect(a.sent.map(JSON.parse).some((m) => m.type === 'watch.gone' && m.party === 'zzzzzzzz')).toBe(true)
  })

  it('watch.ping refreshes lastSeen of every room the user is in', () => {
    const p = makeParty('u1')
    joinWatch('u2', 'Bob', { party: p.id })
    p.lastSeen = Date.now() - 60_000
    const a = fakeConn()
    conns.add(a)
    authed(a, 'u2')
    handleIncoming(a, JSON.stringify({ type: 'watch.ping', t0: 1 }))
    expect(Date.now() - p.lastSeen).toBeLessThan(2000)
  })

  it('transport frames are throttled per member (audit A3)', () => {
    const p = makeParty('u1')
    joinWatch('u1', 'Me', { party: p.id })
    let relayed = 0
    for (let i = 0; i < 30; i++) if (applyWatch('u1', { party: p.id, action: 'play', position: i })) relayed++
    // 30 bursts, 1 every 200ms is 6s of human playback spam; a bot gets ~2.
    expect(relayed).toBeLessThanOrEqual(3)
    // And a legit next-frame after the window still passes.
    p.lastControl.set('u1', Date.now() - 500)
    expect(applyWatch('u1', { party: p.id, action: 'pause', position: 5 })).not.toBeNull()
  })

  it('unauthenticated watch frames are dropped', () => {
    const a = fakeConn()
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: 'x' }))
    expect(a.sent.filter((s) => s.includes('watch'))).toHaveLength(0)
  })

  it('kick delivers watch.kicked to the target and system frame to the room', () => {
    const p = makeParty('u1')
    const a = fakeConn()
    const b = fakeConn()
    conns.add(a)
    conns.add(b)
    authed(a, 'u1')
    authed(b, 'u2')
    handleIncoming(a, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Host' }))
    handleIncoming(b, JSON.stringify({ type: 'watch.join', party: p.id, name: 'Bob' }))
    a.sent.length = 0
    b.sent.length = 0
    handleIncoming(a, JSON.stringify({ type: 'watch.kick', party: p.id, target: 'u2' }))
    expect(b.sent.map(JSON.parse).some((m) => m.type === 'watch.kicked' && m.party === p.id)).toBe(true)
    expect(b.rooms.has(partyRoom(p.id))).toBe(false)
  })
})

describe('audit T9.1: capability key format is byte-exact across the seam', () => {
  it('isPartyMediaObject only answers true for the /api/objects/<id> shape the route stores', () => {
    const p = makeParty('u1')
    setPartyMedia(p, '/api/objects/abc-123')
    // objects.ts rebuilds the key as `/api/objects/${id}`; any drift
    // (trailing slash, absolute URL, different prefix) silently breaks
    // private-room streaming because it is a plain Map lookup.
    expect(isPartyMediaObject('/api/objects/abc-123')).toBe(true)
    expect(isPartyMediaObject('/api/objects/abc-123/')).toBe(false)
    expect(isPartyMediaObject('https://x.dev/api/objects/abc-123')).toBe(false)
    expect(isPartyMediaObject('/objects/abc-123')).toBe(false)
  })
})

describe('room persistence', () => {
  it('round-trips rooms through serialize/restore', () => {
    const p = makeParty('u1')
    joinWatch('u2', 'Bob', { party: p.id })
    applyWatch('u2', { party: p.id, action: 'play', position: 42 })
    queueOps('u1', { party: p.id, op: 'add', name: 'next', url: '/api/objects/n' })
    applyChat('u2', 'Bob', { party: p.id, text: 'gn everyone' })
    const dump = serializeParties()
    __resetParties()
    expect(getParty(p.id)).toBeNull()
    expect(restoreParties(dump)).toBe(1)
    const q = getParty(p.id)!
    expect(q.id).toBe(p.id)
    expect(q.name).toBe(p.name)
    expect(q.frame.position).toBe(42)
    expect(q.frame.action).toBe('play')
    expect(q.queue.length).toBe(1)
    expect(q.current).toBe(p.current)
    expect(q.hostId).toBe('u1')
    // roster re-forms via watch.join
    expect(q.members.size).toBe(0)
    // capability map is rebuilt: current AND queued media readable again
    expect(isPartyMediaObject(q.mediaUrl)).toBe(true)
    expect(isPartyMediaObject('/api/objects/n')).toBe(true)
    // chat lives as long as the room (feat/watch-bg-playback): the backlog
    // survives a restart for everyone who (re-)joins.
    expect(q.chat.some((m) => m.text === 'gn everyone')).toBe(true)
  })

  it('liveMediaObjectIds lists current + queued /api/objects ids', () => {
    const p = makeParty('u1')
    setPartyMedia(p, '/api/objects/aaa11111-1111-1111-1111-111111111111')
    queueOps('u1', { party: p.id, op: 'add', name: 'b', url: '/api/objects/bbb22222-2222-2222-2222-222222222222' })
    queueOps('u1', { party: p.id, op: 'add', name: 'r', url: '/api/watchparty/p/stream' })
    const ids = liveMediaObjectIds()
    expect(ids).toContain('aaa11111-1111-1111-1111-111111111111')
    expect(ids).toContain('bbb22222-2222-2222-2222-222222222222')
    expect(ids.length).toBe(2)
  })
  it('restore is idempotent and junk-safe', () => {
    expect(restoreParties('not json')).toBe(0)
    expect(restoreParties('{"nope":1}')).toBe(0)
    makeParty('u1')
    const dump = serializeParties()
    expect(restoreParties(dump)).toBe(0)
  })
})

