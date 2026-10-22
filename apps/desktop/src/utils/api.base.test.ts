// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isCourierApiUrl, LOCAL_NODE_BASE, resolveLiveApiBase } from './api'

/**
 * The central deployments are decommissioned (2026-10-21): the accounts
 * cannot be paid for any more. Nothing may resolve to them any more, and a
 * stored URL pointing at one is dropped rather than dialed.
 */
describe('api base without a hosted fallback', () => {
  it('treats a decommissioned deployment as never-a-data-base', () => {
    expect(isCourierApiUrl('https://gmatch-wcz1.onrender.com')).toBe(true)
    expect(isCourierApiUrl('https://gmatch.fly.dev')).toBe(true)
    expect(isCourierApiUrl('http://192.168.1.10:8790')).toBe(false)
    expect(isCourierApiUrl('http://127.0.0.1:8790')).toBe(false)
    expect(isCourierApiUrl(null)).toBe(false)
  })

  it('falls back to the node on this machine, never to a hosted host', () => {
    expect(LOCAL_NODE_BASE).toBe('http://127.0.0.1:8790')
    expect(resolveLiveApiBase()).not.toMatch(/onrender\.com|fly\.dev/)
  })
})
