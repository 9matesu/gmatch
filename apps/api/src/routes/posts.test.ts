import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const alice = createTestIdentity()
const bob = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function registerUser(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
}

async function setDisplayName(env: any, identity: ReturnType<typeof createTestIdentity>, name: string) {
  const body = JSON.stringify({ display_name: name })
  await app.request('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(identity, 'PATCH', '/api/users/profile', body) },
    body,
  }, env)
}

it('rejects profile updates that leave an authenticated user nameless', async () => {
  const env = await createMockEnv()
  await registerUser(env, alice)
  const body = JSON.stringify({ bio: 'No name yet' })
  const response = await app.request('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'PATCH', '/api/users/profile', body) },
    body,
  }, env)

  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toEqual({ error: 'Display name is required' })
})

function makePngBlob(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
  ])
  return new Blob([bytes], { type: 'image/png' })
}

async function createPublicPost(env: any, identity: ReturnType<typeof createTestIdentity>, caption: string) {
  const formData = new FormData()
  formData.append('image', makePngBlob(), 'card.png')
  formData.append('is_public', '1')
  formData.append('post_caption', caption)
  formData.append('location', 'Testville')
  formData.append('tags', 'anime, test')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: signRequestHeaders(identity, 'POST', '/api/objects'),
    body: formData,
  }, env)
  expect(res.status).toBe(201)
  const json: any = await res.json()
  expect(json.id).toBeTruthy()
  return json.id as string
}

