// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearUnreachableApiBase, isCourierApiUrl, LOCAL_NODE_BASE, purgeCourierApiState, resolveLiveApiBase } from './api'

// jsdom in this repo does not expose localStorage; stub it like useCourierDms.test.tsx.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => (key in storage ? storage[key] : null),
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage

/**
 * The Cloudflare courier is a blind directory/mail relay and can never be a
 * data base. An ordinary node (local or a friend's) is joinable.
 */
describe('api base without a hosted fallback', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats the courier as never-a-data-base but keeps the public node joinable', () => {
    expect(isCourierApiUrl('https://gmatch.pages.dev')).toBe(true)
    expect(isCourierApiUrl('https://node.example.test')).toBe(false)
    expect(isCourierApiUrl('http://192.168.1.10:8790')).toBe(false)
    expect(isCourierApiUrl('http://127.0.0.1:8790')).toBe(false)
    expect(isCourierApiUrl(null)).toBe(false)
  })

  it('falls back to the node on this machine, never to a hosted host', () => {
    expect(LOCAL_NODE_BASE).toBe('http://127.0.0.1:8790')
    expect(resolveLiveApiBase()).not.toMatch(/pages\.dev/)
  })

  it('boot migration purges stored pointers to the courier', () => {
    localStorage.setItem('gmatch.api.url', 'https://gmatch.pages.dev')
    localStorage.setItem('gmatch.onboarding.serverUrl', 'https://gmatch.pages.dev')
    expect(purgeCourierApiState()).toBe(true)
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
    expect(localStorage.getItem('gmatch.onboarding.serverUrl')).toBeNull()
  })

  it('drops a stored node that does not answer instead of trusting the hostname', async () => {
    localStorage.setItem('gmatch.api.url', 'https://dead.example.test')
    localStorage.setItem('gmatch.onboarding.serverUrl', 'https://dead.example.test')
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await clearUnreachableApiBase(50)).toBe('https://dead.example.test')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dead.example.test/api/health',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
    expect(localStorage.getItem('gmatch.onboarding.serverUrl')).toBeNull()
  })

  it('keeps a stored node that answers, and never probes the courier or loopback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    localStorage.setItem('gmatch.api.url', 'https://alive.example.test')
    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://alive.example.test')

    fetchMock.mockClear()
    localStorage.setItem('gmatch.api.url', 'https://gmatch.pages.dev')
    expect(await clearUnreachableApiBase(50)).toBeNull()
    localStorage.setItem('gmatch.api.url', 'http://127.0.0.1:8790')
    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
