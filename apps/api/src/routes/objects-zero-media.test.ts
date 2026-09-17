import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

describe('Objects zero-media policy (Plan P-Zero)', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
  })

  it('accepts metadata-only registration with content_hash and magnet_uri', async () => {
    const id = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(id.orbitId, id.publicKeyHex, 'Test User').run()

    const path = '/api/objects/register'
    const bodyStr = JSON.stringify({
      id: 'test-obj-123',
      content_hash: 'a'.repeat(64),
      size_bytes: 52428800,
      mime_type: 'video/mp4',
      magnet_uri: 'magnet:?xt=urn:btih:abcdef123456',
      caption: 'Test Card',
      is_public: 1,
    })
    const headers = signRequestHeaders(id, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'

    const res = await app.request(path, {
      method: 'POST',
      headers,
      body: bodyStr,
    }, env)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe('test-obj-123')
    expect(data.magnet_uri).toBe('magnet:?xt=urn:btih:abcdef123456')
  })

  it('rejects raw binary uploads exceeding 128KB with 422 policy error', async () => {
    const id = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(id.orbitId, id.publicKeyHex, 'Test User').run()

    const path = '/api/objects'
    const headers = signRequestHeaders(id, 'POST', path)

    const bigBlob = new Uint8Array(256 * 1024)
    const form = new FormData()
    form.append('image', new Blob([bigBlob], { type: 'image/jpeg' }), 'big.jpg')

    const res = await app.request(path, {
      method: 'POST',
      headers,
      body: form,
    }, env)
    expect(res.status).toBe(422)
    const err = await res.json()
    expect(err.error).toContain('Central server does not store media files')
  })
})