describe('Posts API (goonMatch feed engagement)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let postId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, alice)
    await registerUser(env, bob)
    await setDisplayName(env, alice, 'Alice Arcade')
    await setDisplayName(env, bob, 'Bob Builder')
    postId = await createPublicPost(env, alice, 'My first public card #anime')
  })

  it('GET /api/posts lists the public post', async () => {
    const res = await app.request('/api/posts', { headers: authHeaders(bob, 'GET', '/api/posts') }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(Array.isArray(json.posts)).toBe(true)
    expect(json.posts.length).toBeGreaterThanOrEqual(1)
    const post = json.posts.find((p: any) => p.id === postId)
    expect(post).toBeTruthy()
    expect(post.caption).toBe('My first public card #anime')
    expect(post.location).toBe('Testville')
    expect(post.author_name).toBe('Alice Arcade')
    expect(post.is_liked).toBe(false)
  })

  it('POST /api/posts/:id/like increments and marks liked', async () => {
    const res = await app.request(`/api/posts/${postId}/like`, { method: 'POST', headers: authHeaders(bob, 'POST', `/api/posts/${postId}/like`) }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.liked).toBe(true)
    expect(json.like_count).toBe(1)

    const feed = await app.request('/api/posts', { headers: authHeaders(bob, 'GET', '/api/posts') }, env)
    const feedJson: any = await feed.json()
    const post = feedJson.posts.find((p: any) => p.id === postId)
    expect(post.is_liked).toBe(true)
    expect(post.like_count).toBe(1)
  })

  it('DELETE /api/posts/:id/like is idempotent and decrements', async () => {
    const res = await app.request(`/api/posts/${postId}/like`, { method: 'DELETE', headers: authHeaders(bob, 'DELETE', `/api/posts/${postId}/like`) }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.liked).toBe(false)
    expect(json.like_count).toBe(0)

    // Double-unlike stays at 0
    const res2 = await app.request(`/api/posts/${postId}/like`, { method: 'DELETE', headers: authHeaders(bob, 'DELETE', `/api/posts/${postId}/like`) }, env)
    const json2: any = await res2.json()
    expect(json2.like_count).toBe(0)
  })

  it('save + unsave a post', async () => {
    const save = await app.request(`/api/posts/${postId}/save`, { method: 'POST', headers: authHeaders(bob, 'POST', `/api/posts/${postId}/save`) }, env)
    expect(save.status).toBe(200)
    const saveJson: any = await save.json()
    expect(saveJson.saved).toBe(true)

    const feed = await app.request('/api/posts', { headers: authHeaders(bob, 'GET', '/api/posts') }, env)
    const feedJson: any = await feed.json()
    expect(feedJson.posts.find((p: any) => p.id === postId).is_saved).toBe(true)

    const unsave = await app.request(`/api/posts/${postId}/save`, { method: 'DELETE', headers: authHeaders(bob, 'DELETE', `/api/posts/${postId}/save`) }, env)
    expect(unsave.status).toBe(200)
  })

  it('comments: create, list, like, delete', async () => {
    const body = JSON.stringify({ body: 'sick card!' })
    const create = await app.request(`/api/posts/${postId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bob, 'POST', `/api/posts/${postId}/comments`, body) },
      body,
    }, env)
    expect(create.status).toBe(201)
    const created: any = await create.json()
    expect(created.id).toBeTruthy()

    const list = await app.request(`/api/posts/${postId}/comments`, { headers: authHeaders(bob, 'GET', `/api/posts/${postId}/comments`) }, env)
    const listJson: any = await list.json()
    expect(listJson.length).toBe(1)
    expect(listJson[0].text).toBe('sick card!')
    expect(listJson[0].author_name).toBe('Bob Builder')

    const like = await app.request(`/api/posts/${postId}/comments/${created.id}/like`, {
      method: 'POST',
      headers: authHeaders(alice, 'POST', `/api/posts/${postId}/comments/${created.id}/like`),
    }, env)
    expect(like.status).toBe(200)
    const likeJson: any = await like.json()
    expect(likeJson.like_count).toBe(1)

    const del = await app.request(`/api/posts/${postId}/comments/${created.id}`, { method: 'DELETE', headers: authHeaders(bob, 'DELETE', `/api/posts/${postId}/comments/${created.id}`) }, env)
    expect(del.status).toBe(200)
  })

  it('report a post hides it instantly and feeds the admin queue', async () => {
    const body = JSON.stringify({ category: 'spam', reason: 'fake ad' })
    const res = await app.request(`/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bob, 'POST', `/api/posts/${postId}/report`, body) },
      body,
    }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reported).toBe(true)
    expect(json.hidden).toBe(true)

    // Hidden instantly: gone from the feed and the detail route 404s.
    const feed = await app.request('/api/posts', { headers: authHeaders(alice, 'GET', '/api/posts') }, env)
    const feedJson: any = await feed.json()
    expect(feedJson.posts.find((p: any) => p.id === postId)).toBeUndefined()
    const detail = await app.request(`/api/posts/${postId}`, { headers: authHeaders(bob, 'GET', `/api/posts/${postId}`) }, env)
    expect(detail.status).toBe(404)

    const queued = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ContentReports WHERE target_type = 'post' AND target_id = ? AND status = 'open'"
    ).bind(postId).first<{ n: number }>()
    expect(Number(queued?.n || 0)).toBe(1)
  })

  it('non-owner cannot delete a post', async () => {
    const res = await app.request(`/api/posts/${postId}`, { method: 'DELETE', headers: authHeaders(bob, 'DELETE', `/api/posts/${postId}`) }, env)
    expect(res.status).toBe(403)
  })

  it('owner can delete a post', async () => {
    const res = await app.request(`/api/posts/${postId}`, { method: 'DELETE', headers: authHeaders(alice, 'DELETE', `/api/posts/${postId}`) }, env)
    expect(res.status).toBe(200)

    const feed = await app.request('/api/posts', { headers: authHeaders(alice, 'GET', '/api/posts') }, env)
    const feedJson: any = await feed.json()
    expect(feedJson.posts.find((p: any) => p.id === postId)).toBeUndefined()
  })
})

describe('Report abuse prevention', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let postId: string
  const reporter = createTestIdentity()
  const reporter2 = createTestIdentity()
  const owner = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, owner)
    await registerUser(env, reporter)
    await registerUser(env, reporter2)
    postId = await createPublicPost(env, owner, 'report me')
  })

  it('dedupes repeated reports from the same reporter', async () => {
    const body = JSON.stringify({ category: 'spam', reason: 'spam' })
    const first = await app.request(`/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(reporter, 'POST', `/api/posts/${postId}/report`, body) },
      body,
    }, env)
    const firstJson: any = await first.json()
    expect(firstJson.reported).toBe(true)
    expect(firstJson.hidden).toBe(true)

    // Same reporter repeating is a no-op — no new queue rows.
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/api/posts/${postId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(reporter, 'POST', `/api/posts/${postId}/report`, body) },
        body,
      }, env)
      const json: any = await res.json()
      expect(json.reported).toBe(false)
    }

    // A second reporter queues a new report.
    const other = await app.request(`/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(reporter2, 'POST', `/api/posts/${postId}/report`, body) },
      body,
    }, env)
    const otherJson: any = await other.json()
    expect(otherJson.reported).toBe(true)

    const total = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ContentReports WHERE target_type = 'post' AND target_id = ?"
    ).bind(postId).first<{ n: number }>()
    expect(Number(total?.n || 0)).toBe(2)
  })
})

