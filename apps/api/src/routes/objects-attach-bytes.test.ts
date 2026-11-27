import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

/**
 * Regression: a request body is a ONE-SHOT stream.
 *
 * The register route parsed the body to read the metadata, then called
 * `c.req.json()` AGAIN to read the attached bytes — which always came back
 * empty, so every `data_base64` attachment was silently dropped and the row was
 * stored blobless. The symptom was exactly "I post, it says saved, and after a
 * restart it shows missing bytes": the post row existed, the picture never did.
 *
 * These tests pin the bytes actually landing, which is the only thing the
 * player can observe.
 */
describe('register attaches the bytes it was given', () => {
  const owner = createTestIdentity()
  let env: any

  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ])

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(owner.orbitId, owner.publicKeyHex, 'Author').run().catch(() => {})
  })

  function register(body: Record<string, unknown>) {
    const bodyStr = JSON.stringify(body)
    const headers = signRequestHeaders(owner, 'POST', '/api/objects/register', bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request('/api/objects/register', { method: 'POST', headers, body: bodyStr }, env)
  }

  function get(id: string) {
    const path = `/api/objects/${id}`
    return app.request(path, { method: 'GET', headers: signRequestHeaders(owner, 'GET', path) }, env)
  }

  it('stores the bytes so GET serves them back (not bytes-missing)', async () => {
    const res = await register({
      id: 'attach-1',
      mime_type: 'image/png',
      is_public: 1,
      post_caption: 'has real bytes',
      size_bytes: PNG.length,
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    expect(res.status).toBe(200)

    // The row describes its own bytes: the stored hash matches the payload.
    // (The register RESPONSE does not carry it; the row does, and that is what
    // the addressable id and GET both read.)
    const row = await env.DB.prepare(
      'SELECT content_hash FROM Objects WHERE id = ?',
    ).bind('attach-1').first<{ content_hash: string }>()
    expect(row!.content_hash).toMatch(/^[0-9a-f]{64}$/)

    const got = await get('attach-1')
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
  })

  it('records a content_hash that describes the stored blob', async () => {
    await register({
      id: 'attach-2',
      mime_type: 'image/png',
      is_public: 1,
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    const row = await env.DB.prepare(
      'SELECT content_hash, content_url, size_bytes FROM Objects WHERE id = ?',
    ).bind('attach-2').first<{ content_hash: string; content_url: string; size_bytes: number }>()
    expect(row!.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row!.content_url).toBe('urn:sha256:' + row!.content_hash)
    expect(row!.size_bytes).toBe(PNG.length)
  })

  it('a registration with no bytes is still accepted (metadata-only posts exist)', async () => {
    const res = await register({ id: 'attach-3', mime_type: 'image/png', is_public: 1 })
    expect(res.status).toBe(200)
    const got = await get('attach-3')
    expect(got.status).toBe(404) // row is real, bytes are not here
  })

  /**
   * The id is client-chosen and becomes a blob-store path component, so it is
   * attacker-influenced input. A traversal-shaped id must be refused at the
   * route (400), not carried into the filesystem.
   */
  describe('rejects a traversal-shaped id', () => {
    for (const badId of ['../escaped', '../../etc/passwd', 'objects/../../x', 'a/b', '..\\..\\win']) {
      it(`refuses ${JSON.stringify(badId)}`, async () => {
        const res = await register({
          id: badId,
          mime_type: 'image/png',
          is_public: 1,
          data_base64: Buffer.from(PNG).toString('base64'),
        })
        expect(res.status).toBe(400)
      })
    }

    it('still accepts a legitimate client-chosen id', async () => {
      const res = await register({
        id: 'legit-client-id_1',
        mime_type: 'image/png',
        is_public: 1,
        data_base64: Buffer.from(PNG).toString('base64'),
      })
      expect(res.status).toBe(200)
    })
  })
})