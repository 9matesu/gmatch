import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { EconomyService } from '../economy'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('admin user adjustment (metric-specific)', () => {
  const admin = createTestIdentity()
  const target = createTestIdentity()
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(admin, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(target, 'GET', '/api/users') }, env)

    const pin = 'admin-adjust-pin'
    const pinBody = JSON.stringify({ pin })
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', '/api/admin/verify-pin', pinBody) },
      body: pinBody,
    }, { ...env, ADMIN_PIN: pin })
  })

  it('adds reputation and routes g$ through the economy with a ledger', async () => {
    const body = JSON.stringify({ add_reputation: 50, add_gcoins: 100 })
    const res = await app.request(`/api/admin/users/${target.orbitId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', `/api/admin/users/${target.orbitId}/adjust`, body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.user.reputation).toBe(50)
    expect(data.user.balance).toBe(100)

    const economy = new EconomyService(env.DB)
    await expect(economy.getBalance(target.orbitId)).resolves.toBe(100)

    const ledger = await env.DB.prepare('SELECT COUNT(*) AS n FROM LedgerTransactions WHERE user_id = ?').bind(target.orbitId).first<{ n: number }>()
    expect(Number(ledger?.n || 0)).toBe(1)

    const rep = await env.DB.prepare('SELECT score_total FROM Users WHERE id = ?').bind(target.orbitId).first<{ score_total: number }>()
    expect(Number(rep?.score_total || 0)).toBe(50)
  })

  it('rejects a wallet debit adjustment that would overdraw', async () => {
    const body = JSON.stringify({ add_gcoins: -1000 })
    const res = await app.request(`/api/admin/users/${target.orbitId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', `/api/admin/users/${target.orbitId}/adjust`, body) },
      body,
    }, env)
    expect(res.status).toBe(409)
  })

  it('a refused wallet debit leaves NO half-applied adjustment behind', async () => {
    // The Users row used to be updated BEFORE the wallet debit, so a 409
    // "Insufficient wallet funds" was a lie: the score and the admin flag had
    // already been committed. The wallet is the fallible half and runs first.
    const before = await env.DB.prepare('SELECT score, score_total, is_moderator FROM Users WHERE id = ?')
      .bind(target.orbitId).first<{ score: number; score_total: number; is_moderator: number }>()

    const body = JSON.stringify({ add_score: 25, add_reputation: 25, is_moderator: true, add_gcoins: -1000 })
    const res = await app.request(`/api/admin/users/${target.orbitId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', `/api/admin/users/${target.orbitId}/adjust`, body) },
      body,
    }, env)
    expect(res.status).toBe(409)

    const after = await env.DB.prepare('SELECT score, score_total, is_moderator FROM Users WHERE id = ?')
      .bind(target.orbitId).first<{ score: number; score_total: number; is_moderator: number }>()
    expect(Number(after?.score || 0)).toBe(Number(before?.score || 0))
    expect(Number(after?.score_total || 0)).toBe(Number(before?.score_total || 0))
    expect(Number(after?.is_moderator || 0)).toBe(Number(before?.is_moderator || 0))
  })

  it('exposes wallet balance and score in the admin users list', async () => {
    const res = await app.request('/api/admin/users', { headers: authHeaders(admin, 'GET', '/api/admin/users') }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    const row = data.find((u: any) => u.id === target.orbitId)
    expect(row).toBeDefined()
    expect(row.balance).toBe(100)
    expect(typeof row.score).toBe('number')
    expect(row.followers_count).toBe(0)
  })

  it('cannot fabricate a follower count — the number is a COUNT(*) over Followers', async () => {
    // The admin panel used to EDIT Users.followers_count, a column no public
    // read path used. A typed-in number could never be true, so the field is
    // gone and the list derives the count from the Followers table.
    await env.DB.prepare('INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)')
      .bind('someone-else', target.orbitId).run()

    const listRes = await app.request('/api/admin/users', { headers: authHeaders(admin, 'GET', '/api/admin/users') }, env)
    const list: any = await listRes.json()
    const row = list.find((u: any) => u.id === target.orbitId)
    expect(row.followers_count).toBe(1)

    const body = JSON.stringify({ followers_count: 999, add_followers: 500 })
    const res = await app.request(`/api/admin/users/${target.orbitId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(admin, 'POST', `/api/admin/users/${target.orbitId}/adjust`, body) },
      body,
    }, env)
    expect(res.status).toBe(200)

    const afterRes = await app.request('/api/admin/users', { headers: authHeaders(admin, 'GET', '/api/admin/users') }, env)
    const after: any = await afterRes.json()
    expect(after.find((u: any) => u.id === target.orbitId).followers_count).toBe(1)
  })
})
