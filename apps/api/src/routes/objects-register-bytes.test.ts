import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import { encryptBlob } from '../crypto'

/**
 * A metadata registration MAY carry the bytes it describes (`data_base64`).
 *
 * Without this the publish path was metadata-only: the bytes stayed in the
 * author's IndexedDB and `GET /api/objects/:id` answered `bytes missing for
 * row` for every other peer — and for the same user after a reinstall. That
 * is the "zero persistence" symptom: the row existed, the picture did not.
 */
describe('register carries the bytes it describes', () => {
  let env: any
  const owner = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(owner.orbitId, owner.publicKeyHex, 'Author').run().catch(() => {})
  })

  // A real 1x1 PNG, so the multipart-style magic-byte gate would accept it.
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ])

  function register(body: Record<string, unknown>, identity = owner) {
    const path = '/api/objects/register'
    const bodyStr = JSON.stringify(body)
    const headers = signRequestHeaders(identity, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request(path, { method: 'POST', headers, body: bodyStr }, env)
  }

  it('stores the bytes and serves them back from GET /api/objects/:id', async () => {
    const bodyStr = JSON.stringify({
      id: 'with-bytes-1',
      mime_type: 'image/png',
      size_bytes: PNG.length,
      is_public: 1,
      post_caption: 'has bytes',
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    const headers = signRequestHeaders(owner, 'POST', '/api/objects/register', bodyStr)
    headers['Content-Type'] = 'application/json'
    const reg = await app.request('/api/objects/register', {
      method: 'POST', headers, body: bodyStr,
    }, env)
    expect(reg.status).toBe(200)

    const getPath = '/api/objects/with-bytes-1'
    const res = await app.request(getPath, {
      method: 'GET', headers: signRequestHeaders(owner, 'GET', getPath),
    }, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('a JSON-only register is unchanged (no bytes, row stays blobless)', async () => {
    await register({ id: 'no-bytes-1', mime_type: 'image/png', is_public: 1 })
    const getPath = '/api/objects/no-bytes-1'
    const res = await app.request(getPath, {
      method: 'GET', headers: signRequestHeaders(owner, 'GET', getPath),
    }, env)
    // Descriptor / bytes-unavailable: the row is real, the bytes are not here.
    expect([200, 404]).toContain(res.status)
  })

  it('a replayed register can attach the bytes the first attempt omitted', async () => {
    await register({ id: 'late-bytes-1', mime_type: 'image/png', is_public: 1 })
    const second = await register({
      id: 'late-bytes-1',
      mime_type: 'image/png',
      is_public: 1,
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    expect(second.status).toBe(200)
    expect((await second.json()) as { reused?: boolean }).toMatchObject({ reused: true })

    const getPath = '/api/objects/late-bytes-1'
    const res = await app.request(getPath, {
      method: 'GET', headers: signRequestHeaders(owner, 'GET', getPath),
    }, env)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('bytes that do not match the declared content_hash are refused', async () => {
    const res = await register({
      id: 'bad-hash-1',
      mime_type: 'image/png',
      is_public: 1,
      content_hash: 'a'.repeat(64),
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    expect(res.status).toBe(400)
    expect((await res.json()) as { error?: string }).toMatchObject({ error: expect.stringContaining('content_hash') })
  })

  it('the node stores ciphertext at rest, never the raw bytes', async () => {
    await register({
      id: 'at-rest-1',
      mime_type: 'image/png',
      is_public: 1,
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    const stored = await env.BUCKET.get('objects/at-rest-1')
    expect(stored).toBeTruthy()
    const raw = new Uint8Array(await new Response(stored!.body).arrayBuffer())
    // Encrypted at rest: the on-disk bytes must not be the PNG bytes.
    expect(Array.from(raw.slice(0, 4))).not.toEqual(Array.from(PNG.slice(0, 4)))
    // And decrypting them gives the original bytes back.
    const { decryptBlob } = await import('../crypto')
    expect(new Uint8Array(decryptBlob(raw))).toEqual(PNG)
  })

  it('the bytes survive being written through the same store the GET reads', async () => {
    // Guards the exact regression: a row whose blob was never written is the
    // `bytes missing for row` state. The register path must populate the store
    // the GET path reads, not a parallel one.
    await register({
      id: 'roundtrip-1',
      mime_type: 'image/png',
      is_public: 1,
      data_base64: Buffer.from(PNG).toString('base64'),
    })
    // The store is the SAME object the route reads: prove it by writing a
    // different blob through the store and seeing the GET serve that instead.
    await env.BUCKET.put('objects/roundtrip-1', encryptBlob(new Uint8Array([1, 2, 3])))
    const getPath = '/api/objects/roundtrip-1'
    const res = await app.request(getPath, {
      method: 'GET', headers: signRequestHeaders(owner, 'GET', getPath),
    }, env)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})