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
