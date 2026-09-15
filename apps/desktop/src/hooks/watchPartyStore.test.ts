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
  joinParty,
  joinPartyById,
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
})
