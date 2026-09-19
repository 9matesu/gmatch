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

  it('GET /api/objects/:id serves P2P descriptor without purging for magnet/urn objects', async () => {
    const id = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(id.orbitId, id.publicKeyHex, 'Test User').run()

    // Register P2P object
    const regPath = '/api/objects/register'
    const bodyStr = JSON.stringify({
      id: 'p2p-registered-1',
      content_hash: 'b'.repeat(64),
      size_bytes: 1024 * 1024,
      mime_type: 'image/jpeg',
      magnet_uri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      is_public: 1,
    })
    const regHeaders = signRequestHeaders(id, 'POST', regPath, bodyStr)
    regHeaders['Content-Type'] = 'application/json'
    const regRes = await app.request(regPath, { method: 'POST', headers: regHeaders, body: bodyStr }, env)
    expect(regRes.status).toBe(200)

    // GET the object
    const getPath = '/api/objects/p2p-registered-1'
    const getHeaders = signRequestHeaders(id, 'GET', getPath)
    const getRes = await app.request(getPath, { method: 'GET', headers: getHeaders }, env)
    expect(getRes.status).toBe(200)
    const data = await getRes.json()
    expect(data.type).toBe('p2p')
    expect(data.id).toBe('p2p-registered-1')
    expect(data.content_url).toContain('magnet:?xt=urn:btih:')

    // Ensure it was not purged from DB
    const row = await env.DB.prepare('SELECT id FROM Objects WHERE id = ?').bind('p2p-registered-1').first()
    expect(row).toBeDefined()
    expect(row?.id).toBe('p2p-registered-1')
  })
})
