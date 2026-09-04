import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let admin: TestIdentity
let userA: TestIdentity
let userB: TestIdentity

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return {
    'Content-Type': 'application/json',
    ...signRequestHeaders(identity, method, url, body),
  }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

async function grantAdmin(identity: TestIdentity) {
  await app.request('/api/admin/verify-pin', {
    method: 'POST',
    headers: auth(identity, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
    body: JSON.stringify({ pin: 'test-pin' }),
  }, { ...env, ADMIN_PIN: 'test-pin' })
}

let seedCounter = 100
async function seedObjectFor(owner: TestIdentity): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, created_at)
     VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', ?, datetime('now'))`
  ).bind(`b11-object-${seedCounter++}`, owner.orbitId, `card-${seedCounter}.jpg`).run()
}

async function get(path: string) {
  const pathname = path.split('?')[0]
  const res = await app.request(path, { headers: auth(admin, 'GET', pathname) }, env)
  return { res, body: await res.json(), total: Number(res.headers.get('X-Total-Count') || 0) }
}

describe('Admin B11 suite — filters, sort, pagination', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    admin = createTestIdentity()
    userA = createTestIdentity()
    userB = createTestIdentity()
    for (const id of [admin, userA, userB]) await register(id)
    await grantAdmin(admin)

    // Seed distinct profiles: A has more objects, B has none.
    await seedObjectFor(userA)
    await seedObjectFor(userA)
    await seedObjectFor(userA)
    await env.DB.prepare('UPDATE Users SET objects_sent_count = 3 WHERE id = ?').bind(userA.orbitId).run()

    // Create a report against userB
    const body = JSON.stringify({ reported_id: userB.orbitId, category: 'harassment', reason: 'Testing' })
    await app.request(`/api/users/${userB.orbitId}/report`, {
      method: 'POST',
      headers: { ...signRequestHeaders(userA, 'POST', `/api/users/${userB.orbitId}/report`, body) },
      body,
    }, env)
  })

  describe('users endpoint', () => {
    it('returns full list with total header by default', async () => {
      const { res, body, total } = await get('/api/admin/users')
      expect(res.status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      expect(total).toBeGreaterThanOrEqual(3)
    })

    it('filters by search query', async () => {
      const name = userA.display_name || userA.orbitId
      const { body, total } = await get(`/api/admin/users?q=${encodeURIComponent(name.slice(0, 8))}`)
      expect(total).toBe(1)
      expect(body.length).toBe(1)
      expect(body[0].id).toBe(userA.orbitId)
    })

    it('sorts by objects count and paginates', async () => {
      const { body, total } = await get('/api/admin/users?sort=objects&order=desc&limit=1&offset=0')
      expect(total).toBeGreaterThanOrEqual(3)
      expect(body.length).toBe(1)
      expect(body[0].id).toBe(userA.orbitId)
    })
  })

  describe('reports endpoint', () => {
    it('filters by status', async () => {
      const { body, total } = await get('/api/admin/content-reports?status=open')
      expect(total).toBeGreaterThanOrEqual(1)
      const mine = body.find((r: any) => r.target_type === 'user' && r.target_id === userB.orbitId)
      expect(mine).toBeDefined()
      expect(mine.status).toBe('open')
      expect(mine.category).toBe('harassment')
    })

    it('filters by category and search', async () => {
      const { body, total } = await get('/api/admin/content-reports?category=harassment&q=Testing')
      expect(total).toBeGreaterThanOrEqual(1)
      expect(body.every((r: any) => r.category === 'harassment')).toBe(true)
    })

    it('paginates', async () => {
      const { body, total } = await get('/api/admin/content-reports?limit=1&offset=0')
      expect(total).toBeGreaterThanOrEqual(1)
      expect(body.length).toBe(1)
    })
  })

  describe('objects endpoint', () => {
    it('filters by owner', async () => {
      const { body, total } = await get(`/api/admin/objects?owner=${userA.orbitId}`)
      expect(total).toBe(3)
      expect(body.every((o: any) => o.owner_id === userA.orbitId)).toBe(true)
    })

    it('searches by caption', async () => {
      const { body, total } = await get(`/api/admin/objects?owner=${userA.orbitId}&q=card`)
      expect(total).toBe(3)
      expect(body.every((o: any) => o.owner_id === userA.orbitId)).toBe(true)
    })

    it('paginates and reports total', async () => {
      const { body, total } = await get(`/api/admin/objects?owner=${userA.orbitId}&limit=2&offset=0`)
      expect(total).toBe(3)
      expect(body.length).toBe(2)
    })
  })
})