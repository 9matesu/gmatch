// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ownsLocalNode, pickShareableHint } from './serverAddress'

const api = vi.hoisted(() => ({ base: '' }))
vi.mock('./api', () => ({
  getApiBaseUrl: () => api.base,
  isLoopbackApiUrl: (u: string | null | undefined) => {
    if (!u) return false
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(u.trim())
  },
}))

beforeEach(() => {
  api.base = ''
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
