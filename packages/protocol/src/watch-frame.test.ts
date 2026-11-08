import { describe, it, expect } from 'vitest'
import {
  parseWatchFrame,
  parseWatchPayload,
  parseWatchServerFrame,
  type WatchFrame,
} from './watch-frame'

// The watch contract is shared by the node (which parses what a client sends)
// and the client (which parses what the node broadcasts). Both directions are
// NARROWED: a wrong-typed field is dropped, never coerced.

describe('parseWatchFrame (client -> node)', () => {
  it('rejects anything that is not a plain object', () => {
    expect(parseWatchFrame(null)).toBeNull()
    expect(parseWatchFrame(undefined)).toBeNull()
    expect(parseWatchFrame('watch.join')).toBeNull()
    expect(parseWatchFrame(42)).toBeNull()
    expect(parseWatchFrame([{ party: 'p' }])).toBeNull()
  })

  it('copies only the known fields', () => {
    const frame = parseWatchFrame({ type: 'watch', party: 'p1', action: 'play', position: 4, evil: 'x' })
    expect(frame).not.toBeNull()
    expect(frame!.party).toBe('p1')
    expect(frame!.action).toBe('play')
    expect(frame!.position).toBe(4)
    expect('evil' in frame!).toBe(false)
  })

  it('drops a field whose type is wrong instead of coercing it', () => {
    // The old handlers did Number(msg.position) / String(msg.party), so a
    // client could send "7" for a number and "0" for a party id. The frame is
    // now narrowed: a wrong type is simply not there.
    const frame = parseWatchFrame({ party: 'p1', position: '7', on: 'yes', size: 'big' })
    expect(frame!.position).toBeUndefined()
    expect(frame!.on).toBeUndefined()
    expect(frame!.size).toBeUndefined()
    expect(frame!.party).toBe('p1')
  })

  it('keeps a relay descriptor only when it carries both halves', () => {
    const full = parseWatchFrame({ relay: { upstream: 'https://x/y', referer: 'https://x/' } })
    expect(full!.relay).toEqual({ upstream: 'https://x/y', referer: 'https://x/' })
    expect(parseWatchFrame({ relay: { upstream: 'https://x/y' } })!.relay).toBeUndefined()
    expect(parseWatchFrame({ relay: 'nope' })!.relay).toBeUndefined()
  })
})

describe('parseWatchPayload (node -> client)', () => {
  it('rejects a frame that is not a room payload', () => {
    expect(parseWatchPayload(null)).toBeNull()
    expect(parseWatchPayload({ type: 'feed' })).toBeNull()
    expect(parseWatchPayload({ type: 'watch.pong' })).toBeNull()
  })

  it('narrows a transport sync', () => {
    const p = parseWatchPayload({
      type: 'watch.sync', party: 'p1',
      frame: { url: '/api/objects/x', action: 'play', position: 5, rate: 1, updatedAt: 100, rev: 3 },
    })
    expect(p).not.toBeNull()
    expect(p!.type).toBe('watch.sync')
    if (p!.type !== 'watch.sync') throw new Error('expected sync')
    expect(p!.frame.rev).toBe(3)
    expect(p!.frame.action).toBe('play')
  })

  it('drops a sync whose frame has no url', () => {
    expect(parseWatchPayload({ type: 'watch.sync', party: 'p1', frame: { action: 'pause' } })).toBeNull()
  })

  it('narrows a roster and keeps only the members with an id', () => {
    const p = parseWatchPayload({
      type: 'watch.roster', party: 'p1', host: 'u1',
      members: [{ id: 'u2', name: 'Bob', muted: true }, { name: 'NoId' }, 'junk'],
    })
    expect(p).not.toBeNull()
    if (p!.type !== 'watch.roster') throw new Error('expected roster')
    expect(p!.members).toHaveLength(1)
    expect(p!.members[0]).toEqual({ id: 'u2', name: 'Bob', muted: true })
    expect(p!.host).toBe('u1')
  })

  it('widens a roster that carries the snapshot fields', () => {
    const p = parseWatchPayload({
      type: 'watch.roster', party: 'p1', host: 'u1', members: [],
      frame: { url: 'u', action: 'pause', position: 0, rate: 1, updatedAt: 1, rev: 2 },
      chat: [{ id: 'm1', from: 'u2', name: 'Bob', text: 'yo', at: 5 }],
      queue: [{ id: 'q1', name: 'Clip', url: 'u' }],
      current: 'q1', queueRev: 3, settingsRev: 4,
      ready: { q1: ['u2'] },
      sharedControl: true, requireApproval: false, lockVideo: true, isPrivate: false,
    })
    expect(p).not.toBeNull()
    if (!p || !('frame' in p)) throw new Error('expected a snapshot')
    expect(p.frame.rev).toBe(2)
    expect(p.chat[0].text).toBe('yo')
    expect(p.queue[0].id).toBe('q1')
    expect(p.current).toBe('q1')
    expect(p.ready.q1).toEqual(['u2'])
    expect(p.sharedControl).toBe(true)
  })

  it('drops queue entries without an id or a url', () => {
    const p = parseWatchPayload({
      type: 'watch.queue', party: 'p1', queue: [{ name: 'no id' }, { id: 'q2' }, { id: 'q3', url: 'u' }],
      current: 'q3', frame: { url: 'u', action: 'pause', position: 0, rate: 1, updatedAt: 0, rev: 0 },
      queueRev: 1, ready: {},
    })
    expect(p).not.toBeNull()
    if (p!.type !== 'watch.queue') throw new Error('expected queue')
    expect(p!.queue.map((q) => q.id)).toEqual(['q3'])
  })

  it('narrows a chat line', () => {
    const p = parseWatchPayload({ type: 'watch.chat', party: 'p1', msgId: 'm1', from: { id: 'u2', name: 'Bob' }, text: 'yo', at: 5 })
    expect(p).not.toBeNull()
    if (p!.type !== 'watch.chat') throw new Error('expected chat')
    expect(p!.from).toEqual({ id: 'u2', name: 'Bob' })
  })

  it('drops a settings field of the wrong type but keeps the rest', () => {
    const p = parseWatchPayload({ type: 'watch.settings', party: 'p1', name: 'Room', isPrivate: 'yes', lockVideo: true })
    expect(p).not.toBeNull()
    if (p!.type !== 'watch.settings') throw new Error('expected settings')
    expect(p!.name).toBe('Room')
    expect(p!.isPrivate).toBeUndefined()
    expect(p!.lockVideo).toBe(true)
  })
})

describe('parseWatchServerFrame (every node -> client frame)', () => {
  it('recognises the control frames', () => {
    expect(parseWatchServerFrame({ type: 'watch.nack', party: 'p1', action: 'pause' })).toEqual({ type: 'watch.nack', party: 'p1', action: 'pause' })
    expect(parseWatchServerFrame({ type: 'watch.kicked', party: 'p1' })).toEqual({ type: 'watch.kicked', party: 'p1' })
    expect(parseWatchServerFrame({ type: 'watch.gone', party: 'p1' })).toEqual({ type: 'watch.gone', party: 'p1' })
    expect(parseWatchServerFrame({ type: 'watch.pong', t0: 1, t1: 2 })).toEqual({ type: 'watch.pong', t0: 1, t1: 2 })
  })

  it('returns null for anything else', () => {
    expect(parseWatchServerFrame(null)).toBeNull()
    expect(parseWatchServerFrame({ type: 'feed' })).toBeNull()
    expect(parseWatchServerFrame('watch.sync')).toBeNull()
  })
})
