import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const adminId = createTestIdentity()
const playerA = createTestIdentity()
const playerB = createTestIdentity()
const playerC = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function register(identity: ReturnType<typeof createTestIdentity>) {
  const res = await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
  expect(res.status).toBe(200)
}

async function grantAdmin(identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/admin/verify-pin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(identity, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
    },
    body: JSON.stringify({ pin: 'test-pin' }),
  }, { ...env, ADMIN_PIN: 'test-pin' })
}

let objectCounter = 0
async function seedCards(identity: ReturnType<typeof createTestIdentity>, count = 5) {
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story, is_public) VALUES (?, ?, 1000, ?, 0, 0)'
    ).bind(`obj-${identity.publicKeyHex}-${objectCounter++}`, identity.orbitId, 'image/jpeg').run()
  }
}

let env: Awaited<ReturnType<typeof createMockEnv>>

describe('Admin API — force-match all humans (no bots)', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    await register(adminId)
    await grantAdmin(adminId)
    await register(playerA)
    await register(playerB)
    await register(playerC)
    await seedCards(playerA)
    await seedCards(playerB)
    await seedCards(playerC)
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM GameMatches').run()
    await env.DB.prepare('DELETE FROM LobbyPlayers').run()
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await app.request('/api/admin/matches/force-all', {
      method: 'POST',
      headers: authHeaders(playerA, 'POST', '/api/admin/matches/force-all'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('queues all eligible humans and pairs them up without bots', async () => {
    const res = await app.request('/api/admin/matches/force-all', {
      method: 'POST',
      headers: authHeaders(adminId, 'POST', '/api/admin/matches/force-all'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
    expect(body.summary.totalHumansOnline).toBeGreaterThanOrEqual(2)
    expect(body.summary.matchesCreated).toBeGreaterThanOrEqual(1)

    // No bot in any created match.
    for (const m of body.matches) {
      expect(m.user_a).not.toMatch(/^bot_/)
      expect(m.user_b).not.toMatch(/^bot_/)
    }

    // Both players are marked in_match, not left waiting.
    const row = await env.DB.prepare("SELECT status FROM LobbyPlayers WHERE user_id = ?").bind(playerA.orbitId).first<any>()
    expect(row?.status).toBe('in_match')
  })

  it('leaves an odd player waiting and never pairs them with a bot', async () => {
    // Only make two of the three players eligible: give playerC a stale last_seen.
    await env.DB.prepare('UPDATE Users SET last_seen = ? WHERE id = ?')
      .bind(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), playerC.orbitId)
      .run()

    const res = await app.request('/api/admin/matches/force-all', {
      method: 'POST',
      headers: authHeaders(adminId, 'POST', '/api/admin/matches/force-all'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
    expect(body.summary.newlyQueued).toBe(2)
    expect(body.summary.unpairedPlayer).toBeNull()

    const waiting = await env.DB.prepare("SELECT user_id FROM LobbyPlayers WHERE status = 'waiting'").all<any>()
    const botInQueue = (waiting.results || []).some((p) => String(p.user_id).startsWith('bot_'))
    expect(botInQueue).toBe(false)

    // Restore playerC's freshness for later tests.
    await env.DB.prepare('UPDATE Users SET last_seen = ? WHERE id = ?')
      .bind(new Date().toISOString(), playerC.orbitId)
      .run()
  })

  it('skips players already locked in an active match', async () => {
    await env.DB.prepare(
      "INSERT INTO GameMatches (id, user_a, user_b, status, phase, phase_deadline, created_at) VALUES (?, ?, ?, 'lobby', 'lobby', ?, ?)"
    ).bind('active-1', playerA.orbitId, playerB.orbitId, Date.now() + 60000, new Date().toISOString()).run()
    await env.DB.prepare("UPDATE LobbyPlayers SET status = 'in_match' WHERE user_id IN (?, ?)")
      .bind(playerA.orbitId, playerB.orbitId)
      .run()

    const res = await app.request('/api/admin/matches/force-all', {
      method: 'POST',
      headers: authHeaders(adminId, 'POST', '/api/admin/matches/force-all'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.summary.alreadyInMatch).toBeGreaterThanOrEqual(2)
    // Neither in-match player should be re-queued.
    expect(body.summary.newlyQueued).toBeLessThanOrEqual(1)
  })
})