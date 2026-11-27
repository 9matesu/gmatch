// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearNonLoopbackServerCookie, clearUnreachableApiBase, isCourierApiUrl, LOCAL_NODE_BASE, purgeCourierApiState, resolveLiveApiBase } from './api'

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
 * The retired Pages origin was a blind directory/mail relay and can never be a
 * data base. An ordinary node (local or a friend's) is joinable.
 */
describe('api base without a hosted fallback', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.cookie = 'gmatch_server_url=; path=/; max-age=0'
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

  it('expires a stale non-loopback proxy cookie in host mode, keeps a loopback one', () => {
    document.cookie = `gmatch_server_url=${encodeURIComponent('https://friend-world.test:8790')}; path=/`
    expect(clearNonLoopbackServerCookie()).toBe(true)
    expect(document.cookie).not.toContain('gmatch_server_url=')

    document.cookie = `gmatch_server_url=${encodeURIComponent('http://127.0.0.1:8790')}; path=/`
    expect(clearNonLoopbackServerCookie()).toBe(false)
    expect(document.cookie).toContain('gmatch_server_url=')
  })

  it('drops a stored node that does not answer instead of trusting the hostname', async () => {
    localStorage.setItem('gmatch.api.url', 'https://dead.example.test')
    localStorage.setItem('gmatch.onboarding.serverUrl', 'https://dead.example.test')
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await clearUnreachableApiBase(50)).toBe('https://dead.example.test')
    // Bounded retries, not one shot: a single aborted/timed-out boot probe
    // must not erase the user's chosen node.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dead.example.test/api/health',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
    expect(localStorage.getItem('gmatch.onboarding.serverUrl')).toBeNull()
  })

  it('keeps the pointer when the host answers but is waking (502/503/504)', async () => {
    // A hosted node behind a sleeping dyno answers 503 while it boots: the
    // pointer is legitimate and wiping it silently rewires the app to another
    // world. An answered transient 5xx is evidence the host exists.
    localStorage.setItem('gmatch.api.url', 'https://waking.example.test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)

    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://waking.example.test')

    fetchMock.mockResolvedValue({ ok: false, status: 502 })
    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://waking.example.test')

    fetchMock.mockResolvedValue({ ok: false, status: 504 })
    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://waking.example.test')
  })

  it('retries a failed probe and keeps the pointer when a later attempt answers', async () => {
    // The boot probe races the page load: a reload mid-probe aborts the fetch
    // and must not count as "the node is dead".
    localStorage.setItem('gmatch.api.url', 'https://peer-node.example.test')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    expect(await clearUnreachableApiBase(50)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://peer-node.example.test')
  })

  it('drops the pointer when the host answers but is not a node (404)', async () => {
    localStorage.setItem('gmatch.api.url', 'https://notanode.example.test')
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    expect(await clearUnreachableApiBase(50)).toBe('https://notanode.example.test')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
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
