import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// Phase 3: POST /api/objects/register is idempotent on client-supplied id.
// Retries (outbox flush after offline) return the existing row instead of
// 500ing or double-counting posts.
describe('register idempotency (Phase 3)', () => {
  let env: any
  const user = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(user.orbitId, user.publicKeyHex, 'Reg').run()
  })

  function register(body: Record<string, unknown>, identity = user) {
    const path = '/api/objects/register'
    const bodyStr = JSON.stringify(body)
    const headers = signRequestHeaders(identity, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request(path, { method: 'POST', headers, body: bodyStr }, env)
  }

  const body = {
    id: 'reg-0001',
    content_hash: 'd'.repeat(64),
    size_bytes: 100,
    mime_type: 'image/jpeg',
    magnet_uri: 'magnet:?xt=urn:btih:dddd',
    is_public: true,
    post_group: 'pg-1',
  }

  it('same id twice: one row, posts_count +1 once, second returns reused', async () => {
    const r1 = await register(body)
    expect(r1.status).toBe(200)
    expect((await r1.json()) as any).toMatchObject({ id: 'reg-0001' })
    const r2 = await register(body)
    expect(r2.status).toBe(200)
    expect((await r2.json()) as any).toMatchObject({ id: 'reg-0001', reused: true })
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM Objects').first<any>()
    expect(n.n).toBe(1)
    const u = await env.DB.prepare('SELECT posts_count AS c FROM Users WHERE id = ?').bind(user.orbitId).first<any>()
    expect(u.c).toBe(1)
  })

  it('same id, different owner: 409, no overwrite', async () => {
    expect((await register(body)).status).toBe(200)
    const other = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(other.orbitId, other.publicKeyHex, 'Other').run()
    const r = await register(body, other)
    expect(r.status).toBe(409)
    const row = await env.DB.prepare('SELECT owner_id AS o FROM Objects WHERE id = ?').bind('reg-0001').first<any>()
    expect(row.o).toBe(user.orbitId)
  })
})
