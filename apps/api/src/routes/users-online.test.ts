import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// GET /api/users/online — the discovery roster (plan 1.0, task P1.2).
// A joining client needs the current online set IMMEDIATELY, not only after
// a swarm event happens to arrive.
describe('GET /api/users/online', () => {
  let env: any
  let alice: any
  let bob: any
  let carol: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    bob = createTestIdentity()
    carol = createTestIdentity()
    const now = new Date().toISOString()
    const stale = new Date(Date.now() - 5 * 60_000).toISOString()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)',
    ).bind(alice.orbitId, alice.publicKeyHex, 'Alice', now).run()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)',
    ).bind(bob.orbitId, bob.publicKeyHex, 'Bob', stale).run()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)',
    ).bind(carol.orbitId, carol.publicKeyHex, 'Carol').run()
  })

  it('returns only users seen in the last 60s, minus the caller', async () => {
    const url = '/api/users/online'
    const res = await app.fetch(
      new Request(`http://localhost${url}`, {
        headers: signRequestHeaders(bob, 'GET', url),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
    const ids = body.users.map((u: any) => u.id)
    expect(ids).toEqual([alice.orbitId])
    expect(body.users[0].online).toBe(true)
    expect(typeof body.ts).toBe('number')
  })

  it('rejects unsigned requests', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/users/online'),
      env,
    )
    expect(res.status).toBe(401)
  })
})

// The followers/following lists used a 5-minute window while every other
// presence surface used 60s: a user who left minutes ago read as online in
// the network modal but offline in their profile. One window, all endpoints.
describe('presence window is uniform across user endpoints', () => {
  let env: any
  let alice: any
  let bob: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    bob = createTestIdentity()
    const now = new Date().toISOString()
    // 3 minutes: inside the old 5-minute window, outside the 60s truth.
    const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)',
    ).bind(alice.orbitId, alice.publicKeyHex, 'Alice', threeMinAgo).run()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)',
    ).bind(bob.orbitId, bob.publicKeyHex, 'Bob', now).run()
    await env.DB.prepare(
      'INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)',
    ).bind(bob.orbitId, alice.orbitId).run()
    await env.DB.prepare(
      'INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)',
    ).bind(alice.orbitId, bob.orbitId).run()
  })

  it('reports a 3-minute-idle follower as offline (not 5-minute online)', async () => {
    const url = `/api/users/${bob.orbitId}/followers`
    const res = await app.fetch(
      new Request(`http://localhost${url}`, {
        headers: signRequestHeaders(bob, 'GET', url),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const rows = await res.json()
    const aliceRow = (rows as any[]).find((r) => r.id === alice.orbitId)
    expect(aliceRow).toBeTruthy()
    expect(aliceRow.online).toBe(false)
  })
})
