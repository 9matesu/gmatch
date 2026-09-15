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
  leaveParty,
  controlPlayback,
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
    const state = watchPartyStore.getSnapshot()
    expect(state.party?.id).toBe('p1')
    expect(state.subscribed).toBe(true)
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
    expect(watchPartyStore.getSnapshot().party).toBeNull()
  })

  it('watch.sync frames update state; foreign parties are ignored', () => {
    joinParty(identity, { id: 'p1', name: 'N', url: '/api/objects/x' })
    handleWatchMessage({ type: 'watch.sync', party: 'p1', frame: { url: '/api/objects/x', action: 'play', position: 5, rate: 1, updatedAt: 100 } })
    expect(watchPartyStore.getSnapshot().frame?.position).toBe(5)
    handleWatchMessage({ type: 'watch.sync', party: 'other', frame: { action: 'pause', position: 99 } })
    expect(watchPartyStore.getSnapshot().frame?.position).toBe(5)
    handleWatchMessage({ type: 'watch.roster', party: 'p1', members: [{ id: 'u2', name: 'Bob' }] })
    expect(watchPartyStore.getSnapshot().members).toEqual([{ id: 'u2', name: 'Bob' }])
  })

  it('controlPlayback sends the frame shape', () => {
    joinParty(identity, { id: 'p9', name: 'N', url: 'u' })
    vi.mocked(sendOrbitWebSocket).mockClear()
    controlPlayback('play', 12)
    expect(sendOrbitWebSocket).toHaveBeenCalledWith({ type: 'watch', party: 'p9', action: 'play', position: 12 })
    controlPlayback('pause', -5)
    expect(sendOrbitWebSocket).toHaveBeenLastCalledWith({ type: 'watch', party: 'p9', action: 'pause', position: 0 })
  })

  it('leaveParty clears state and unsubscribes', () => {
    const unsub = vi.fn()
    vi.mocked(subscribeOrbitWebSocket).mockReturnValueOnce(unsub)
    joinParty(identity, { id: 'p1', name: 'N', url: 'u' })
    leaveParty()
    expect(unsub).toHaveBeenCalled()
    expect(watchPartyStore.getSnapshot().party).toBeNull()
    expect(watchPartyStore.getSnapshot().subscribed).toBe(false)
  })
})