describe('Follows API', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, alice)
    await registerUser(env, bob)
  })

  it('POST /api/users/:id/follow adds a follower', async () => {
    const res = await app.request(`/api/users/${bob.orbitId}/follow`, { method: 'POST', headers: authHeaders(alice, 'POST', `/api/users/${bob.orbitId}/follow`) }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.following).toBe(true)
  })

  it('cannot follow yourself', async () => {
    const res = await app.request(`/api/users/${alice.orbitId}/follow`, { method: 'POST', headers: authHeaders(alice, 'POST', `/api/users/${alice.orbitId}/follow`) }, env)
    expect(res.status).toBe(400)
  })

  it('GET followers and following lists', async () => {
    const followers = await app.request(`/api/users/${bob.orbitId}/followers`, { headers: authHeaders(alice, 'GET', `/api/users/${bob.orbitId}/followers`) }, env)
    const followersJson: any = await followers.json()
    expect(followersJson.some((f: any) => f.id === alice.orbitId)).toBe(true)

    const following = await app.request(`/api/users/${alice.orbitId}/following`, { headers: authHeaders(alice, 'GET', `/api/users/${alice.orbitId}/following`) }, env)
    const followingJson: any = await following.json()
    expect(followingJson.some((f: any) => f.id === bob.orbitId)).toBe(true)
  })

  it('DELETE /api/users/:id/follow unfollows', async () => {
    const res = await app.request(`/api/users/${bob.orbitId}/follow`, { method: 'DELETE', headers: authHeaders(alice, 'DELETE', `/api/users/${bob.orbitId}/follow`) }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.following).toBe(false)

    const following = await app.request(`/api/users/${alice.orbitId}/following`, { headers: authHeaders(alice, 'GET', `/api/users/${alice.orbitId}/following`) }, env)
    const followingJson: any = await following.json()
    expect(followingJson.some((f: any) => f.id === bob.orbitId)).toBe(false)
  })
})

describe('pm /send alias', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, alice)
    await registerUser(env, bob)
  })

  it('POST /api/pm/send maps receiver_id/content to recipient_id/body', async () => {
    const body = JSON.stringify({ receiver_id: bob.orbitId, content: 'replied to your story!' })
    const res = await app.request('/api/pm/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/pm/send', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message?.body).toBe('replied to your story!')
    expect(json.message?.recipient_id).toBe(bob.orbitId)
  })
})

describe('Post vs Card separation', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, alice)
  })

  it('creating a public post does not appear in /api/inbox or /api/cards', async () => {
    const pubPostId = await createPublicPost(env, alice, 'Clean post test')

    // 1. Post is in the public feed
    const feedRes = await app.request('/api/posts', { headers: authHeaders(alice, 'GET', '/api/posts') }, env)
    expect(feedRes.status).toBe(200)
    const feedJson: any = await feedRes.json()
    expect(feedJson.posts.some((p: any) => p.id === pubPostId)).toBe(true)

    // 2. Post is NOT in /api/inbox (which is for private cards/items)
    const inboxRes = await app.request('/api/inbox', { headers: authHeaders(alice, 'GET', '/api/inbox') }, env)
    expect(inboxRes.status).toBe(200)
    const inboxJson: any = await inboxRes.json()
    expect(inboxJson.some((item: any) => item.id === pubPostId)).toBe(false)

    // 3. Post is NOT in /api/cards collection
    const cardsRes = await app.request('/api/cards', { headers: authHeaders(alice, 'GET', '/api/cards') }, env)
    expect(cardsRes.status).toBe(200)
    const cardsJson: any = await cardsRes.json()
    expect(cardsJson.cards.some((c: any) => c.mediaObjectId === pubPostId)).toBe(false)
  })
})
