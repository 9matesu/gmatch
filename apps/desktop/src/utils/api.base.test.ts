// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isCourierApiUrl, LOCAL_NODE_BASE, resolveLiveApiBase } from './api'

/**
 * The Render deployment is a blind courier (directory/mail/TURN only) and can
 * never be a data base. Fly is a full public node: joinable, not a courier.
 */
describe('api base without a hosted fallback', () => {
  it('treats the courier as never-a-data-base but keeps the public node joinable', () => {
    expect(isCourierApiUrl('https://gmatch-wcz1.onrender.com')).toBe(true)
    expect(isCourierApiUrl('https://gmatch.fly.dev')).toBe(false)
    expect(isCourierApiUrl('http://192.168.1.10:8790')).toBe(false)
    expect(isCourierApiUrl('http://127.0.0.1:8790')).toBe(false)
    expect(isCourierApiUrl(null)).toBe(false)
  })

  it('falls back to the node on this machine, never to a hosted host', () => {
    expect(LOCAL_NODE_BASE).toBe('http://127.0.0.1:8790')
    expect(resolveLiveApiBase()).not.toMatch(/onrender\.com|fly\.dev/)
  })
})
