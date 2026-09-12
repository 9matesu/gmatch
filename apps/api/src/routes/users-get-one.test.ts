import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// GET /api/users/:id — canonical public profile (share-permalink target, P3.5).
describe('GET /api/users/:id', () => {
  let env: any
  let alice: any
  let bob: any

  beforeEach(async () => {
    env = await createMockEnv()
    alice = createTestIdentity()
    bob = createTestIdentity()
    await env.DB.prepare(
      'INSERT INTO Users (id, public_key, display_name, bio, followers_count, following_count, posts_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(alice.orbitId, alice.publicKeyHex, 'Alice', 'hi', 3, 2, 5).run()
    // counts are derived from the Followers table; give bob+alice 3 real rows
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare('INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)')
        .bind(`follower-${i}`, alice.orbitId).run()
    }
  })

  it('returns sanitized public profile fields', async () => {
    const url = `/api/users/${alice.orbitId}`
    const res = await app.fetch(
      new Request(`http://localhost${url}`, { headers: signRequestHeaders(bob, 'GET', url) }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.id).toBe(alice.orbitId)
    expect(body.user.display_name).toBe('Alice')
    expect(body.user.bio).toBe('hi')
    expect(body.user.followers_count).toBe(3)
    expect(body.user.public_key).toBe(alice.publicKeyHex)
    // private material never leaks
    expect(body.user).not.toHaveProperty('private_key')
    expect(body.user).not.toHaveProperty('pfp_data')
  })

  it('404s unknown ids', async () => {
    const url = '/api/users/deadbeef'
    const res = await app.fetch(
      new Request(`http://localhost${url}`, { headers: signRequestHeaders(bob, 'GET', url) }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
