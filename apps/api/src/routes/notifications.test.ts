import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let inviter: TestIdentity
let invitee: TestIdentity
let offline: TestIdentity
let noCards: TestIdentity
let acceptor: TestIdentity
let decliner: TestIdentity
let declineInviter: TestIdentity

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return {
    'Content-Type': 'application/json',
    ...signRequestHeaders(identity, method, url, body),
  }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

let seedCounter = 100
async function seedObjectFor(identity: TestIdentity): Promise<string> {
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, seedCounter++ & 0xFF])
  const form = new FormData()
  form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'card.jpg')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: { ...signRequestHeaders(identity, 'POST', '/api/objects', '') },
    body: form,
  }, env)
  const body: any = await res.json()
  return body.id
}

async function touchOnline(identity: TestIdentity) {
  await app.request('/api/users/ping', { method: 'POST', headers: auth(identity, 'POST', '/api/users/ping') }, env)
}

describe('Notifications + Match Invites API', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    inviter = createTestIdentity()
    invitee = createTestIdentity()
    offline = createTestIdentity()
    noCards = createTestIdentity()
    acceptor = createTestIdentity()
    decliner = createTestIdentity()
    declineInviter = createTestIdentity()
    for (const id of [inviter, invitee, offline, noCards, acceptor, decliner, declineInviter]) await register(id)
    // inviter/acceptor/decliner/declineInviter each own enough cards to pass
    // the MIN_GAME_CARDS gate; inviter + invitee are "online"
    for (const id of [inviter, acceptor, decliner, declineInviter]) {
      for (let i = 0; i < 5; i++) await seedObjectFor(id)
    }
    await touchOnline(inviter)
    await touchOnline(invitee)
    await touchOnline(acceptor)
    await touchOnline(decliner)
    await touchOnline(declineInviter)
    // The offline user never pings; age their last_seen so the online gate in
    // createMatchInvite treats them as offline.
    await env.DB.prepare('UPDATE Users SET last_seen = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3600_000).toISOString(), offline.orbitId)
      .run()
  })

  it('GET /api/notifications requires auth', async () => {
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(401)
  })

  it('returns an empty notification list initially', async () => {
    const res = await app.request('/api/notifications', { headers: auth(invitee, 'GET', '/api/notifications') }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body.notifications)).toBe(true)
    expect(body.notifications.length).toBe(0)
    expect(body.unread).toBe(0)
  })

  it('rejects a self-challenge', async () => {
    const body = JSON.stringify({ invitee_id: inviter.orbitId })
    const res = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('rejects challenging an offline player', async () => {
    const body = JSON.stringify({ invitee_id: offline.orbitId })
    const res = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    expect(res.status).toBe(409)
  })

  it('rejects a challenge from a user with no cards', async () => {
    const body = JSON.stringify({ invitee_id: invitee.orbitId })
    const res = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(noCards, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('creates an open match invite', async () => {
    const body = JSON.stringify({ invitee_id: invitee.orbitId })
    const res = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    expect(res.status).toBe(201)
    const data: any = await res.json()
    expect(data.invite).toBeTruthy()
    expect(data.invite.inviter_id).toBe(inviter.orbitId)
    expect(data.invite.invitee_id).toBe(invitee.orbitId)
    expect(data.invite.status).toBe('open')
    expect(data.invite.expires_at).toBeTruthy()
    expect(new Date(data.invite.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(30_000)
    expect(new Date(data.invite.expires_at).getTime() - Date.now()).toBeGreaterThan(28_000)
  })

  it('is idempotent on re-invite while open', async () => {
    const body = JSON.stringify({ invitee_id: invitee.orbitId })
    const a = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    const aData: any = await a.json()
    const b = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    const bData: any = await b.json()
    expect(aData.invite.id).toBe(bData.invite.id)
  })

  it('lists the invite in the invitee inbox', async () => {
    const res = await app.request('/api/lobby/invites', { headers: auth(invitee, 'GET', '/api/lobby/invites') }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body.invites)).toBe(true)
    expect(body.invites.some((i: any) => i.inviter_id === inviter.orbitId && i.status === 'open')).toBe(true)
  })

  it('creates a persistent notification for the invitee', async () => {
    const res = await app.request('/api/notifications', { headers: auth(invitee, 'GET', '/api/notifications') }, env)
    const body: any = await res.json()
    const inviteNotif = body.notifications.find((n: any) => n.type === 'match_invite')
    expect(inviteNotif).toBeTruthy()
    expect(body.unread).toBeGreaterThanOrEqual(1)
  })

  it('marks notifications read', async () => {
    const list = await app.request('/api/notifications', { headers: auth(invitee, 'GET', '/api/notifications') }, env)
    const body: any = await list.json()
    const ids = body.notifications.map((n: any) => n.id)
    const res = await app.request('/api/notifications/read', {
      method: 'POST',
      headers: auth(invitee, 'POST', '/api/notifications/read', JSON.stringify({ ids })),
      body: JSON.stringify({ ids }),
    }, env)
    expect(res.status).toBe(200)
    const after = await app.request('/api/notifications', { headers: auth(invitee, 'GET', '/api/notifications') }, env)
    const afterBody: any = await after.json()
    expect(afterBody.unread).toBe(0)
  })

  it('accepts the invite and creates a direct match', async () => {
    const body = JSON.stringify({ invitee_id: acceptor.orbitId })
    const inv = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(inviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    const invData: any = await inv.json()
    const inviteId = invData.invite.id

    // A fresh acceptor identity who is NOT the invitee gets 403.
    const intruder = createTestIdentity()
    await register(intruder)
    await touchOnline(intruder)
    const bad = await app.request(`/api/lobby/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: auth(intruder, 'POST', `/api/lobby/invites/${inviteId}/accept`),
    }, env)
    expect(bad.status).toBe(403)

    const res = await app.request(`/api/lobby/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: auth(acceptor, 'POST', `/api/lobby/invites/${inviteId}/accept`),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
    expect(typeof data.match_id).toBe('string')

    // The match now exists between inviter and acceptor.
    const state = await app.request('/api/lobby', { headers: auth(inviter, 'GET', '/api/lobby') }, env)
    const stateBody: any = await state.json()
    expect(stateBody.players.some((p: any) => p.user_id === inviter.orbitId && p.status === 'in_match')).toBe(true)
  })

  it('declines an invite', async () => {
    const body = JSON.stringify({ invitee_id: decliner.orbitId })
    const inv = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(declineInviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    const invData: any = await inv.json()
    const inviteId = invData.invite.id
    const res = await app.request(`/api/lobby/invites/${inviteId}/decline`, {
      method: 'POST',
      headers: auth(decliner, 'POST', `/api/lobby/invites/${inviteId}/decline`),
    }, env)
    expect(res.status).toBe(200)
    const after = await app.request('/api/lobby/invites', { headers: auth(decliner, 'GET', '/api/lobby/invites') }, env)
    const afterBody: any = await after.json()
    const declined = afterBody.invites.find((i: any) => i.id === inviteId)
    expect(declined.status).toBe('declined')
  })

  it('does not allow accepting an already-declined invite', async () => {
    const body = JSON.stringify({ invitee_id: decliner.orbitId })
    const inv = await app.request('/api/lobby/invites', {
      method: 'POST',
      headers: auth(declineInviter, 'POST', '/api/lobby/invites', body),
      body,
    }, env)
    const invData: any = await inv.json()
    const inviteId = invData.invite.id
    await app.request(`/api/lobby/invites/${inviteId}/decline`, {
      method: 'POST',
      headers: auth(decliner, 'POST', `/api/lobby/invites/${inviteId}/decline`),
    }, env)
    const res = await app.request(`/api/lobby/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: auth(decliner, 'POST', `/api/lobby/invites/${inviteId}/accept`),
    }, env)
    expect(res.status).toBe(409)
  })
})
