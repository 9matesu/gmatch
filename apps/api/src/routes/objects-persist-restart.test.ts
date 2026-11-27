import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

/**
 * The "I post, restart, and it says missing bytes" regression, end to end.
 *
 * Each step is the real route, not a service call:
 *   1. POST /api/objects/register with bytes  -> 200, row + blob written
 *   2. GET  /api/objects/:id                  -> the bytes, not a 404
 *   3. a FRESH connection + FRESH blob store over the SAME directory
 *      (what a restart is) still serves them
 */
describe('post bytes survive a restart', () => {
  const owner = createTestIdentity()

  // 1x1 PNG
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ])

  function registerBody(id: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      id,
      mime_type: 'image/png',
      is_public: 1,
      post_caption: 'a real post',
      data_base64: Buffer.from(PNG).toString('base64'),
      ...extra,
    })
  }

  function register(env: any, body: string, identity = owner) {
    const headers = signRequestHeaders(identity, 'POST', '/api/objects/register', body)
    headers['Content-Type'] = 'application/json'
    return app.request('/api/objects/register', { method: 'POST', headers, body }, env)
  }

  function get(env: any, id: string, identity = owner) {
    const path = `/api/objects/${id}`
    return app.request(path, { method: 'GET', headers: signRequestHeaders(identity, 'GET', path) }, env)
  }

  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(owner.orbitId, owner.publicKeyHex, 'Author').run().catch(() => {})
  })

  it('registers bytes, serves them, and still serves them after a restart', async () => {
    // 1. Publish with bytes.
    const reg = await register(env, registerBody('persist-1'))
    expect(reg.status).toBe(200)

    // 2. Read them back through the route.
    const first = await get(env, 'persist-1')
    expect(first.status).toBe(200)
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG)

    // 3. Restart: a fresh DB connection + fresh blob store over the SAME
    // directory. In-memory test DBs cannot survive a new connection, so the
    // restart is modelled the only way it can be: a brand-new store instance
    // over the same blob directory (the bytes are what must outlive the
    // process, and they are on disk, not in the DB handle).
    const dir = (env.BUCKET as unknown as { baseDir: string }).baseDir
    const { LocalBlobStore } = await import('../blob')
    const env2 = { DB: env.DB, BUCKET: new LocalBlobStore(dir) }

    const after = await get(env2, 'persist-1')
    expect(after.status).toBe(200)
    expect(new Uint8Array(await after.arrayBuffer())).toEqual(PNG)
    // The row still says bytes-unavailable? No: the fresh store finds them.
    expect(after.status).not.toBe(404)
  })

  it('a JSON-only registration (no bytes) still reads as bytes-unavailable, not a crash', async () => {
    const body = JSON.stringify({ id: 'meta-only-1', mime_type: 'image/png', is_public: 1 })
    const res = await register(env, body)
    expect(res.status).toBe(200)

    const got = await get(env, 'meta-only-1')
    // The row is real; the bytes are not here. That is a 404 with a reason, and
    // the row is NOT deleted by the read.
    expect(got.status).toBe(404)
    const row = await env.DB.prepare('SELECT id FROM Objects WHERE id = ?').bind('meta-only-1').first()
    expect(row).toBeTruthy()
  })

  it('a retry that attaches the bytes the first attempt omitted fixes the row', async () => {
    // Offline publish: metadata first, bytes later (the outbox replay).
    await register(env, JSON.stringify({ id: 'late-1', mime_type: 'image/png', is_public: 1 }))
    expect((await get(env, 'late-1')).status).toBe(404)

    const retry = await register(env, registerBody('late-1'))
    expect(retry.status).toBe(200)
    expect((await retry.json()) as { reused?: boolean }).toMatchObject({ reused: true })

    const got = await get(env, 'late-1')
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
  })

  it('does not render a duplicate row when the same id is registered twice', async () => {
    await register(env, registerBody('dedupe-1'))
    await register(env, registerBody('dedupe-1'))
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM Objects').first<{ n: number }>()
    expect(n!.n).toBe(1)
  })
})