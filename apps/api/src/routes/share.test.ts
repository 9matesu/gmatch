import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity } from '../test-utils'

// Public share pages (P3.5): the only honest "Copy Link" targets — a URL an
// outside browser can actually open. Unauthenticated by design.
describe('GET /p/:id and /u/:id share pages', () => {
  let env: any
  let alice: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)',
    ).bind(alice.orbitId, alice.publicKeyHex, 'Alice').run()
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_public, post_caption, content_url) VALUES ('obj-1', ?, 100, 'image/png', 1, 'nice <b>view</b>', 'https://cdn.test/x.png')",
    ).bind(alice.orbitId).run()
  })

  it('serves an HTML page for a public post, escaping user content', async () => {
    const res = await app.fetch(new Request('http://localhost/p/obj-1'), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('https://cdn.test/x.png')
    expect(html).toContain('Alice')
    // caption HTML-escaped, never injected raw
    expect(html).toContain('&lt;b&gt;view&lt;/b&gt;')
    expect(html).not.toContain('nice <b>view</b>')
    expect(html).toContain('og:title')
  })

  it('404s missing posts', async () => {
    const res = await app.fetch(new Request('http://localhost/p/nope'), env)
    expect(res.status).toBe(404)
  })

  it('serves an HTML page for a profile', async () => {
    const res = await app.fetch(new Request(`http://localhost/u/${alice.orbitId}`), env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Alice')
  })

  it('no auth headers required (public)', async () => {
    const res = await app.fetch(new Request('http://localhost/p/obj-1'), env)
    expect(res.status).toBe(200)
  })
})
