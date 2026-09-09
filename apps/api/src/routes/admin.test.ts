import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const adminId = createTestIdentity()
const regularId = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('Admin API — verify-pin', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('POST /api/admin/verify-pin returns 401 with wrong PIN', async () => {
    const res = await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'wrong-pin' })),
      },
      body: JSON.stringify({ pin: 'wrong-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
    expect(res.status).toBe(401)
  })

  it('POST /api/admin/verify-pin returns 200 with correct PIN and sets is_admin', async () => {
    // First register the user
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)

    const res = await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('Admin API — adminAuth middleware', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    // Register both users
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(regularId, 'GET', '/api/users') }, env)
    // Grant admin to adminId
    const envWithPin = { ...env, ADMIN_PIN: 'test-pin' }
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, envWithPin)
  })

  it('GET /api/admin/users returns 403 for non-admin user', async () => {
    const res = await app.request('/api/admin/users', {
      headers: authHeaders(regularId, 'GET', '/api/admin/users'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('GET /api/admin/users returns 200 for admin user', async () => {
    const res = await app.request('/api/admin/users', {
      headers: authHeaders(adminId, 'GET', '/api/admin/users'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/admin/content-reports returns 200 for admin', async () => {
    const res = await app.request('/api/admin/content-reports', {
      headers: authHeaders(adminId, 'GET', '/api/admin/content-reports'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/objects/:id lets an admin inspect an object they do not own', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('admin-moderation-object', regularId.orbitId).run()

    const res = await app.request('/api/objects/admin-moderation-object', {
      headers: authHeaders(adminId, 'GET', '/api/objects/admin-moderation-object'),
    }, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })
})

describe('Admin API — user ban/unban', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const targetId = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    // Register users
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(targetId, 'GET', '/api/users') }, env)
    // Grant admin
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
  })

  it('POST /api/admin/users/:id/ban bans a user', async () => {
    const reqBody = JSON.stringify({ reason: 'Spam' })
    const res = await app.request(`/api/admin/users/${targetId.orbitId}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', `/api/admin/users/${targetId.orbitId}/ban`, reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })

  it('POST /api/admin/users/:id/ban returns 400 for already banned user', async () => {
    const reqBody = JSON.stringify({ reason: 'Again' })
    const res = await app.request(`/api/admin/users/${targetId.orbitId}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', `/api/admin/users/${targetId.orbitId}/ban`, reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/admin/users/:id/unban unbans the user', async () => {
    const res = await app.request(`/api/admin/users/${targetId.orbitId}/unban`, {
      method: 'POST',
      headers: authHeaders(adminId, 'POST', `/api/admin/users/${targetId.orbitId}/unban`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })

  it('banned user shows is_banned in user list', async () => {
    // Re-ban the target
    await app.request(`/api/admin/users/${targetId.orbitId}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', `/api/admin/users/${targetId.orbitId}/ban`, JSON.stringify({ reason: 'Test' })),
      },
      body: JSON.stringify({ reason: 'Test' }),
    }, env)

    const res = await app.request('/api/admin/users', {
      headers: authHeaders(adminId, 'GET', '/api/admin/users'),
    }, env)
    expect(res.status).toBe(200)
    const users: any = await res.json()
    const bannedUser = users.find((u: any) => u.id === targetId.orbitId)
    expect(bannedUser).toBeDefined()
    expect(bannedUser.is_banned).toBe(true)
    expect(bannedUser.ban_reason).toBe('Test')
  })
})

describe('Admin API — announcements', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
  })

  it('POST /api/admin/announcements creates announcement', async () => {
    const reqBody = JSON.stringify({ message: 'Test announcement', is_active: true })
    const res = await app.request('/api/admin/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/announcements', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBeDefined()
  })

  it('POST /api/admin/announcements returns 400 without message', async () => {
    const reqBody = JSON.stringify({ is_active: true })
    const res = await app.request('/api/admin/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/announcements', reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(400)
  })

  it('GET /api/admin/announcements lists announcements', async () => {
    const res = await app.request('/api/admin/announcements', {
      headers: authHeaders(adminId, 'GET', '/api/admin/announcements'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('PATCH /api/admin/announcements/:id/toggle toggles active status', async () => {
    // Get the first announcement
    const listRes = await app.request('/api/admin/announcements', {
      headers: authHeaders(adminId, 'GET', '/api/admin/announcements'),
    }, env)
    const announcements: any = await listRes.json()
    const annId = announcements[0].id
    const initialActive = announcements[0].is_active

    const res = await app.request(`/api/admin/announcements/${annId}/toggle`, {
      method: 'PATCH',
      headers: authHeaders(adminId, 'PATCH', `/api/admin/announcements/${annId}/toggle`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.is_active).toBe(initialActive ? 0 : 1)
  })

  it('PATCH /api/admin/announcements/:id/toggle returns 404 for unknown id', async () => {
    const res = await app.request('/api/admin/announcements/nonexistent/toggle', {
      method: 'PATCH',
      headers: authHeaders(adminId, 'PATCH', '/api/admin/announcements/nonexistent/toggle'),
    }, env)
    expect(res.status).toBe(404)
  })

  it('DELETE /api/admin/announcements/:id deletes announcement', async () => {
    const listRes = await app.request('/api/admin/announcements', {
      headers: authHeaders(adminId, 'GET', '/api/admin/announcements'),
    }, env)
    const announcements: any = await listRes.json()
    const annId = announcements[0].id

    const res = await app.request(`/api/admin/announcements/${annId}`, {
      method: 'DELETE',
      headers: authHeaders(adminId, 'DELETE', `/api/admin/announcements/${annId}`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('Public announcements endpoint', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
    // Create an active announcement
    const reqBody = JSON.stringify({ message: 'Public test', is_active: true })
    await app.request('/api/admin/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/announcements', reqBody),
      },
      body: reqBody,
    }, env)
  })

  it('GET /api/announcements returns active announcement', async () => {
    const res = await app.request('/api/announcements', {
      headers: authHeaders(adminId, 'GET', '/api/announcements'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(body[0].message).toBe('Public test')
  })

  it('GET /api/announcements only returns active announcements', async () => {
    // Create another inactive announcement
    const reqBody = JSON.stringify({ message: 'Inactive', is_active: false })
    await app.request('/api/admin/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/announcements', reqBody),
      },
      body: reqBody,
    }, env)

    const res = await app.request('/api/announcements', {
      headers: authHeaders(adminId, 'GET', '/api/announcements'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].message).toBe('Public test')
  })
})

describe('Admin API — recommendations', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let recId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
    // Create a recommendation via the user endpoint
    const reqBody = JSON.stringify({ category: 'Feature', content: 'Test recommendation' })
    const recRes = await app.request('/api/recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/recommendations', reqBody),
      },
      body: reqBody,
    }, env)
    const recBody: any = await recRes.json()
    recId = recBody.id
    expect(recId).toBeDefined()
  })

  it('GET /api/admin/recommendations lists all recommendations', async () => {
    const res = await app.request('/api/admin/recommendations', {
      headers: authHeaders(adminId, 'GET', '/api/admin/recommendations'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
    expect(body[0].user_name).toBeDefined()
  })

  it('PATCH /api/admin/recommendations/:id updates status', async () => {
    const reqBody = JSON.stringify({ status: 'reviewed' })
    const res = await app.request(`/api/admin/recommendations/${recId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PATCH', `/api/admin/recommendations/${recId}`, reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.status).toBe('reviewed')
  })

  it('PATCH /api/admin/recommendations/:id rejects invalid status', async () => {
    const reqBody = JSON.stringify({ status: 'invalid' })
    const res = await app.request(`/api/admin/recommendations/${recId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PATCH', `/api/admin/recommendations/${recId}`, reqBody),
      },
      body: reqBody,
    }, env)
    expect(res.status).toBe(200)
    // Should default to 'pending' since 'invalid' is not in the allowed list
    const body: any = await res.json()
    expect(body.status).toBe('pending')
  })

  it('DELETE /api/admin/recommendations/:id deletes recommendation', async () => {
    const res = await app.request(`/api/admin/recommendations/${recId}`, {
      method: 'DELETE',
      headers: authHeaders(adminId, 'DELETE', `/api/admin/recommendations/${recId}`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('Admin API — special matches', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const matchId = 'admin-special-match'
  const partnerId = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(partnerId, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })

    await env.DB.prepare(`
      INSERT INTO TierMatches (id, user_a, user_b, status, tier, card_a, card_b, decision_a, decision_b)
      VALUES (?, ?, ?, 'active', 2, 'card-a', 'card-b', 'like', NULL)
    `).bind(matchId, adminId.orbitId, partnerId.orbitId).run()
  })

  it('GET /api/admin/special-matches returns 403 for non-admin', async () => {
    const res = await app.request('/api/admin/special-matches', {
      headers: authHeaders(regularId, 'GET', '/api/admin/special-matches'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('GET /api/admin/special-matches lists tier matches with user names', async () => {
    const res = await app.request('/api/admin/special-matches', {
      headers: authHeaders(adminId, 'GET', '/api/admin/special-matches'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body)).toBe(true)
    const match = body.find((m: any) => m.id === matchId)
    expect(match).toBeDefined()
    expect(match.tier).toBe(2)
    expect(match.card_a).toBe('card-a')
    expect(match.card_b).toBe('card-b')
    expect(match.decision_a).toBe('like')
    expect(match.status).toBe('active')
    expect(match.user_a_name).toBeDefined()
  })
})

describe('Admin API — content-report resolution (instant-hide triage)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const reportedUser = createTestIdentity()
  const secondUser = createTestIdentity()

  async function seed() {
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(regularId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(reportedUser, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(secondUser, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
  }

  async function findOpenReport(targetId: string) {
    const res = await app.request('/api/admin/content-reports?status=open', {
      headers: authHeaders(adminId, 'GET', '/api/admin/content-reports'),
    }, env)
    expect(res.status).toBe(200)
    const reports: any = await res.json()
    return reports.find((x: any) => x.target_id === targetId)
  }

  it('reporting a user hides their profile + content instantly and queues the report', async () => {
    env = await createMockEnv()
    await seed()
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('report-evidence-obj', reportedUser.orbitId).run()
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('user-sent-obj-1', reportedUser.orbitId).run()

    const body = JSON.stringify({ reason: 'Spam images', category: 'spam', object_id: 'report-evidence-obj' })
    const res = await app.request(`/api/users/${reportedUser.orbitId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(regularId, 'POST', `/api/users/${reportedUser.orbitId}/report`, body) },
      body,
    }, env)
    expect(res.status).toBe(201)

    // Instant hide for everyone: profile + all owned content.
    const u = await env.DB.prepare('SELECT hidden_at FROM Users WHERE id = ?').bind(reportedUser.orbitId).first<{ hidden_at: string | null }>()
    expect(u?.hidden_at).toBeTruthy()
    const o = await env.DB.prepare('SELECT hidden_at FROM Objects WHERE id = ?').bind('user-sent-obj-1').first<{ hidden_at: string | null }>()
    expect(o?.hidden_at).toBeTruthy()
  })

  it('GET /api/admin/content-reports returns open report with evidence + ban state', async () => {
    const r = await findOpenReport(reportedUser.orbitId)
    expect(r).toBeDefined()
    expect(r.target_type).toBe('user')
    expect(r.status).toBe('open')
    expect(r.category).toBe('spam')
    expect(r.object_id).toBe('report-evidence-obj')
    expect(r.is_hidden).toBe(true)
    expect(r.reported_is_banned).toBe(false)
  })

  it('POST resolve with ban marks resolved + bans user + wipes their content', async () => {
    const r = await findOpenReport(reportedUser.orbitId)
    expect(r).toBeDefined()

    const body = JSON.stringify({ action: 'ban' })
    const res = await app.request(`/api/admin/content-reports/${r.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(adminId, 'POST', `/api/admin/content-reports/${r.id}/resolve`, body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.action).toBe('ban')

    const fresh = await env.DB.prepare('SELECT status, action FROM ContentReports WHERE id = ?').bind(r.id).first<{ status: string; action: string }>()
    expect(fresh?.status).toBe('resolved')
    expect(fresh?.action).toBe('ban')
    const ban = await env.DB.prepare('SELECT 1 FROM Bans WHERE user_id = ?').bind(reportedUser.orbitId).first()
    expect(ban).toBeTruthy()
    // Ban = delete all: the user's objects are gone.
    const obj = await env.DB.prepare('SELECT 1 FROM Objects WHERE id = ?').bind('user-sent-obj-1').first()
    expect(obj).toBeFalsy()
  })

  it('POST resolve with delete removes only the reported content', async () => {
    const objectId = 'delete-me-obj'
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', 1)"
    ).bind(objectId, secondUser.orbitId).run()

    const body = JSON.stringify({ category: 'spam', reason: 'bad post' })
    const rep = await app.request(`/api/posts/${objectId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(regularId, 'POST', `/api/posts/${objectId}/report`, body) },
      body,
    }, env)
    expect(rep.status).toBe(201)

    const r = await findOpenReport(objectId)
    expect(r.target_type).toBe('post')

    const resolveBody = JSON.stringify({ action: 'delete' })
    const res = await app.request(`/api/admin/content-reports/${r.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(adminId, 'POST', `/api/admin/content-reports/${r.id}/resolve`, resolveBody) },
      body: resolveBody,
    }, env)
    expect(res.status).toBe(200)

    const gone = await env.DB.prepare('SELECT 1 FROM Objects WHERE id = ?').bind(objectId).first()
    expect(gone).toBeFalsy()
  })

  it('POST resolve with deny unhides the reported content', async () => {
    const imageId = 'deny-me-lobby-image'
    await env.DB.prepare(
      'INSERT INTO LobbyImages (id, owner_id, content_url) VALUES (?, ?, ?)'
    ).bind(imageId, secondUser.orbitId, 'data:image/jpeg;base64,/9j/4AAQ').run()

    const rep = await app.request(`/api/lobby/images/${imageId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(regularId, 'POST', `/api/lobby/images/${imageId}/report`, '{}') },
      body: '{}',
    }, env)
    expect(rep.status).toBe(201)
    const repJson: any = await rep.json()
    expect(repJson.hidden).toBe(true)

    const r = await findOpenReport(imageId)
    expect(r.target_type).toBe('lobby_image')

    const resolveBody = JSON.stringify({ action: 'deny' })
    const res = await app.request(`/api/admin/content-reports/${r.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(adminId, 'POST', `/api/admin/content-reports/${r.id}/resolve`, resolveBody) },
      body: resolveBody,
    }, env)
    expect(res.status).toBe(200)

    const image = await env.DB.prepare('SELECT hidden_at FROM LobbyImages WHERE id = ?').bind(imageId).first<{ hidden_at: string | null }>()
    expect(image?.hidden_at).toBeFalsy()
    const fresh = await env.DB.prepare('SELECT status, action FROM ContentReports WHERE id = ?').bind(r.id).first<{ status: string; action: string }>()
    expect(fresh?.status).toBe('dismissed')
    expect(fresh?.action).toBe('deny')
  })

  it('GET /api/admin/users/:id/objects lists a user\'s objects', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('intercept-obj-1', reportedUser.orbitId).run()

    const res = await app.request(`/api/admin/users/${reportedUser.orbitId}/objects`, {
      headers: authHeaders(adminId, 'GET', `/api/admin/users/${reportedUser.orbitId}/objects`),
    }, env)
    expect(res.status).toBe(200)
    const objs: any = await res.json()
    const ids = objs.map((o: any) => o.id)
    expect(ids).toContain('intercept-obj-1')
  })
})

describe('Admin API — discord invite settings', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const settingsAdmin = createTestIdentity()
  const settingsRegular = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(settingsAdmin, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(settingsRegular, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(settingsAdmin, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
  })

  it('public GET /api/discord-invite is reachable without auth (null = unset; no seeded link since 1.0.1)', async () => {
    const res = await app.request('/api/discord-invite', {}, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.url).toBeNull() // the bundle ships no community link until an admin sets one
  })

  it('GET /api/admin/settings/discord-invite returns 403 for a non-admin', async () => {
    const res = await app.request('/api/admin/settings/discord-invite', {
      headers: authHeaders(settingsRegular, 'GET', '/api/admin/settings/discord-invite'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('PUT + GET roundtrips the invite URL for an admin', async () => {
    const putBody = JSON.stringify({ url: 'https://discord.gg/WMEz9jgr3' })
    const putRes = await app.request('/api/admin/settings/discord-invite', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(settingsAdmin, 'PUT', '/api/admin/settings/discord-invite', putBody) },
      body: putBody,
    }, env)
    expect(putRes.status).toBe(200)

    const getRes = await app.request('/api/admin/settings/discord-invite', {
      headers: authHeaders(settingsAdmin, 'GET', '/api/admin/settings/discord-invite'),
    }, env)
    const body: any = await getRes.json()
    expect(body.url).toBe('https://discord.gg/WMEz9jgr3')

    const pubRes = await app.request('/api/discord-invite', {}, env)
    const pubBody: any = await pubRes.json()
    expect(pubBody.url).toBe('https://discord.gg/WMEz9jgr3')
  })

  it('PUT rejects a non-http(s) URL', async () => {
    const body = JSON.stringify({ url: 'ftp://invalid' })
    const res = await app.request('/api/admin/settings/discord-invite', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(settingsAdmin, 'PUT', '/api/admin/settings/discord-invite', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('PUT with empty url clears the link (disables JOIN)', async () => {
    const body = JSON.stringify({ url: '' })
    const res = await app.request('/api/admin/settings/discord-invite', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(settingsAdmin, 'PUT', '/api/admin/settings/discord-invite', body) },
      body,
    }, env)
    expect(res.status).toBe(200)

    const pubRes = await app.request('/api/discord-invite', {}, env)
    const pubBody: any = await pubRes.json()
    expect(pubBody.url).toBeNull()
  })
})

describe('Admin API — Lobby Images & Matches Moderation', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const modAdmin = createTestIdentity()
  const modUser = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(modAdmin, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(modUser, 'GET', '/api/users') }, env)
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(modAdmin, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, { ...env, ADMIN_PIN: 'test-pin' })
  })

  it('GET /api/admin/lobby-images and DELETE /api/admin/lobby-images/:id', async () => {
    await env.DB.prepare(
      "INSERT INTO LobbyImages (id, owner_id, content_url, caption, likes_count, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind('lobby-img-1', modUser.orbitId, 'data:image/jpeg;base64,/9j/4AAQ', 'Test lobby board', 5, new Date().toISOString()).run()

    const listRes = await app.request('/api/admin/lobby-images', {
      headers: authHeaders(modAdmin, 'GET', '/api/admin/lobby-images'),
    }, env)
    expect(listRes.status).toBe(200)
    const list: any = await listRes.json()
    expect(Array.isArray(list)).toBe(true)
    const item = list.find((i: any) => i.id === 'lobby-img-1')
    expect(item).toBeDefined()
    expect(item.caption).toBe('Test lobby board')

    const delRes = await app.request('/api/admin/lobby-images/lobby-img-1', {
      method: 'DELETE',
      headers: authHeaders(modAdmin, 'DELETE', '/api/admin/lobby-images/lobby-img-1'),
    }, env)
    expect(delRes.status).toBe(200)

    const after = await env.DB.prepare('SELECT 1 FROM LobbyImages WHERE id = ?').bind('lobby-img-1').first()
    expect(after).toBeFalsy()
  })

  it('DELETE /api/admin/matches/:id cancels an active match', async () => {
    await env.DB.prepare(
      "INSERT INTO GameMatches (id, user_a, user_b, status, phase, phase_deadline, created_at) VALUES (?, ?, ?, 'playing', 'pick', ?, ?)"
    ).bind('test-match-mod', modAdmin.orbitId, modUser.orbitId, Date.now() + 60000, new Date().toISOString()).run()

    const delRes = await app.request('/api/admin/matches/test-match-mod', {
      method: 'DELETE',
      headers: authHeaders(modAdmin, 'DELETE', '/api/admin/matches/test-match-mod'),
    }, env)
    expect(delRes.status).toBe(200)

    const match = await env.DB.prepare('SELECT status, result FROM GameMatches WHERE id = ?').bind('test-match-mod').first<any>()
    expect(match.status).toBe('ended')
    expect(match.result).toBe('admin_cancelled')
  })
})
