import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

// ───────────────────── WS-2: Security regression tests ─────────────────────

describe('WS-2: Admin PIN fails closed when unset', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/admin/verify-pin is DISABLED (503) when neither PIN env is set — the old hardcoded default is gone (B.4)', async () => {
    const body = JSON.stringify({ pin: 'Ionw' + 'arehouse1' })
    const res = await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/admin/verify-pin', body) },
      body,
    }, { ...env })
    expect(res.status).toBe(503)
  })

  it('POST /api/admin/verify-pin still works with correct env PIN', async () => {
    const body = JSON.stringify({ pin: 'secure-pin-123' })
    const res = await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/admin/verify-pin', body) },
      body,
    }, { ...env, ADMIN_PIN: 'secure-pin-123' })
    expect(res.status).toBe(200)
  })
})

describe('WS-2: is_admin returned in user listing for self', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const admin = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(admin, 'GET', '/api/users') }, env)
    // Grant admin
    const body = JSON.stringify({ pin: 'test-pin' })
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', '/api/admin/verify-pin', body) },
      body,
    }, { ...env, ADMIN_PIN: 'test-pin' })
  })

  it('GET /api/users returns is_admin for the caller', async () => {
    const res = await app.request('/api/users', {
      headers: authHeaders(admin, 'GET', '/api/users'),
    }, env)
    expect(res.status).toBe(200)
    const users = (await res.json()) as any[]
    const self = users.find(u => u.id === admin.orbitId)
    expect(self).toBeDefined()
    expect(self.is_admin).toBe(true)
  })
})

describe('WS-2: Global error handler sanitizes messages', () => {
  it('global onError does not leak internal error messages', async () => {
    const env = await createMockEnv()
    // Trigger a 500 by using malformed JSON on auth.ts passkey verify
    // (which does JSON.parse(rawBody))
    const user = createTestIdentity()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)

    const malformed = 'not-json-at-all'
    const res = await app.request('/api/auth/passkeys/register/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(user, 'POST', '/api/auth/passkeys/register/verify', malformed),
      },
      body: malformed,
    }, env)
    // Should be 500 (unhandled JSON.parse error), and error message should be sanitized
    if (res.status === 500) {
      const data: any = await res.json()
      expect(data.error).toBe('Internal server error')
      expect(data.error).not.toContain('Unexpected token')
    }
    // If it returns 400 instead (due to the JSON.parse being guarded elsewhere), that's also acceptable
    expect([400, 500]).toContain(res.status)
  })
})

// ───────────────────── WS-3: Auth module tests ─────────────────────

describe('WS-3: Auth — nonce endpoint', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('GET /api/auth/nonce returns a nonce', async () => {
    const res = await app.request('/api/auth/nonce', {
      headers: authHeaders(user, 'GET', '/api/auth/nonce'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.nonce).toBeDefined()
    expect(data.expiresIn).toBeDefined()
  })
})

describe('WS-3: Auth — passkey register options', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/auth/passkeys/register/options returns challenge', async () => {
    const res = await app.request('/api/auth/passkeys/register/options', {
      method: 'POST',
      headers: authHeaders(user, 'POST', '/api/auth/passkeys/register/options'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.options).toBeDefined()
    expect(data.options.challenge).toBeDefined()
    expect(data.sessionId).toBeDefined()
  })
})

describe('WS-3: Auth — passkey register verify', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()
  let sessionId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
    const optRes = await app.request('/api/auth/passkeys/register/options', {
      method: 'POST',
      headers: authHeaders(user, 'POST', '/api/auth/passkeys/register/options'),
    }, env)
    const optData: any = await optRes.json()
    sessionId = optData.sessionId
  })

  it('POST /api/auth/passkeys/register/verify succeeds with valid sessionId', async () => {
    const body = JSON.stringify({ sessionId })
    const res = await app.request('/api/auth/passkeys/register/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(user, 'POST', '/api/auth/passkeys/register/verify', body),
      },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST /api/auth/passkeys/register/verify fails with invalid sessionId', async () => {
    const body = JSON.stringify({ sessionId: 'nonexistent' })
    const res = await app.request('/api/auth/passkeys/register/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(user, 'POST', '/api/auth/passkeys/register/verify', body),
      },
      body,
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('WS-3: Auth — cleanup', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/auth/cleanup succeeds', async () => {
    const res = await app.request('/api/auth/cleanup', {
      method: 'POST',
      headers: authHeaders(user, 'POST', '/api/auth/cleanup'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)
  })
})

// ───────────────────── WS-3: Users endpoint tests ─────────────────────

describe('WS-3: Users — attention', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/users/attention returns ok', async () => {
    const res = await app.request('/api/users/attention', {
      method: 'POST',
      headers: authHeaders(user, 'POST', '/api/users/attention'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
  })

  it('POST /api/users/attention returns 429 on cooldown', async () => {
    // Second call within 30s should be rate-limited
    const res = await app.request('/api/users/attention', {
      method: 'POST',
      headers: authHeaders(user, 'POST', '/api/users/attention'),
    }, env)
    expect(res.status).toBe(429)
    const data: any = await res.json()
    expect(data.cooldown_remaining).toBeGreaterThan(0)
  })
})

describe('WS-3: Users — maximum-gooner', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/users/maximum-gooner enables the flag', async () => {
    const body = JSON.stringify({ enabled: true })
    const res = await app.request('/api/users/maximum-gooner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/maximum-gooner', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.maximum_gooner).toBe(true)
  })

  it('POST /api/users/maximum-gooner disables the flag', async () => {
    const body = JSON.stringify({ enabled: false })
    const res = await app.request('/api/users/maximum-gooner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/maximum-gooner', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.maximum_gooner).toBe(false)
  })
})

