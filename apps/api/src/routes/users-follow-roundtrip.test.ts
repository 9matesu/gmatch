import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// The gap this file closes: every other follow-count test seeds a static
// Followers table and reads it back. Nothing exercised the actual WRITE ->
// RE-READ round trip, which is why the client could invalidate nothing, refetch
// nothing and still pass CI while the profile number never moved.
describe('follow write -> read round trip', () => {
  let env: any
  let alice: any
  let bob: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    bob = createTestIdentity()
    for (const u of [alice, bob]) {
      await env.DB.prepare(
        `INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, datetime('now'))`,
      ).bind(u.orbitId, u.publicKeyHex, u.orbitId.slice(8, 13)).run()
    }
  })

  const path = (u: any) => `/api/users/${u.orbitId}/follow`

  async function write(who: any, target: any, method: 'POST' | 'DELETE') {
    const p = path(target)
    const res = await app.fetch(
      new Request(`http://localhost${p}`, { method, headers: signRequestHeaders(who, method, p) }),
      env,
    )
    return { res, body: (await res.json()) as any }
  }

  async function countsOf(target: any, as: any) {
    const p = `/api/users/${target.orbitId}`
    const res = await app.fetch(
      new Request(`http://localhost${p}`, { headers: signRequestHeaders(as, 'GET', p) }),
      env,
    )
    return ((await res.json()) as any).user
  }

  async function rosterRow(target: any) {
    const res = await app.fetch(
      new Request('http://localhost/api/users', { headers: signRequestHeaders(bob, 'GET', '/api/users') }),
      env,
    )
    const list = (await res.json()) as any[]
    return list.find((u) => u.id === target.orbitId)
  }

  it('a new follow shows up in every read path, not just the table', async () => {
    const { res, body } = await write(alice, bob, 'POST')
    expect(res.status).toBe(200)
    expect(body.following).toBe(true)

    // GET /:id
    const bobRow = await countsOf(bob, alice)
    expect(bobRow.followers_count).toBe(1)
    expect(bobRow.following_count).toBe(0)

    // GET /api/users (the roster the profile tab actually reads)
    expect((await rosterRow(bob)).followers_count).toBe(1)

    // And the caller's own "following" total moved.
    const aliceRow = await countsOf(alice, alice)
    expect(aliceRow.following_count).toBe(1)
  })

  it('the write response carries the new counts, so the client can apply them', async () => {
    const { body } = await write(alice, bob, 'POST')
    // Regression guard: the response used to be only { following: true }, which
    // left the client nothing but a blind refetch to work with.
    expect(body).toMatchObject({ following: true, followers_count: 1, following_count: 1 })
  })

  it('unfollow decrements every read path', async () => {
    await write(alice, bob, 'POST')
    const { res, body } = await write(alice, bob, 'DELETE')
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ following: false, followers_count: 0, following_count: 0 })

    expect((await countsOf(bob, alice)).followers_count).toBe(0)
    expect((await rosterRow(bob)).followers_count).toBe(0)
    expect((await countsOf(alice, alice)).following_count).toBe(0)
  })

  it('a repeated follow is idempotent (no double count)', async () => {
    await write(alice, bob, 'POST')
    const { body } = await write(alice, bob, 'POST')
    expect(body.followers_count).toBe(1)
    expect((await countsOf(bob, alice)).followers_count).toBe(1)
  })

  it('a repeated unfollow is a no-op, not a negative count', async () => {
    await write(alice, bob, 'POST')
    await write(alice, bob, 'DELETE')
    const { body } = await write(alice, bob, 'DELETE')
    expect(body.followers_count).toBe(0)
    expect((await countsOf(bob, alice)).followers_count).toBe(0)
  })

  it('two followers accumulate rather than overwrite', async () => {
    const carol = createTestIdentity()
    await env.DB.prepare(
      `INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, datetime('now'))`,
    ).bind(carol.orbitId, carol.publicKeyHex, 'carol').run()

    await write(alice, bob, 'POST')
    await write(carol, bob, 'POST')
    expect((await countsOf(bob, alice)).followers_count).toBe(2)
    expect((await rosterRow(bob)).followers_count).toBe(2)

    // One unfollow leaves the other intact.
    await write(alice, bob, 'DELETE')
    expect((await countsOf(bob, alice)).followers_count).toBe(1)
  })

  it('rejects following yourself and unknown users', async () => {
    expect((await write(alice, alice, 'POST')).res.status).toBe(400)
    const ghost = createTestIdentity()
    expect((await write(alice, ghost, 'POST')).res.status).toBe(404)
  })

  it('the follower list endpoint agrees with the count', async () => {
    await write(alice, bob, 'POST')
    const p = `/api/users/${bob.orbitId}/followers`
    const res = await app.fetch(
      new Request(`http://localhost${p}`, { headers: signRequestHeaders(alice, 'GET', p) }),
      env,
    )
    expect(((await res.json()) as any[]).length).toBe(1)
    expect((await countsOf(bob, alice)).followers_count).toBe(1)
  })
})
