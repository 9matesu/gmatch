// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isCourierApiUrl, isRetiredApiUrl, LOCAL_NODE_BASE, purgeCourierApiState, resolveLiveApiBase } from './api'

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

  it('boot migration purges stored pointers to retired hosts (Render, Fly)', () => {
    expect(isRetiredApiUrl('https://gmatch.fly.dev')).toBe(true)
    expect(isRetiredApiUrl('https://gmatch-wcz1.onrender.com')).toBe(true)
    expect(isRetiredApiUrl('https://node.example.test')).toBe(false)
    localStorage.setItem('gmatch.api.url', 'https://gmatch.fly.dev')
    localStorage.setItem('gmatch.onboarding.serverUrl', 'https://gmatch.fly.dev')
    expect(purgeCourierApiState()).toBe(true)
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
    expect(localStorage.getItem('gmatch.onboarding.serverUrl')).toBeNull()
  })
})
