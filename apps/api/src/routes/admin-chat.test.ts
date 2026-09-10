import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'
import { encryptText } from '../crypto'

let env: Awaited<ReturnType<typeof createMockEnv>>
let admin: TestIdentity
let alice: TestIdentity
let bob: TestIdentity

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return {
    'Content-Type': 'application/json',
    ...signRequestHeaders(identity, method, url, body),
  }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

async function grantAdmin(identity: TestIdentity) {
  await app.request('/api/admin/verify-pin', {
    method: 'POST',
    headers: auth(identity, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
    body: JSON.stringify({ pin: 'test-pin' }),
  }, { ...env, ADMIN_PIN: 'test-pin' })
}

async function get(path: string) {
  const pathname = path.split('?')[0]
  const res = await app.request(path, { headers: auth(admin, 'GET', pathname) }, env)
  return { res, body: await res.json() as Array<Record<string, unknown>> }
}

async function del(path: string) {
  const pathname = path.split('?')[0]
  const res = await app.request(path, { method: 'DELETE', headers: auth(admin, 'DELETE', pathname) }, env)
  return { res, body: await res.json() as Record<string, unknown> }
}

describe('Admin chat moderation — /chat/messages', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    admin = createTestIdentity()
    alice = createTestIdentity()
    bob = createTestIdentity()
    for (const id of [admin, alice, bob]) await register(id)
    await grantAdmin(admin)

    await env.DB.prepare(
      "INSERT INTO LobbyChat (id, sender_id, sender_name, body, created_at, channel) VALUES (?, ?, ?, ?, ?, 'global_lobby')"
    ).bind('lobby-1', alice.orbitId, 'Alice Alice', 'hello lobby', '2026-01-01T00:00:00Z').run()
    await env.DB.prepare(
      "INSERT INTO LobbyChat (id, sender_id, sender_name, body, created_at, channel) VALUES (?, ?, ?, ?, ?, 'card_queue')"
    ).bind('lobby-2', bob.orbitId, 'Bob Bob', 'queue chat ping', '2026-01-01T00:00:01Z').run()

    await env.DB.prepare(
      'INSERT INTO MatchChat (id, match_id, sender_id, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('match-1', 'match-000', alice.orbitId, 'Alice Alice', 'in match chat', '2026-01-01T00:00:02Z').run()

    await env.DB.prepare('INSERT INTO ChatGroups (id, name, owner_id) VALUES (?, ?, ?)')
      .bind('group-1', 'The Crew', alice.orbitId).run()
    await env.DB.prepare(
      'INSERT INTO GroupMessages (id, group_id, sender_id, body, reply_to, attachment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('gm-1', 'group-1', bob.orbitId, 'group chat hello', null, null, '2026-01-01T00:00:03Z').run()

    await env.DB.prepare(
      'INSERT INTO PrivateMessages (id, sender_id, recipient_id, body, reply_to, attachment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('pm-1', alice.orbitId, bob.orbitId, encryptText('secret dm'), null, null, '2026-01-01T00:00:04Z').run()
  })

  it('returns lobby, match and group messages when channel=all — NEVER dms (privacy basis)', async () => {
    const { res, body } = await get('/api/admin/chat/messages?channel=all&limit=50')
    expect(res.status).toBe(200)
    const channels = body.map((m) => m.channel)
    expect(channels).toContain('lobby')
    expect(channels).not.toContain('dm')
    expect(channels).toContain('match')
    expect(channels).toContain('group')

    const lobby = body.find((m) => m.id === 'lobby-1')
    expect(lobby).toBeDefined()
    expect(lobby!.body).toBe('hello lobby')
    expect(lobby!.sender_name).toBe('Alice Alice')

    // The seeded DM must never surface here.
    expect(body.find((m) => m.id === 'pm-1')).toBeUndefined()
  })

  it('lobby filter returns only global_lobby messages and excludes card_queue', async () => {
    const { body } = await get('/api/admin/chat/messages?channel=lobby&limit=50')
    expect(body.length).toBe(1)
    expect(body[0].id).toBe('lobby-1')
  })

  it('channel=dm yields nothing — bulk DM reads are removed by design', async () => {
    const { res, body } = await get('/api/admin/chat/messages?channel=dm&limit=50')
    expect(res.status).toBe(200)
    expect(body.length).toBe(0)
    // And the dedicated bulk endpoint is gone entirely.
    const gone = await app.request('/api/admin/private-messages', {
      headers: auth(admin, 'GET', '/api/admin/private-messages'),
    }, env)
    expect(gone.status).toBe(404)
  })

  it('match filter returns only match chat', async () => {
    const { body } = await get('/api/admin/chat/messages?channel=match&limit=50')
    expect(body.length).toBe(1)
    expect(body[0].channel).toBe('match')
    expect(body[0].id).toBe('match-1')
  })

  it('group filter returns only group chat', async () => {
    const { body } = await get('/api/admin/chat/messages?channel=group&limit=50')
    expect(body.length).toBe(1)
    expect(body[0].channel).toBe('group')
    expect(body[0].recipient_name).toBe('The Crew')
  })

  it('searches by message body across channels', async () => {
    const { body } = await get('/api/admin/chat/messages?channel=all&q=hello&limit=50')
    const bodies = body.map((m) => String(m.body || '').toLowerCase())
    expect(bodies.some((b) => b.includes('hello'))).toBe(true)
    expect(body.some((m) => m.body === 'secret dm')).toBe(false)
  })

  it('deletes a lobby message via DELETE /chat/messages/:channel/:id', async () => {
    const { res } = await del('/api/admin/chat/messages/lobby/lobby-2')
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT 1 FROM LobbyChat WHERE id = ?').bind('lobby-2').first()
    expect(row).toBeNull()
    const { body } = await get('/api/admin/chat/messages?channel=lobby&limit=50')
    expect(body.some((m) => m.id === 'lobby-2')).toBe(false)
  })

  it('deletes a dm message by soft-deleting it', async () => {
    const { res } = await del('/api/admin/chat/messages/dm/pm-1')
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT deleted_by FROM PrivateMessages WHERE id = ?').bind('pm-1').first<{ deleted_by: string | null }>()
    expect(row?.deleted_by).toBe(admin.orbitId)
  })

  it('rejects non-admin access with 403', async () => {
    const pathname = '/api/admin/chat/messages'
    const res = await app.request(pathname, { headers: auth(alice, 'GET', pathname) }, env)
    expect(res.status).toBe(403)
  })
})
