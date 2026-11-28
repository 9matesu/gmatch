// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

/**
 * A terminal miss (the node holds no bytes and no swarm peer answered) used to
 * be returned with `cache: false`. Every remount — a view switch, a recycled
 * feed tile, a re-render — replayed the 5s swarm ask, so the picture sat on
 * "Loading media…" forever. It is now cached and only a REAL peer-online
 * event retries it. A resolved object, likewise, is not re-resolved when a
 * caller re-renders with an equivalent identity object.
 */
const swarm = vi.hoisted(() => ({
  PEER_ONLINE_EVENT: 'gmatch-peer-online-test',
  getLocalObject: vi.fn(async () => null),
  registerLocalObject: vi.fn(),
  requestSwarmObject: vi.fn(),
  hasSwarmPeers: vi.fn(() => true),
}))

vi.mock('../utils/p2pSwarm', () => swarm)
vi.mock('../services/vault', () => ({ vaultProbe: vi.fn(async () => ({ state: 'miss' })) }))
vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({ type: 'p2p', content_hash: null, mime_type: 'image/png' }),
  }) as Response),
}))

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

async function modules() {
  const api = await import('../utils/api')
  const hook = await import('./useObjectImage')
  const metrics = await import('../utils/metrics')
  return {
    orbitFetch: vi.mocked(api.orbitFetch),
    useObjectImage: hook.useObjectImage,
    reset: hook.__resetObjectImageCacheForTests,
    snapshot: metrics.metricsSnapshot,
    resetMetrics: metrics.resetMetricsForTests,
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

describe('useObjectImage terminal misses', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const m = await modules()
    m.reset()
    m.resetMetrics()
    swarm.requestSwarmObject.mockRejectedValue(new Error('timeout'))
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:terminal')
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
  })

  afterEach(() => cleanup())

  it('caches a terminal miss so a remount neither re-parses nor re-asks', async () => {
    const m = await modules()
    const first = renderHook(() => m.useObjectImage('terminal-1', identity))
    await waitFor(() => expect(first.result.current.failed).toBe(true))
    expect(swarm.requestSwarmObject).toHaveBeenCalledTimes(1)
    expect(m.orbitFetch).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(() => m.useObjectImage('terminal-1', identity))
    await settle()
    expect(second.result.current.failed).toBe(true)
    expect(swarm.requestSwarmObject).toHaveBeenCalledTimes(1)
    expect(m.orbitFetch).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  it('retries a cached miss only when a peer actually comes online', async () => {
    const m = await modules()
    const h = renderHook(() => m.useObjectImage('terminal-2', identity))
    await waitFor(() => expect(h.result.current.failed).toBe(true))

    // A plain re-render is not a reason to re-ask.
    h.rerender()
    await settle()
    expect(swarm.requestSwarmObject).toHaveBeenCalledTimes(1)

    swarm.requestSwarmObject.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }))
    window.dispatchEvent(new CustomEvent(swarm.PEER_ONLINE_EVENT, { detail: { peerId: 'peer-1' } }))
    await waitFor(() => expect(h.result.current.url).toBe('blob:terminal'))
    expect(swarm.requestSwarmObject).toHaveBeenCalledTimes(2)
    expect(m.snapshot().counters['media.reload']).toBe(1)
    h.unmount()
  })

  it('keeps a hash-bearing attachment in "waiting for seeder", not "No preview"', async () => {
    const m = await modules()
    const hash = 'a'.repeat(64)
    const h = renderHook(() => m.useObjectImage(`urn:sha256:${hash}`, identity))
    await waitFor(() => expect(h.result.current.failed).toBe(true))
    // The hash is a real address: a peer coming online may still answer. The
    // UI must not claim "no path exists" while that is possible.
    expect(h.result.current.awaitingSeeder).toBe(true)
    h.unmount()
  })

  it('renders a resolved object without re-fetching on an equivalent re-render', async () => {
    const m = await modules()
    // An explicit local object skips the whole ladder, so use the node path:
    // override the 404-less json mock with real bytes.
    m.orbitFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => new Blob(['png'], { type: 'image/png' }),
    } as Response)

    const h = renderHook(
      ({ who }) => m.useObjectImage('resolved-render', { ...identity, orbitId: who }),
      { initialProps: { who: 'me' } },
    )
    await waitFor(() => expect(h.result.current.url).toBe('blob:terminal'))
    expect(m.orbitFetch).toHaveBeenCalledTimes(1)

    // A NEW identity object with the SAME id must not restart resolution.
    h.rerender({ who: 'me' })
    await settle()
    expect(m.orbitFetch).toHaveBeenCalledTimes(1)
    expect(h.result.current.url).toBe('blob:terminal')
    h.unmount()
  })
})
