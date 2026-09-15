// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/orbitWebSocket', () => ({
  subscribeOrbitWebSocket: vi.fn(() => () => {}),
  sendOrbitWebSocket: vi.fn(() => true),
}))
vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn(),
  getApiBaseUrl: () => 'http://localhost',
}))

import { subscribeOrbitWebSocket, sendOrbitWebSocket } from '../utils/orbitWebSocket'
import { orbitFetch } from '../utils/api'
import {
  watchPartyStore,
  resetWatchParty,
  handleWatchMessage,
  createParty,
  loadPartyVideos,
  joinParty,
  joinPartyById,
  sendPartyChat,
  leaveParty,
  controlPlayback,
  MAX_SLOTS,
} from './watchPartyStore'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never
const ls = new Map<string, string>()

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => ls.set(k, v),
    removeItem: (k: string) => ls.delete(k),
  })
  vi.mocked(sendOrbitWebSocket).mockClear()
  resetWatchParty()
})
afterEach(() => vi.unstubAllGlobals())

describe('watchPartyStore', () => {
  it('createParty posts the URL, then joins + subscribes', async () => {
    vi.mocked(orbitFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ party: { id: 'p1', name: 'Night', url: '/api/objects/x' } }), { status: 201 }),
    )
    const res = await createParty(identity, 'https://example.com/v', 'Night')
    expect(res.ok).toBe(true)
    expect(subscribeOrbitWebSocket).toHaveBeenCalled()
    expect(watchPartyStore.getSnapshot().parties[0]?.id).toBe('p1')
    expect(watchPartyStore.getSnapshot().subscribed).toBe(true)
    expect(sendOrbitWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watch.join', party: 'p1' }),
    )
  })

  it('createParty surfaces the server parse error verbatim', async () => {
    vi.mocked(orbitFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Could not find a playable video at that link.' }), { status: 422 }),
    )
    const res = await createParty(identity, 'https://example.com/junk', '')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('playable video')
    expect(watchPartyStore.getSnapshot().parties).toHaveLength(0)
  })

  it('sync/roster frames update the right party; foreign parties ignored', () => {
    joinParty(identity, { id: 'p1', name: 'N', url: '/api/objects/x' })
    joinParty(identity, { id: 'p2', name: 'M', url: '/api/objects/y' })
    handleWatchMessage({ type: 'watch.sync', party: 'p1', frame: { url: '/api/objects/x', action: 'play', position: 5, rate: 1, updatedAt: 100 } })
    const [p1, p2] = watchPartyStore.getSnapshot().parties
    expect(p1.frame?.position).toBe(5)
    expect(p2.frame).toBeNull()
    handleWatchMessage({ type: 'watch.sync', party: 'ghost', frame: { action: 'pause', position: 99 } })
    expect(watchPartyStore.getSnapshot().parties.find((p) => p.id === 'p1')!.frame?.position).toBe(5)
    handleWatchMessage({ type: 'watch.roster', party: 'p1', members: [{ id: 'u2', name: 'Bob' }] })
    expect(watchPartyStore.getSnapshot().parties.find((p) => p.id === 'p1')!.members).toEqual([{ id: 'u2', name: 'Bob' }])
  })

  it('watch.chat appends text (clamped) to the right party only', () => {
    joinParty(identity, { id: 'p1', name: 'N', url: 'u' })
    handleWatchMessage({ type: 'watch.chat', party: 'p1', msgId: 'm1', from: { id: 'u2', name: 'Bob' }, text: 'yo', at: 5 })
    handleWatchMessage({ type: 'watch.chat', party: 'p1', msgId: 'm2', from: { id: 'u2', name: 'Bob' }, text: 'x'.repeat(100), at: 6 })
    const p = watchPartyStore.getSnapshot().parties[0]
    expect(p.chat).toEqual([
      { id: 'm1', from: 'u2', name: 'Bob', text: 'yo', at: 5 },
      { id: 'm2', from: 'u2', name: 'Bob', text: 'x'.repeat(80), at: 6 },
    ])
    handleWatchMessage({ type: 'watch.chat_del', party: 'p1', msgId: 'm1' })
    expect(watchPartyStore.getSnapshot().parties[0].chat.map((c) => c.id)).toEqual(['m2'])
    sendPartyChat('p1', ' hey ')
    expect(sendOrbitWebSocket).toHaveBeenLastCalledWith({ type: 'watch.chat', party: 'p1', text: 'hey' })
  })

  it('__ws_reconnected re-joins every open party', () => {
    joinParty(identity, { id: 'a', name: 'A', url: 'u' })
    joinParty(identity, { id: 'b', name: 'B', url: 'u' })
    vi.mocked(sendOrbitWebSocket).mockClear()
    handleWatchMessage({ type: '__ws_reconnected' })
    expect(sendOrbitWebSocket).toHaveBeenCalledWith(expect.objectContaining({ type: 'watch.join', party: 'a' }))
    expect(sendOrbitWebSocket).toHaveBeenCalledWith(expect.objectContaining({ type: 'watch.join', party: 'b' }))
  })

  it('watch.kicked drops the party and sets the notice', () => {
    joinParty(identity, { id: 'a', name: 'Alone', url: 'u' })
    handleWatchMessage({ type: 'watch.kicked', party: 'a' })
    expect(watchPartyStore.getSnapshot().parties).toHaveLength(0)
    expect(watchPartyStore.getSnapshot().kickedNotice).toContain('Alone')
  })

  it('watch.gone drops the room with a closed notice (no ghost 404 loop)', () => {
    joinParty(identity, { id: 'a', name: 'Ghost', url: 'u' })
    handleWatchMessage({ type: 'watch.gone', party: 'a' })
    expect(watchPartyStore.getSnapshot().parties).toHaveLength(0)
    expect(watchPartyStore.getSnapshot().kickedNotice).toContain('closed')
  })

  it('roster join-snapshot restores frame, chat and queue', () => {
    joinParty(identity, { id: 'a', name: 'A', url: 'u' })
    handleWatchMessage({
      type: 'watch.roster', party: 'a', host: 'me',
      members: [{ id: 'me', name: 'Me' }],
      frame: { url: 'u', action: 'play', position: 10, rate: 1, updatedAt: 100, by: 'Bob' },
      chat: [{ id: 'c1', from: 'u2', name: 'Bob', text: 'hi', at: 1 }],
      queue: [{ id: 'q1', name: 'vid', url: 'u' }], current: 'q1',
    })
    const p = watchPartyStore.getSnapshot().parties[0]
    expect(p.frame?.position).toBe(10)
    expect(p.host).toBe('me')
    expect(p.queue).toEqual([{ id: 'q1', name: 'vid', url: 'u' }])
    expect(p.current).toBe('q1')
    expect(p.mediaName).toBe('vid')
  })

  it('caps slots at MAX_SLOTS, oldest evicted', () => {
    for (let i = 0; i < MAX_SLOTS + 1; i++) joinParty(identity, { id: `p${i}`, name: 'x', url: 'u' })
    const ids = watchPartyStore.getSnapshot().parties.map((p) => p.id)
    expect(ids).toHaveLength(MAX_SLOTS)
    expect(ids).not.toContain('p0')
  })

  it('controlPlayback sends the frame shape', () => {
    controlPlayback('p9', 'play', 12)
    expect(sendOrbitWebSocket).toHaveBeenCalledWith({ type: 'watch', party: 'p9', action: 'play', position: 12 })
    controlPlayback('p9', 'pause', -5)
    expect(sendOrbitWebSocket).toHaveBeenLastCalledWith({ type: 'watch', party: 'p9', action: 'pause', position: 0 })
  })

  it('leaveParty unsubscribes only when the last party is gone', () => {
    const unsub = vi.fn()
    vi.mocked(subscribeOrbitWebSocket).mockReturnValue(unsub)
    joinParty(identity, { id: 'a', name: 'A', url: 'u' })
    joinParty(identity, { id: 'b', name: 'B', url: 'u' })
    leaveParty('a')
    expect(unsub).not.toHaveBeenCalled()
    leaveParty('b')
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(watchPartyStore.getSnapshot().subscribed).toBe(false)
  })

  it('joinPartyById fetches the snapshot before joining', async () => {
    vi.mocked(orbitFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'z', name: 'Z', url: '/api/objects/z', frame: {}, members: [] }), { status: 200 }),
    )
    expect(await joinPartyById(identity, 'z')).toBe(true)
    expect(watchPartyStore.getSnapshot().parties[0]?.url).toBe('/api/objects/z')
    vi.mocked(orbitFetch).mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await joinPartyById(identity, 'gone')).toBe(false)
  })

  it('loadPartyVideos posts urls and reports the failed list', async () => {
    vi.mocked(orbitFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, added: [{ id: 'q1', name: 'a', url: '/api/objects/a' }], failed: ['https://junk/2'] }), { status: 200 }),
    )
    const r = await loadPartyVideos(identity, 'p1', ['https://a', 'https://junk/2'], true)
    const call = vi.mocked(orbitFetch).mock.calls.at(-1)!
    expect(call[0]).toBe('/api/watchparty/p1/video')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ urls: ['https://a', 'https://junk/2'], queueOnly: true })
    expect(r).toEqual({ ok: true, added: 1, failed: ['https://junk/2'] })
  })

  it('loadPartyVideos surfaces server errors', async () => {
    vi.mocked(orbitFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Add up to 10 videos at a time.' }), { status: 400 }),
    )
    const r = await loadPartyVideos(identity, 'p1', ['x'], false)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('10 videos')
  })
})
