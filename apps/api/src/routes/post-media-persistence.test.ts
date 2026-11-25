// Post-media persistence contract (2026-11-25).
//
// Proves the whole node-side chain a real post depends on, with no mocks:
//   POST /api/objects (multipart image) -> Objects row (content_hash, public,
//   caption) -> GET /api/objects/:id streams the SAME bytes back (sha256 ==
//   content_hash) -> GET /api/posts lists it in the timeline.
//
// The swarm/peer-routing half is proven by `apps/desktop/scripts/p2p-two-process.mjs`
// (two real OS processes + an untrusted relay); this file owns the node half.
import { describe, it, expect } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// A real 1x1 PNG (small enough for the node to store inline, < 128 KiB).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_B64, 'base64')

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('post media persistence (node half)', () => {
  it('stores, serves and lists a posted image with an exact content hash', async () => {
    const env = await createMockEnv()
    const id = createTestIdentity()

    // 1. publish a public image post (multipart, the real client path).
    const form = new FormData()
    form.append('image', new File([PNG], 'post.png', { type: 'image/png' }))
    form.append('is_public', '1')
    form.append('post_caption', 'hello from the test')
    form.append('post_group', 'pg_test_1')
    const up = await app.request(
      '/api/objects',
      { method: 'POST', body: form, headers: signRequestHeaders(id, 'POST', '/api/objects') },
      env,
    )
    expect([200, 201]).toContain(up.status)
    const { id: objId } = (await up.json()) as { id: string }
    expect(objId).toBeTruthy()

    // 2. the row is durable and honest: public, captioned, content-addressed.
    const row = await env.DB.prepare(
      'SELECT content_hash, is_public, post_caption, mime_type FROM Objects WHERE id = ?',
    )
      .bind(objId)
      .first<{ content_hash: string | null; is_public: number; post_caption: string | null; mime_type: string }>()
    expect(row).toBeTruthy()
    expect(row!.is_public).toBe(1)
    expect(row!.post_caption).toBe('hello from the test')
    expect(row!.content_hash).toMatch(/^[0-9a-f]{64}$/)

    // 3. the node streams the SAME bytes back, and they hash to content_hash.
    const get = await app.request(
      `/api/objects/${objId}`,
      { headers: signRequestHeaders(id, 'GET', `/api/objects/${objId}`) },
      env,
    )
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type') || '').toContain('image/png')
    const served = new Uint8Array(await get.arrayBuffer())
    expect(served.byteLength).toBe(PNG.byteLength)
    expect(await sha256Hex(served)).toBe(row!.content_hash)

    // 4. a second GET is still 200 (healthy / cacheable, not a one-shot).
    const get2 = await app.request(
      `/api/objects/${objId}`,
      { headers: signRequestHeaders(id, 'GET', `/api/objects/${objId}`) },
      env,
    )
    expect(get2.status).toBe(200)

    // 5. the post is in the timeline the client reads.
    const posts = await app.request(
      '/api/posts',
      { headers: signRequestHeaders(id, 'GET', '/api/posts') },
      env,
    )
    expect(posts.status).toBe(200)
    expect(JSON.stringify(await posts.json())).toContain(objId)
  })
})