import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// Follow counts are DERIVED from the Followers table — the denormalized
// Users.followers_count/following_count columns drift (cascade deletes, admin
// edits) and made the profile counters disagree with the follower lists.
describe('profile follow counts are derived', () => {
  let env: any
  let alice: any
  let bob: any
  let carol: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    bob = createTestIdentity()
    carol = createTestIdentity()
    for (const u of [alice, bob, carol]) {
      await env.DB.prepare(`INSERT INTO Users (id, public_key, display_name, followers_count, following_count, last_seen) VALUES (?, ?, ?, 99, 99, datetime('now'))`)
        .bind(u.orbitId, u.publicKeyHex, u.orbitId.slice(8, 13), new Date().toISOString()).run()
    }
    // Ground truth: bob + carol follow alice; alice follows nobody. A pending
    // (accepted=0) follow must NOT count.
    await env.DB.prepare("INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)").bind(bob.orbitId, alice.orbitId).run()
    await env.DB.prepare("INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)").bind(carol.orbitId, alice.orbitId).run()
    await env.DB.prepare("INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 0)").bind(alice.orbitId, bob.orbitId).run()
  })

  async function get(path: string, who: any) {
    return app.fetch(new Request(`http://localhost${path}`, { headers: signRequestHeaders(who, 'GET', path) }), env)
  }

  it('GET /api/users/:id returns table-derived counts, not the stale columns', async () => {
    const body = (await (await get(`/api/users/${alice.orbitId}`, bob)).json()) as any
    expect(body.user.followers_count).toBe(2)
    expect(body.user.following_count).toBe(0)
  })

  it('GET /api/users/me is derived too', async () => {
    const body = (await (await get('/api/users/me', alice)).json()) as any
    expect(body.followers_count).toBe(2)
    expect(body.following_count).toBe(0)
  })

  it('the /api/users listing is derived too', async () => {
    const res = await get('/api/users', bob)
    expect(res.status).toBe(200)
    const list = (await res.json()) as any[]   // the roster endpoint returns a bare array
    const aliceRow = list.find((u: any) => u.id === alice.orbitId)
    expect(aliceRow?.followers_count).toBe(2)
    expect(aliceRow?.following_count).toBe(0)
  })
})