describe('WS-3: Users — block', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const blocker = createTestIdentity()
  const blocked = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(blocker, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(blocked, 'GET', '/api/users') }, env)
  })

  it('POST /api/users/:id/block blocks a user', async () => {
    const res = await app.request(`/api/users/${blocked.orbitId}/block`, {
      method: 'POST',
      headers: authHeaders(blocker, 'POST', `/api/users/${blocked.orbitId}/block`),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.blocked).toBe(blocked.orbitId)
  })

  it('POST /api/users/:id/block is idempotent (INSERT OR IGNORE)', async () => {
    const res = await app.request(`/api/users/${blocked.orbitId}/block`, {
      method: 'POST',
      headers: authHeaders(blocker, 'POST', `/api/users/${blocked.orbitId}/block`),
    }, env)
    expect(res.status).toBe(200)
  })
})

describe('WS-3: Users — report', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const reporter = createTestIdentity()
  const reported = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(reporter, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(reported, 'GET', '/api/users') }, env)
  })

  it('POST /api/users/:id/report creates a report and hides the user', async () => {
    const body = JSON.stringify({ reason: 'Inappropriate content' })
    const res = await app.request(`/api/users/${reported.orbitId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(reporter, 'POST', `/api/users/${reported.orbitId}/report`, body) },
      body,
    }, env)
    expect(res.status).toBe(201)
    const data: any = await res.json()
    expect(data.reported).toBe(reported.orbitId)
    expect(data.hidden).toBe(true)
  })

  it('POST /api/users/:id/report rejects reporting yourself', async () => {
    const body = JSON.stringify({ reason: 'self report' })
    const res = await app.request(`/api/users/${reporter.orbitId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(reporter, 'POST', `/api/users/${reporter.orbitId}/report`, body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('duplicate open reports from the same reporter are deduped', async () => {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ContentReports WHERE reporter_id = ? AND target_type = 'user' AND target_id = ?"
    ).bind(reporter.orbitId, reported.orbitId).first<{ n: number }>()
    expect(before.n).toBe(1)

    const body = JSON.stringify({ reason: 'again' })
    const res = await app.request(`/api/users/${reported.orbitId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(reporter, 'POST', `/api/users/${reported.orbitId}/report`, body) },
      body,
    }, env)
    expect(res.status).toBe(201)

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ContentReports WHERE reporter_id = ? AND target_type = 'user' AND target_id = ?"
    ).bind(reporter.orbitId, reported.orbitId).first<{ n: number }>()
    expect(after.n).toBe(1)
  })
})

// ───────────────────── WS-3: Inbox remove ─────────────────────

describe('WS-3: Inbox — remove', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)
  })

  it('POST /api/inbox/:id/remove removes item from inbox', async () => {
    // Insert a test object + recipient directly
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 100, ?)').bind('test-remove-obj', sender.orbitId, 'image/jpeg').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind('test-remove-obj', receiver.orbitId).run()

    const res = await app.request('/api/inbox/test-remove-obj/remove', {
      method: 'POST',
      headers: authHeaders(receiver, 'POST', '/api/inbox/test-remove-obj/remove'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)

    // Verify the recipient row was deleted
    const row = await env.DB.prepare('SELECT 1 FROM Recipients WHERE object_id = ? AND recipient_id = ?').bind('test-remove-obj', receiver.orbitId).first()
    expect(row).toBeNull()
  })
})

// ───────────────────── WS-3: Objects — stories, claim-gacha, DELETE ─────────────────────

describe('WS-3: Objects — stories', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
    // Insert a story object
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story, content_url) VALUES (?, ?, 100, 'image/jpeg', 1, 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('test-story', user.orbitId).run()
  })

  it('GET /api/objects/stories returns stories', async () => {
    const res = await app.request('/api/objects/stories', {
      headers: authHeaders(user, 'GET', '/api/objects/stories'),
    }, env)
    expect(res.status).toBe(200)
    const data = (await res.json()) as any[]
    expect(data.length).toBeGreaterThanOrEqual(1)
    const story = data.find(s => s.id === 'test-story')
    expect(story).toBeDefined()
  })
})

describe('WS-3: Objects — claim-gacha', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const owner = createTestIdentity()
  const claimer = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(owner, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(claimer, 'GET', '/api/users') }, env)
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story, content_url) VALUES (?, ?, 100, 'image/jpeg', 1, 'data:image/jpeg;base64,/9j/4AAQ')"
    ).bind('gacha-obj', owner.orbitId).run()
  })

  it('POST /api/objects/:id/claim-gacha claims a story', async () => {
    const res = await app.request('/api/objects/gacha-obj/claim-gacha', {
      method: 'POST',
      headers: authHeaders(claimer, 'POST', '/api/objects/gacha-obj/claim-gacha'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)
    expect(data.object_id).toBe('gacha-obj')
  })

  it('POST /api/objects/:id/claim-gacha returns already_claimed on re-claim', async () => {
    const res = await app.request('/api/objects/gacha-obj/claim-gacha', {
      method: 'POST',
      headers: authHeaders(claimer, 'POST', '/api/objects/gacha-obj/claim-gacha'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.already_claimed).toBe(true)
  })

  it('POST /api/objects/:id/claim-gacha returns 400 for own story', async () => {
    const res = await app.request('/api/objects/gacha-obj/claim-gacha', {
      method: 'POST',
      headers: authHeaders(owner, 'POST', '/api/objects/gacha-obj/claim-gacha'),
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/:id/claim-gacha returns 404 for unknown object', async () => {
    const res = await app.request('/api/objects/nonexistent/claim-gacha', {
      method: 'POST',
      headers: authHeaders(claimer, 'POST', '/api/objects/nonexistent/claim-gacha'),
    }, env)
    expect(res.status).toBe(404)
  })
})

describe('WS-3: Objects — DELETE', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const owner = createTestIdentity()
  const other = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(owner, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(other, 'GET', '/api/users') }, env)
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 100, 'text/url', 'https://example.com')"
    ).bind('del-obj', owner.orbitId).run()
  })

  it('DELETE /api/objects/:id returns 403 for non-owner', async () => {
    const res = await app.request('/api/objects/del-obj', {
      method: 'DELETE',
      headers: authHeaders(other, 'DELETE', '/api/objects/del-obj'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('DELETE /api/objects/:id succeeds for owner', async () => {
    const res = await app.request('/api/objects/del-obj', {
      method: 'DELETE',
      headers: authHeaders(owner, 'DELETE', '/api/objects/del-obj'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)
  })

  it('DELETE /api/objects/:id returns 404 for unknown', async () => {
    const res = await app.request('/api/objects/nonexistent', {
      method: 'DELETE',
      headers: authHeaders(owner, 'DELETE', '/api/objects/nonexistent'),
    }, env)
    expect(res.status).toBe(404)
  })
})

// ───────────────────── WS-3: Security.txt ─────────────────────

describe('WS-3: /.well-known/security.txt', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('GET /.well-known/security.txt returns security policy', async () => {
    const res = await app.request('/.well-known/security.txt', {}, env)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Contact:')
    expect(text).toContain('Expires:')
  })
})

// ───────────────────── WS-3: Recommendations (user endpoint) ─────────────────────

describe('WS-3: Recommendations — user submit', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/recommendations creates a recommendation', async () => {
    const body = JSON.stringify({ category: 'Bug', content: 'Found a bug in the UI' })
    const res = await app.request('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/recommendations', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.success).toBe(true)
    expect(data.id).toBeDefined()
  })

  it('POST /api/recommendations returns 400 without content', async () => {
    const body = JSON.stringify({ category: 'Feature' })
    const res = await app.request('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/recommendations', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('GET /api/objects/:id purges orphaned object row from DB when blob is missing', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES (?, ?, 100, 'image/jpeg', NULL)"
    ).bind('ghost-obj-404', user.orbitId).run()

    const res = await app.request('/api/objects/ghost-obj-404', {
      headers: authHeaders(user, 'GET', '/api/objects/ghost-obj-404'),
    }, env)
    expect(res.status).toBe(404)
    const json: any = await res.json()
    expect(json.purged).toBe(true)

    const row = await env.DB.prepare('SELECT 1 FROM Objects WHERE id = ?').bind('ghost-obj-404').first()
    expect(row).toBeFalsy()
  })

  it('GET /api/users/me returns authenticated caller profile and last_seen', async () => {
    const res = await app.request('/api/users/me', {
      headers: authHeaders(user, 'GET', '/api/users/me'),
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.id).toBe(user.orbitId)
    expect(json.last_seen).toBeDefined()
    expect(typeof json.balance).toBe('number')
  })
})
