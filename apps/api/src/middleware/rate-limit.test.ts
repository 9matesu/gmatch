import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { rateLimit, __storeKeysForTest } from './rate-limit'

// Wave 2 (B1): the rate limiter must never retain a raw client IP — not even
// as an in-memory bucket key.
describe('rate-limit IP hashing', () => {
  it('anon buckets key on a hash, never the dotted-quad', async () => {
    const app = new Hono<{ Bindings: Record<string, never> }>()
    app.use(rateLimit)
    app.get('/ping', (c) => c.text('pong'))

    const r1 = await app.request('/ping', { headers: { 'x-forwarded-for': '203.0.113.77' } })
    const r2 = await app.request('/ping', { headers: { 'x-forwarded-for': '198.51.100.99' } })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    const keys = __storeKeysForTest().join('|')
    expect(keys).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
    expect(keys).toContain('ip:')
  })
})
