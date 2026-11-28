// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ownsLocalNode, pickShareableHint, resolveNodeAddress, _resetNodeAddress } from './serverAddress'

const api = vi.hoisted(() => ({ base: '', orbitFetch: vi.fn() }))
vi.mock('./api', () => ({
  getApiBaseUrl: () => api.base,
  isLoopbackApiUrl: (u: string | null | undefined) => {
    if (!u) return false
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(u.trim())
  },
  orbitFetch: (...a: unknown[]) => api.orbitFetch(...a),
}))

beforeEach(() => {
  api.base = ''
  api.orbitFetch.mockReset()
  api.orbitFetch.mockResolvedValue({ ok: true, json: async () => ({ lanUrls: [] }) })
  _resetNodeAddress()
  document.cookie = 'gmatch_server_url=; path=/; max-age=0'
})

describe('pickShareableHint', () => {
  it('prefers a private LAN address over anything else', () => {
    expect(pickShareableHint(['http://203.0.113.9:8790', 'http://192.168.5.2:8790'])).toBe('http://192.168.5.2:8790')
    expect(pickShareableHint(['http://8.8.8.8:8790', 'http://10.1.2.3:8790'])).toBe('http://10.1.2.3:8790')
    expect(pickShareableHint(['http://8.8.8.8:8790', 'http://172.16.4.4:8790'])).toBe('http://172.16.4.4:8790')
  })

  it('ranks 172.16/12 below the home LANs (it is usually a virtual adapter)', () => {
    expect(pickShareableHint(['http://172.28.48.1:8790', 'http://192.168.5.2:8790'])).toBe('http://192.168.5.2:8790')
    expect(pickShareableHint(['http://172.28.48.1:8790', 'http://10.0.0.4:8790'])).toBe('http://10.0.0.4:8790')
  })

  it('keeps the scheme and the port, and accepts a scheme-less address', () => {
    expect(pickShareableHint(['192.168.0.9:8790'])).toBe('http://192.168.0.9:8790')
    expect(pickShareableHint(['https://node.example:8443'])).toBe('https://node.example:8443')
    expect(pickShareableHint(['http://192.168.0.9:8790/'])).toBe('http://192.168.0.9:8790')
  })

  it('never publishes an address only this machine (or nobody) can dial', () => {
    expect(pickShareableHint(['http://127.0.0.1:8790', 'http://localhost:8790'])).toBe('')
    expect(pickShareableHint(['http://169.254.10.10:8790'])).toBe('')
    expect(pickShareableHint([])).toBe('')
    expect(pickShareableHint(null)).toBe('')
    expect(pickShareableHint(['not a url at all'])).toBe('')
    expect(pickShareableHint(['ftp://192.168.0.9:8790'])).toBe('')
  })
})

describe('ownsLocalNode', () => {
  it('is true for the local sidecar and for this machine own LAN address', () => {
    api.base = 'http://127.0.0.1:8790'
    expect(ownsLocalNode()).toBe(true)
    api.base = 'http://192.168.5.2:8790'
    expect(ownsLocalNode(['http://192.168.5.2:8790'])).toBe(true)
    expect(ownsLocalNode(['http://10.0.0.9:8790'])).toBe(false)
  })

  it('is false when the browser is pointed at another machine node', () => {
    api.base = 'http://192.168.1.50:8790'
    expect(ownsLocalNode(['http://192.168.5.2:8790'])).toBe(false)
  })

  it('follows the dev-proxy cookie when the base is relative', () => {
    api.base = ''
    document.cookie = 'gmatch_server_url=http%3A%2F%2F192.168.1.50%3A8790; path=/'
    expect(ownsLocalNode(['http://192.168.5.2:8790'])).toBe(false)
    document.cookie = 'gmatch_server_url=http%3A%2F%2F127.0.0.1%3A8790; path=/'
    expect(ownsLocalNode()).toBe(true)
  })

  it('assumes the local dev node when nothing points anywhere', () => {
    api.base = ''
    expect(ownsLocalNode()).toBe(true)
  })
})

describe('resolveNodeAddress', () => {
  it('an absolute, non-loopback base IS the node we are on', async () => {
    api.base = 'http://192.168.1.50:8790'
    expect(await resolveNodeAddress(null)).toBe('http://192.168.1.50:8790')
    // no round trip needed: the base already says it
    expect(api.orbitFetch).not.toHaveBeenCalled()
  })

  it('a loopback base asks the node for the address it answers on', async () => {
    api.base = 'http://127.0.0.1:8790'
    api.orbitFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ lanUrls: ['http://172.28.48.1:8790', 'http://192.168.5.2:8790'] }),
    })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://192.168.5.2:8790')
    expect(api.orbitFetch).toHaveBeenCalledWith('/api/servers/node', { method: 'GET' }, null, expect.anything())
  })

  it('a relative base (browser dev) asks the node too', async () => {
    api.base = ''
    api.orbitFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ lanUrls: ['http://192.168.5.2:8790'] }),
    })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://192.168.5.2:8790')
  })

  it('caches the answer: one round trip for many callers', async () => {
    api.base = 'http://127.0.0.1:8790'
    api.orbitFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ lanUrls: ['http://192.168.5.2:8790'] }),
    })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://192.168.5.2:8790')
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://192.168.5.2:8790')
    expect(api.orbitFetch).toHaveBeenCalledTimes(1)
  })

  it('never invents an address the node did not report', async () => {
    api.base = 'http://127.0.0.1:8790'
    api.orbitFetch.mockResolvedValue({ ok: true, json: async () => ({ lanUrls: [] }) })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBeNull()

    api.orbitFetch.mockRejectedValue(new Error('offline'))
    _resetNodeAddress()
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBeNull()
  })

  it('prefers the detected Radmin adapter in the beacon, with the node real port', async () => {
    api.base = 'http://127.0.0.1:8790'
    api.orbitFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ lanUrls: ['http://192.168.5.2:8790', 'http://26.0.0.7:8790'] }),
    })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => '26.0.0.7')).toBe('http://26.0.0.7:8790')
  })

  it('falls back to LAN, then to a loopback the node actually reported', async () => {
    api.base = 'http://127.0.0.1:8790'
    api.orbitFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ lanUrls: ['http://127.0.0.1:8790', 'http://192.168.5.2:8790'] }),
    })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://192.168.5.2:8790')

    _resetNodeAddress()
    api.orbitFetch.mockResolvedValue({ ok: true, json: async () => ({ lanUrls: ['http://127.0.0.1:8790'] }) })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => null)).toBe('http://127.0.0.1:8790')
  })

  it('a Radmin IP without a known port is never turned into an invented address', async () => {
    api.base = ''
    api.orbitFetch.mockResolvedValue({ ok: true, json: async () => ({ lanUrls: [] }) })
    expect(await resolveNodeAddress(null, globalThis.fetch, async () => '26.0.0.7')).toBeNull()
  })
})
