import { describe, it, expect, beforeAll } from 'vitest'
import app from './index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from './test-utils'

const identity = createTestIdentity()
let env: Awaited<ReturnType<typeof createMockEnv>>

const JPEG_HEADER = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])
function createValidImageBlob(data: string = 'test-data', type: string = 'image/jpeg') {
  const dataBytes = new TextEncoder().encode(data)
  const merged = new Uint8Array(JPEG_HEADER.length + dataBytes.length)
  merged.set(JPEG_HEADER, 0)
  merged.set(dataBytes, JPEG_HEADER.length)
  return new Blob([merged], { type })
}

function authHeaders(method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('Health Check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})

describe('Users API', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('GET /api/users returns 401 without auth headers', async () => {
    const res = await app.request('/api/users')
    expect(res.status).toBe(401)
  })

  it('GET /api/users auto-registers caller and returns them', async () => {
    const res = await app.request('/api/users', {
      headers: authHeaders('GET', '/api/users'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
    expect(body.some((u: any) => u.id === identity.orbitId)).toBe(true)
  })

  it('GET /api/users returns online/inline fields', async () => {
    const res = await app.request('/api/users', {
      headers: authHeaders('GET', '/api/users'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    const me = body.find((u: any) => u.id === identity.orbitId)
    expect(me).toBeDefined()
    expect(me).toHaveProperty('online')
    expect(typeof me.online).toBe('boolean')
  })

  it('GET /api/users includes encryptionPubKey in response', async () => {
    const res = await app.request('/api/users', {
      headers: authHeaders('GET', '/api/users'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    const me = body.find((u: any) => u.id === identity.orbitId)
    expect(me).toHaveProperty('encryptionPubKey')
  })

  it('POST /api/users/heartbeat updates last_seen', async () => {
    const res = await app.request('/api/users/heartbeat', {
      method: 'POST',
      headers: authHeaders('POST', '/api/users/heartbeat'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.ok).toBe(true)

    // Verify last_seen was updated by re-fetching
    const usersRes = await app.request('/api/users', {
      headers: authHeaders('GET', '/api/users'),
    }, env)
    const users: any = await usersRes.json()
    const me = users.find((u: any) => u.id === identity.orbitId)
    expect(me!.last_seen).toBeTruthy()
  })

  it('PATCH /api/users/profile updates display_name', async () => {
    const reqBody = JSON.stringify({ display_name: 'TestUser' })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('PATCH', '/api/users/profile', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.display_name).toBe('TestUser')
  })

  it('PATCH /api/users/profile updates tags', async () => {
    const reqBody = JSON.stringify({ tags: ['art', 'photo'] })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('PATCH', '/api/users/profile', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
  })

  it('PATCH /api/users/profile normalizes tags', async () => {
    const reqBody = JSON.stringify({ tags: [' Art ', '#Photo', 'art', 'Goon!%', 'goon'] })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('PATCH', '/api/users/profile', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.tags).toEqual(['art', 'photo', 'goon'])
  })

  it('PATCH /api/users/profile rejects too many tags', async () => {
    const reqBody = JSON.stringify({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('PATCH', '/api/users/profile', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(400)
  })

  it('PATCH /api/users/profile rejects long display_name', async () => {
    const reqBody = JSON.stringify({ display_name: 'x'.repeat(51) })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('PATCH', '/api/users/profile', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(400)
  })

  it('PATCH /api/users/profile rejects default or pre-generated names', async () => {
    for (const badName of ['user--123456', 'user-abc', 'User_abcdef', 'Anonymous', 'Unknown User', 'User_unknown']) {
      const reqBody = JSON.stringify({ display_name: badName })
      const res = await app.request('/api/users/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders('PATCH', '/api/users/profile', reqBody),
        },
        body: reqBody,
      }, env)
      expect(res.status).toBe(400)
    }
  })

  it('DELETE /api/users/account deletes user and all data', async () => {
    // Upload an object first to test cascade delete
    const formData = new FormData()
    const blob = createValidImageBlob('delete-test', 'image/jpeg')
    formData.append('image', blob, 'delete-me.jpg')
    formData.append('encrypted', 'false')

    const uploadRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)
    expect(uploadRes.status).toBe(201)

    // Delete the account
    const delRes = await app.request('/api/users/account', {
      method: 'DELETE',
      headers: authHeaders('DELETE', '/api/users/account'),
    }, env)
    expect(delRes.status).toBe(200)
    const delBody: any = await delRes.json()
    expect(delBody.ok).toBe(true)
  })
})

describe('Objects API', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('POST /api/objects returns 400 without file', async () => {
    const formData = new FormData()
    formData.append('encrypted', 'false')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: {
        ...authHeaders('POST', '/api/objects'),
      },
      body: formData,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/objects uploads a file and returns 201', async () => {
    const formData = new FormData()
    const blob = createValidImageBlob('fake-image-data', 'image/jpeg')
    formData.append('image', blob, 'test.jpg')
    formData.append('encrypted', 'false')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)
    expect(res.status).toBe(201)
    const body: any = await res.json()
    expect(body.id).toBeDefined()
    expect(body.size).toBeGreaterThan(0)
    expect(body.recipients).toBeGreaterThanOrEqual(1)
  })

  it('POST /api/objects with recipients adds them', async () => {
    const formData = new FormData()
    const blob = createValidImageBlob('more-data', 'image/jpeg')
    formData.append('image', blob, 'test2.png')
    formData.append('encrypted', 'false')
    formData.append('recipients', 'recip1,recip2')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)

    expect(res.status).toBe(201)
    const body: any = await res.json()
    expect(body.recipients).toBeGreaterThanOrEqual(3)
  })

  it('POST /api/objects with file > 50MB returns 400', async () => {
    const formData = new FormData()
    const bigData = new Uint8Array(51 * 1024 * 1024)
    const blob = new Blob([bigData], { type: 'application/octet-stream' })
    formData.append('image', blob, 'huge.bin')
    formData.append('encrypted', 'false')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)
    expect(res.status).toBe(400)
  })

  it('GET /api/objects/:id returns 404 for nonexistent object', async () => {
    const res = await app.request('/api/objects/nonexistent-id', {
      headers: authHeaders('GET', '/api/objects/nonexistent-id'),
    }, env)
    expect(res.status).toBe(404)
  })

  it('GET /api/objects/:id serves video objects with the video content type', async () => {
    // Minimal MP4: box size + 'ftyp' at bytes 4-8 + 'isom' brand
    const mp4Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d, // isom
      0x00, 0x00, 0x00, 0x00,
    ])
    const formData = new FormData()
    formData.append('image', new Blob([mp4Bytes], { type: 'video/mp4' }), 'clip.mp4')
    formData.append('encrypted', 'false')

    const uploadRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)
    expect(uploadRes.status).toBe(201)
    const body: any = await uploadRes.json()

    const res = await app.request(`/api/objects/${body.id}`, {
      headers: authHeaders('GET', `/api/objects/${body.id}`),
    }, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('GET /api/objects/:id returns JSON for link-type objects', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 0, 'text/url', 'https://example.com/article')"
    ).bind('link-object-test', identity.orbitId).run()

    const res = await app.request('/api/objects/link-object-test', {
      headers: authHeaders('GET', '/api/objects/link-object-test'),
    }, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body: any = await res.json()
    expect(body.type).toBe('link')
    expect(body.url).toBe('https://example.com/article')
  })
})

describe('Friends API', () => {
  const friendId = createTestIdentity()
  const anotherId = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('GET /api/friends returns empty list when no friends', async () => {
    const res = await app.request('/api/friends', {
      headers: authHeaders('GET', '/api/friends'),
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('POST /api/friends/requests sends a friend request', async () => {
    // Pre-register the friend
    const friendHeaders = signRequestHeaders(friendId, 'GET', '/api/users')
    await app.request('/api/users', { headers: friendHeaders }, env)

    const reqBody = JSON.stringify({ receiverId: friendId.orbitId })
    const res = await app.request('/api/friends/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/requests', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
    expect(body.requestId).toBeDefined()
  })

  it('POST /api/friends/requests returns 400 when friending self', async () => {
    const reqBody = JSON.stringify({ receiverId: identity.orbitId })
    const res = await app.request('/api/friends/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/requests', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/friends/requests returns 404 for non-existent user', async () => {
    const reqBody = JSON.stringify({ receiverId: 'nonexistent-user-id' })
    const res = await app.request('/api/friends/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/requests', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(404)
  })
})

describe('Friends API — accept/reject/remove', () => {
  const friendId = createTestIdentity()
  const anotherId = createTestIdentity()
  let requestId: string

  beforeAll(async () => {
    env = await createMockEnv()
    // Pre-register users via auth
    const friendHeaders = signRequestHeaders(friendId, 'GET', '/api/users')
    const anotherHeaders = signRequestHeaders(anotherId, 'GET', '/api/users')
    await app.request('/api/users', { headers: friendHeaders }, env)
    await app.request('/api/users', { headers: anotherHeaders }, env)
  })

  it('sends a friend request', async () => {
    const reqBody = JSON.stringify({ receiverId: friendId.orbitId })
    const res = await app.request('/api/friends/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/requests', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    requestId = body.requestId
  })

  it('friend sees pending request', async () => {
    const friendHeaders = signRequestHeaders(friendId, 'GET', '/api/friends/requests')
    const res = await app.request('/api/friends/requests', {
      headers: friendHeaders,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('friend can accept the request', async () => {
    const recvHeaders = signRequestHeaders(friendId, 'POST', `/api/friends/requests/${requestId}/accept`)
    const res = await app.request(`/api/friends/requests/${requestId}/accept`, {
      method: 'POST',
      headers: recvHeaders,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })

  it('GET /api/friends includes encryption_pub_key for friends', async () => {
    const res = await app.request('/api/friends', {
      headers: authHeaders('GET', '/api/friends'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.length).toBeGreaterThanOrEqual(1)
    const friend = body.find((f: any) => f.id === friendId.orbitId)
    expect(friend).toBeDefined()
    expect(friend).toHaveProperty('encryption_pub_key')
  })

  it('can remove a friend', async () => {
    const reqBody = JSON.stringify({ friendId: friendId.orbitId })
    const res = await app.request('/api/friends/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/remove', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })

  it('remove returns 400 without friendId', async () => {
    const res = await app.request('/api/friends/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders('POST', '/api/friends/remove', '{}'),
      },
      body: '{}',
    }, env)
    expect(res.status).toBe(400)
  })

  it('can reject a pending request', async () => {
    // Send a new request from friendId to anotherId
    const reqBody = JSON.stringify({ receiverId: anotherId.orbitId })
    const fHeaders = signRequestHeaders(friendId, 'POST', '/api/friends/requests', reqBody)
    const sendRes = await app.request('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fHeaders },
      body: reqBody,
    }, env)
    expect(sendRes.status).toBe(200)
    const { requestId: rejectId } = await sendRes.json() as any

    // anotherId rejects
    const recvHeaders = signRequestHeaders(anotherId, 'POST', `/api/friends/requests/${rejectId}/reject`)
    const rejectRes = await app.request(`/api/friends/requests/${rejectId}/reject`, {
      method: 'POST',
      headers: recvHeaders,
    }, env)
    expect(rejectRes.status).toBe(200)
    const body: any = await rejectRes.json()
    expect(body.success).toBe(true)
  })
})

describe('Inbox API', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('GET /api/inbox returns items', async () => {
    const res = await app.request('/api/inbox', {
      headers: authHeaders('GET', '/api/inbox'),
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('POST /api/inbox/:id/favorite toggles favorite', async () => {
    // Upload an object first
    const formData = new FormData()
    const blob = createValidImageBlob('fav-test-image', 'image/jpeg')
    formData.append('image', blob, 'fav.jpg')
    formData.append('encrypted', 'false')

    const uploadRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/objects') },
      body: formData,
    }, env)
    expect(uploadRes.status).toBe(201)
    const { id } = await uploadRes.json() as any

    // Favorite it
    const favRes = await app.request(`/api/inbox/${id}/favorite`, {
      method: 'POST',
      headers: authHeaders('POST', `/api/inbox/${id}/favorite`),
    }, env)
    expect(favRes.status).toBe(200)
    const favBody: any = await favRes.json()
    expect(favBody.favorited).toBe(true)

    // Unfavorite it
    const unfavRes = await app.request(`/api/inbox/${id}/favorite`, {
      method: 'POST',
      headers: authHeaders('POST', `/api/inbox/${id}/favorite`),
    }, env)
    expect(unfavRes.status).toBe(200)
    const unfavBody: any = await unfavRes.json()
    expect(unfavBody.favorited).toBe(false)
  })
})

describe('Auth Middleware', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('returns 401 with missing headers', async () => {
    const res = await app.request('/api/users', {
      headers: { 'X-Orbit-Id': identity.orbitId },
    }, env)
    expect(res.status).toBe(401)
  })

  it('returns 401 with expired timestamp', async () => {
    const headers = signRequestHeaders(identity, 'GET', '/api/users', undefined, (Date.now() - 10 * 60 * 1000).toString())
    const res = await app.request('/api/users', { headers }, env)
    expect(res.status).toBe(401)
  })

  it('accepts a GET whose timestamp is inside the relaxed 120s window', async () => {
    const headers = signRequestHeaders(identity, 'GET', '/api/users', undefined, (Date.now() - 60 * 1000).toString())
    const res = await app.request('/api/users', { headers }, env)
    expect(res.status).toBe(200)
  })

  it('keeps the tight 30s window for mutations', async () => {
    const headers = signRequestHeaders(identity, 'POST', '/api/users/heartbeat', undefined, (Date.now() - 60 * 1000).toString())
    const res = await app.request('/api/users/heartbeat', { headers }, env)
    expect(res.status).toBe(401)
  })

  it('returns 401 with bad signature', async () => {
    const headers = authHeaders('GET', '/api/users')
    headers['X-Orbit-Signature'] = '00'.repeat(64)
    const res = await app.request('/api/users', { headers }, env)
    expect(res.status).toBe(401)
  })
})
