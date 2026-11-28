import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { bodySizeLimit } from './body-size-limit'

const app = new Hono()
app.use('*', bodySizeLimit)
app.post('/upload', (c) => c.json({ ok: true }))

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('bodySizeLimit', () => {
  it('accepts a 1.2MB JSON body (a video post, previously 413)', async () => {
    const body = JSON.stringify({ blob: 'x'.repeat(1_258_291) }) // ~1.2MiB on the wire
    const res = await app.request('/upload', { method: 'POST', headers: JSON_HEADERS, body })
    expect(res.status).toBe(200)
  })

  it('still 413s a JSON body over 64MB and reports the real limit', async () => {
    // The middleware trusts Content-Length; a spoofed header keeps the test
    // from allocating 64MB just to prove the boundary.
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Content-Length': String(64 * 1024 * 1024 + 1) },
      body: '{}',
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Request body too large', limit: 64 * 1024 * 1024 })
  })

  it('keeps the separate 100MB multipart allowance', async () => {
    const ok = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(100 * 1024 * 1024) },
      body: '',
    })
    expect(ok.status).toBe(200)
    const tooBig = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(100 * 1024 * 1024 + 1) },
      body: '',
    })
    expect(tooBig.status).toBe(413)
  })
})
