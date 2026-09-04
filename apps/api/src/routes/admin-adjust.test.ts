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
})
