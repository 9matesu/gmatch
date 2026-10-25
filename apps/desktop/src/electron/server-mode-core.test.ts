import { describe, expect, it, vi } from 'vitest'
import {
  CONFIG_VERSION,
  isLegacyClientConfig,
  isLoopbackUrl,
  isServerUrl,
  isDecommissionedUrl,
  normalizeServerUrl,
  pauseReasonOf,
  probeHealth,
  resolveServerUrl,
} from '../../electron/server-mode-core.cjs'
import {
  isServerUrl as isServerUrlTs,
  isDecommissionedUrl as isDecommissionedUrlTs,
  normalizeServerUrl as normalizeServerUrlTs,
} from '../utils/serverUrl'

describe('server-mode-core (no central server, P-R3)', () => {
  it('accepts http(s) host[:port] urls only', () => {
    expect(isServerUrl('http://192.168.0.42:8790')).toBe(true)
    expect(isServerUrl('https://grid.example.com')).toBe(true)
    expect(isServerUrl('file:///c:/x')).toBe(false)
    expect(isServerUrl('javascript:alert(1)')).toBe(false)
    expect(isServerUrl('')).toBe(false)
    expect(normalizeServerUrl('http://a.b:8790///')).toBe('http://a.b:8790')
  })

  it('resolveServerUrl: env > stored client > host default', () => {
    expect(
      resolveServerUrl({ envUrl: 'http://env:1', stored: { mode: 'client', url: 'http://st:2' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://env:1' })
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'http://st:2' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://st:2' })
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'garbage' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'host', url: 'http://127.0.0.1:8790' })
    expect(resolveServerUrl({ hostUrl: 'http://127.0.0.1:8790' })).toEqual({ mode: 'host', url: 'http://127.0.0.1:8790' })
  })

  it('a stored courier pointer becomes the local node; a friends node stays a destination', () => {
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'https://gmatch.pages.dev' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'host', url: 'http://127.0.0.1:8790' })
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'http://friend:8790' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://friend:8790' })
    // A friend's node is still a destination.
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'http://friend:8790' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://friend:8790' })
  })

  it('renderer TS mirror behaves identically (drift guard)', () => {
    expect(isDecommissionedUrlTs('https://gmatch.pages.dev')).toBe(true)
    expect(isDecommissionedUrlTs('https://x.gmatch.pages.dev')).toBe(true)
    expect(isDecommissionedUrlTs('http://friend:8790')).toBe(false)
    expect(isDecommissionedUrl('https://gmatch.pages.dev')).toBe(true)
    expect(isDecommissionedUrl('http://friend:8790')).toBe(false)
    expect(isServerUrlTs('http://192.168.0.42:8790')).toBe(true)
    expect(isServerUrlTs('javascript:alert(1)')).toBe(false)
    expect(normalizeServerUrlTs('http://a.b:8790///')).toBe('http://a.b:8790')
    expect(normalizeServerUrlTs('nope')).toBe(null)
  })
})

/**
 * Provenance, not reachability, decides what a legacy pointer means. Evidence
 * from the field: the old hosted deployment still answered /api/health, so a
 * health check alone left the app in a world that was not the user's — and the
 * user's own posts (local sqlite) stayed invisible. An unstamped/v1 pointer is
 * therefore kept paused, never dialed.
 */
describe('stored client pointer provenance', () => {
  it('only unstamped or older client pointers are treated as legacy', () => {
    expect(isLegacyClientConfig({ mode: 'client', url: 'http://friend:8790' })).toBe(true)
    expect(isLegacyClientConfig({ mode: 'client', url: 'http://friend:8790', v: 1 })).toBe(true)
    // Written by this app (v2) or already paused: not legacy.
    expect(isLegacyClientConfig({ mode: 'client', url: 'http://friend:8790', v: CONFIG_VERSION })).toBe(false)
    expect(isLegacyClientConfig({ mode: 'client', url: 'http://friend:8790', v: 2, paused: true })).toBe(false)
    // Host mode is never a pointer.
    expect(isLegacyClientConfig({ mode: 'host', url: '' })).toBe(false)
    expect(isLegacyClientConfig(null)).toBe(false)
    expect(isLegacyClientConfig({ mode: 'client' })).toBe(true)
  })

  it('pause reasons are explicit and old rows default to legacy', () => {
    expect(pauseReasonOf({ paused: true, pausedReason: 'unreachable' })).toBe('unreachable')
    expect(pauseReasonOf({ paused: true, pausedReason: 'legacy' })).toBe('legacy')
    expect(pauseReasonOf({ paused: true })).toBe('legacy')
    expect(pauseReasonOf(null)).toBe('legacy')
  })

  it('probeHealth asks the one unauthenticated route and accepts a real node answer', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', mode: 'legacy' }),
    })
    await expect(probeHealth('http://friend:8790/', { fetchImpl: okFetch })).resolves.toBe(true)
    expect(okFetch).toHaveBeenCalledWith(
      'http://friend:8790/api/health',
      expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/json' }) }),
    )

    const legacyOk = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await expect(probeHealth('http://friend:8790', { fetchImpl: legacyOk })).resolves.toBe(true)
  })

  it('probeHealth refuses silence, errors and non-urls', async () => {
    const err = vi.fn().mockRejectedValue(new Error('EHOSTUNREACH'))
    await expect(probeHealth('http://dead:8790', { fetchImpl: err })).resolves.toBe(false)

    const http500 = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(probeHealth('http://dead:8790', { fetchImpl: http500 })).resolves.toBe(false)

    const notANode = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hello: 'world' }) })
    await expect(probeHealth('http://dead:8790', { fetchImpl: notANode })).resolves.toBe(false)

    const garbage = vi.fn()
    await expect(probeHealth('not a url', { fetchImpl: garbage })).resolves.toBe(false)
    expect(garbage).not.toHaveBeenCalled()
  })

  it('loopback is recognised so a local sidecar override is never mistaken for a friend', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8790')).toBe(true)
    expect(isLoopbackUrl('http://localhost:8790')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8790')).toBe(true)
    expect(isLoopbackUrl('http://192.168.0.42:8790')).toBe(false)
    expect(isLoopbackUrl('nope')).toBe(false)
  })
})
