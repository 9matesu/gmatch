import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// Follow counts are DERIVED from the Followers table. There used to be
// denormalized Users.followers_count / Users.following_count columns that
// every follow/unfollow bumped; they drifted after cascade deletes and
// admin edits, and the admin panel edited a number no read path used. The
// columns are gone — the table is the only source of truth.
describe('profile follow counts are derived from the Followers table', () => {
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
      await env.DB.prepare(`INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, datetime('now'))`)
        .bind(u.orbitId, u.publicKeyHex, u.orbitId.slice(8, 13)).run()
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

  it('the denormalized counter columns do not exist', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(Users)').all<{ name: string }>()
    const names = cols.results.map((c) => c.name)
    expect(names).not.toContain('followers_count')
    expect(names).not.toContain('following_count')
  })

  it('GET /api/users/:id returns table-derived counts', async () => {
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

  it('PATCH /profile response is derived too (ghost counter fix)', async () => {
    const other = createTestIdentity()
    await env.DB.prepare(`INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, datetime('now'))`)
      .bind(other.orbitId, other.publicKeyHex).run()
    await env.DB.prepare('INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)')
      .bind(other.orbitId, alice.orbitId).run()
    const body = JSON.stringify({ bio: 'hi' })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(alice, 'PATCH', '/api/users/profile', body) },
      body,
    }, env)
    const json = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(json.followers_count).toBe(3)
    expect(json.following_count).toBe(0)
  })
})
