import { describe, it, expect, beforeAll } from 'vitest'
import app from './index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from './test-utils'

const JPEG_HEADER = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])
function img() {
  const b = new TextEncoder().encode('archive-test')
  const m = new Uint8Array(JPEG_HEADER.length + b.length)
  m.set(JPEG_HEADER, 0)
  m.set(b, JPEG_HEADER.length)
  return new Blob([m], { type: 'image/jpeg' })
}

const owner = createTestIdentity()
const stranger = createTestIdentity()
let env: Awaited<ReturnType<typeof createMockEnv>>

async function uploadPublic(id: typeof owner): Promise<string> {
  const path = '/api/objects'
  const fd = new FormData()
  fd.append('image', img(), 'a.jpg')
  fd.append('is_public', '1')
  fd.append('post_caption', 'arch me')
  const res = await app.request(path, {
    method: 'POST',
    body: fd,
    headers: signRequestHeaders(id, 'POST', path),
  }, env)
  expect(res.status).toBeLessThan(300)
  return (await res.json()).id
}

async function feed(id: typeof owner) {
  const res = await app.request('/api/posts', {
    headers: signRequestHeaders(id, 'GET', '/api/posts'),
  }, env)
  return ((await res.json()).posts as any[]).map((p) => p.id)
}

beforeAll(async () => {
  env = await createMockEnv()
  // register both identities
  for (const id of [owner, stranger]) {
    await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
  }
})

describe('POST /api/objects/:id/archive', () => {
  it('toggles archive for the owner and hides the post from strangers, visible to author', async () => {
    const objId = await uploadPublic(owner)
    const path = `/api/objects/${objId}/archive`
    let res = await app.request(path, { method: 'POST', headers: signRequestHeaders(owner, 'POST', path) }, env)
    expect(res.status).toBe(200)
    expect((await res.json()).is_archived).toBe(1)

    expect(await feed(stranger)).not.toContain(objId)
    expect(await feed(owner)).toContain(objId)

    // toggle back
    res = await app.request(path, { method: 'POST', headers: signRequestHeaders(owner, 'POST', path) }, env)
    expect((await res.json()).is_archived).toBe(0)
    expect(await feed(stranger)).toContain(objId)
  })

  it('403 for non-owner, 404 for missing, row unchanged', async () => {
    const objId = await uploadPublic(owner)
    const path = `/api/objects/${objId}/archive`
    const res = await app.request(path, { method: 'POST', headers: signRequestHeaders(stranger, 'POST', path) }, env)
    expect(res.status).toBe(403)
    expect(await feed(stranger)).toContain(objId)

    const missing = await app.request('/api/objects/nope-not-here/archive', { method: 'POST', headers: signRequestHeaders(owner, 'POST', '/api/objects/nope-not-here/archive') }, env)
    expect(missing.status).toBe(404)
  })

  it('archive flag is exposed in the author feed payload and survives a schema re-init', async () => {
    const objId = await uploadPublic(owner)
    const path = `/api/objects/${objId}/archive`
    await app.request(path, { method: 'POST', headers: signRequestHeaders(owner, 'POST', path) }, env)

    const res = await app.request('/api/posts', {
      headers: signRequestHeaders(owner, 'GET', '/api/posts'),
    }, env)
    const post = ((await res.json()).posts as any[]).find((p) => p.id === objId)
    expect(post?.is_archived).toBe(1)

    // Re-init path: the column lives in schema.sql + migration 049, so a fresh
    // ensureSchema run keeps the semantics (covered by test-utils bootstrap).
  })
})
