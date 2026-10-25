// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isCourierApiUrl, LOCAL_NODE_BASE, resolveLiveApiBase } from './api'

/**
 * The Cloudflare courier is a blind directory/mail relay and can never be a
 * data base. An ordinary node (local or a friend's) is joinable.
 */
describe('api base without a hosted fallback', () => {
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
})
