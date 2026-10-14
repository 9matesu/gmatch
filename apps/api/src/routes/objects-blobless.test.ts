import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// Regression for the read-triggered data destruction: GET /api/objects/:id on
// a row whose bytes are missing must answer 404 WITHOUT deleting the row.
// Blobless rows are legitimate (gossip replicas, offline posts, pending
// uploads); the first viewer used to purge them, turning one transient 404
// into permanent loss (proven live: purged:true on 1st GET, plain 404 after).
describe('Objects blobless rows survive reads', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
  })

  async function registerPublicBlobless(owner: any) {
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(owner.orbitId, owner.publicKeyHex, 'Owner').run().catch(() => {})
    const bodyStr = JSON.stringify({ id: 'blobless-1', mime_type: 'image/jpeg', is_public: 1 })
    const headers = signRequestHeaders(owner, 'POST', '/api/objects/register', bodyStr)
    headers['Content-Type'] = 'application/json'
    const res = await app.request('/api/objects/register', { method: 'POST', headers, body: bodyStr }, env)
    expect(res.status).toBe(200)
  }

  async function rowExists(id: string) {
    return await env.DB.prepare('SELECT id FROM Objects WHERE id = ?').bind(id).first()
  }

  it('owner GET on a blobless row 404s with bytes-unavailable and keeps the row', async () => {
    const owner = createTestIdentity()
    await registerPublicBlobless(owner)
    const path = '/api/objects/blobless-1'

    const first = await app.request(path, { method: 'GET', headers: signRequestHeaders(owner, 'GET', path) }, env)
    expect(first.status).toBe(404)
    expect((await first.json()).error).toBe('Object bytes unavailable')

    expect(await rowExists('blobless-1')).toBeTruthy()

    const second = await app.request(path, { method: 'GET', headers: signRequestHeaders(owner, 'GET', path) }, env)
    expect(second.status).toBe(404)
    expect((await second.json()).error).toBe('Object bytes unavailable')
    expect(await rowExists('blobless-1')).toBeTruthy()
  })

  it('stranger GET on a blobless row 404s without deleting it', async () => {
    const owner = createTestIdentity()
    const stranger = createTestIdentity()
    await registerPublicBlobless(owner)
    const path = '/api/objects/blobless-1'
    const res = await app.request(path, { method: 'GET', headers: signRequestHeaders(stranger, 'GET', path) }, env)
    expect(res.status).toBe(404)
    expect(await rowExists('blobless-1')).toBeTruthy()
  })

  it('missing row still 404s as Object not found (unchanged)', async () => {
    const owner = createTestIdentity()
    const path = '/api/objects/ce0fd015-62d2-4106-8cb1-9568dd1886d9'
    const res = await app.request(path, { method: 'GET' }, env)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Object not found')
  })

  it('control: bucket-backed bytes still serve 200 for the owner', async () => {
    const owner = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(owner.orbitId, owner.publicKeyHex, 'Owner').run().catch(() => {})
    // Minimal JPEG (magic FF D8), encrypted so bytes land in the bucket store.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0x41)])
    const form = new FormData()
    form.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'tiny.jpg')
    form.append('encrypted', 'true')
    form.append('is_public', '0')
    const upHeaders = signRequestHeaders(owner, 'POST', '/api/objects')
    const up = await app.request('/api/objects', { method: 'POST', headers: upHeaders, body: form }, env)
    expect(up.status).toBe(201)
    const { id } = await up.json()

    const getPath = `/api/objects/${id}?raw=true`
    // NOTE: only the pathname is signed (server verifies pathname, not query).
    const res = await app.request(getPath, { method: 'GET', headers: signRequestHeaders(owner, 'GET', `/api/objects/${id}`) }, env)
    expect(res.status).toBe(200)
    expect(await rowExists(id)).toBeTruthy()
  })
})
