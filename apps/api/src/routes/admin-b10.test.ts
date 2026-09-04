import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let admin: TestIdentity
let regular: TestIdentity

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

let seedCounter = 200
async function seedObjectFor(identity: TestIdentity, owner: TestIdentity): Promise<string> {
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, seedCounter++ & 0xFF])
  const form = new FormData()
  form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'card.jpg')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: { ...signRequestHeaders(identity, 'POST', '/api/objects', '') },
    body: form,
  }, env)
  const body: any = await res.json()
  return body.id
}

describe('Admin B10 suite — result override, ban+wipe', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    admin = createTestIdentity()
    regular = createTestIdentity()
    for (const id of [admin, regular]) await register(id)
    await grantAdmin(admin)
  })

  describe('direct match result override', () => {
    it('requires a valid result', async () => {
      const res = await app.request('/api/admin/matches/00000000-0000-0000-0000-000000000000/result', {
        method: 'POST',
        headers: auth(admin, 'POST', '/api/admin/matches/00000000-0000-0000-0000-000000000000/result', JSON.stringify({ result: 'bogus' })),
        body: JSON.stringify({ result: 'bogus' }),
      }, env)
      expect(res.status).toBe(400)
    })

    it('rejects overriding a match admin does not control (non-admin user)', async () => {
      const res = await app.request('/api/admin/matches/00000000-0000-0000-0000-000000000000/result', {
        method: 'POST',
        headers: auth(regular, 'POST', '/api/admin/matches/00000000-0000-0000-0000-000000000000/result', JSON.stringify({ result: 'winner_a' })),
        body: JSON.stringify({ result: 'winner_a' }),
      }, env)
      expect(res.status).toBe(403)
    })

    it('overrides a live match result to winner_a', async () => {
      for (let i = 0; i < 5; i++) await seedObjectFor(admin, admin)
      for (let i = 0; i < 5; i++) await seedObjectFor(regular, regular)
      // Create a lobby-phase match between admin and regular
      const join = await app.request('/api/lobby/join', { method: 'POST', headers: auth(admin, 'POST', '/api/lobby/join') }, env)
      expect(join.status).toBe(200)
      const joinB = await app.request('/api/lobby/join', { method: 'POST', headers: auth(regular, 'POST', '/api/lobby/join') }, env)
      expect(joinB.status).toBe(200)
      const state = await app.request('/api/lobby', { headers: auth(admin, 'GET', '/api/lobby') }, env)
      const sBody: any = await state.json()
      expect(sBody.match).toBeTruthy()
      const matchId = sBody.match.id

      const res = await app.request(`/api/admin/matches/${matchId}/result`, {
        method: 'POST',
        headers: auth(admin, 'POST', `/api/admin/matches/${matchId}/result`, JSON.stringify({ result: 'winner_a' })),
        body: JSON.stringify({ result: 'winner_a' }),
      }, env)
      expect(res.status).toBe(200)
      const body: any = await res.json()
      expect(body.success).toBe(true)
      expect(body.result).toBe('winner_a')

      // The match should now be archived with the override result.
      const archive = await app.request(`/api/admin/matches/archive/${matchId}`, {
        headers: auth(admin, 'GET', `/api/admin/matches/archive/${matchId}`),
      }, env)
      expect(archive.status).toBe(200)
      const aBody: any = await archive.json()
      expect(aBody.result).toBe('winner_a')
    })
  })

  describe('ban + wipe user content', () => {
    let target: TestIdentity

    beforeAll(async () => {
      target = createTestIdentity()
      await register(target)
    })

    it('wipes all content on ban by default', async () => {
      // Seed an object owned by the target
      const card = await seedObjectFor(target, target)
      expect(card).toBeTruthy()

      const res = await app.request(`/api/admin/users/${target.orbitId}/ban`, {
        method: 'POST',
        headers: auth(admin, 'POST', `/api/admin/users/${target.orbitId}/ban`, JSON.stringify({ reason: 'content policy' })),
        body: JSON.stringify({ reason: 'content policy' }),
      }, env)
      expect(res.status).toBe(200)
      const body: any = await res.json()
      expect(body.wiped).toBe(true)

      // The target's objects are gone.
      const owned = await env.DB.prepare('SELECT id FROM Objects WHERE owner_id = ?').bind(target.orbitId).all()
      expect(owned.results.length).toBe(0)
      // The user is banned.
      const banned = await env.DB.prepare('SELECT 1 FROM Bans WHERE user_id = ?').bind(target.orbitId).first()
      expect(banned).toBeTruthy()
      // The account still exists (ban keeps the row).
      const user = await env.DB.prepare('SELECT score FROM Users WHERE id = ?').bind(target.orbitId).first<{ score: number }>()
      expect(user).toBeTruthy()
    })

    it('can ban without wiping when wipe=false', async () => {
      const fresh = createTestIdentity()
      await register(fresh)
      const card = await seedObjectFor(fresh, fresh)
      expect(card).toBeTruthy()

      const res = await app.request(`/api/admin/users/${fresh.orbitId}/ban`, {
        method: 'POST',
        headers: auth(admin, 'POST', `/api/admin/users/${fresh.orbitId}/ban`, JSON.stringify({ reason: 'test', wipe: false })),
        body: JSON.stringify({ reason: 'test', wipe: false }),
      }, env)
      expect(res.status).toBe(200)
      const body: any = await res.json()
      expect(body.wiped).toBe(false)

      const owned = await env.DB.prepare('SELECT id FROM Objects WHERE owner_id = ?').bind(fresh.orbitId).all()
      expect(owned.results.length).toBeGreaterThan(0)
    })
  })
})