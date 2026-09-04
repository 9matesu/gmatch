import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { EconomyService } from '../economy'
import { __resetIdleThrottle } from './economy-idle'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('POST /api/economy/idle-credit', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const alice = createTestIdentity()

  beforeEach(async () => {
    __resetIdleThrottle()
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(alice, 'GET', '/api/users') }, env)
  })

  async function credit(amount: unknown, session: string, key: string) {
    const body = JSON.stringify({ amount, session })
    return app.request(
      '/api/economy/idle-credit',
      {
        method: 'POST',
        headers: {
          ...authHeaders(alice, 'POST', '/api/economy/idle-credit', body),
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
      },
      env,
    )
  }

  it('rejects unsigned requests', async () => {
    const res = await app.request('/api/economy/idle-credit', { method: 'POST', body: '{}' }, env)
    expect(res.status).toBe(401)
  })

  it('rejects bad amounts', async () => {
    for (const bad of [0, -5, 1.5, 1_000_001, 'x', null]) {
      const res = await credit(bad, 's1', `key-bad-${String(bad)}`)
      expect(res.status, `amount=${String(bad)}`).toBe(400)
    }
  })

  it('rejects missing idempotency key', async () => {
    const body = JSON.stringify({ amount: 10, session: 's1' })
    const res = await app.request(
      '/api/economy/idle-credit',
      {
        method: 'POST',
        headers: {
          ...authHeaders(alice, 'POST', '/api/economy/idle-credit', body),
          'Content-Type': 'application/json',
        },
        body,
      },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('credits the wallet with kind reward', async () => {
    const res = await credit(250, 'session-a', 'idle-key-0001')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.balance).toBe(250)
    const economy = new EconomyService(env.DB)
    const txs = await economy.listTransactions(alice.orbitId)
    const reward = txs.find((t) => t.kind === 'reward')
    expect(reward?.reference).toBe('idle:session-a')
  })

  it('replays the same key without double-credit', async () => {
    const first = await credit(100, 'session-b', 'idle-key-0002')
    expect(first.status).toBe(200)
    const second = await credit(100, 'session-b', 'idle-key-0002')
    expect(second.status).toBe(200)
    const data = await second.json()
    expect(data.balance).toBe(100)
    expect(data.replayed).toBe(true)
  })

  it('rate-limits a second distinct credit within 60s', async () => {
    const first = await credit(100, 'session-c', 'idle-key-0003')
    expect(first.status).toBe(200)
    const second = await credit(50, 'session-d', 'idle-key-0004')
    expect(second.status).toBe(429)
  })
})

describe('POST /api/economy/idle-debit', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const alice = createTestIdentity()

  beforeEach(async () => {
    __resetIdleThrottle()
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(alice, 'GET', '/api/users') }, env)
  })

  async function debit(amount: unknown, ref: string, key: string) {
    const body = JSON.stringify({ amount, reference: ref })
    return app.request(
      '/api/economy/idle-debit',
      {
        method: 'POST',
        headers: {
          ...authHeaders(alice, 'POST', '/api/economy/idle-debit', body),
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
      },
      env,
    )
  }

  it('rejects unsigned + bad amounts + missing key', async () => {
    const res = await app.request('/api/economy/idle-debit', { method: 'POST', body: '{}' }, env)
    expect(res.status).toBe(401)
    await app.request('/api/users', { headers: authHeaders(alice, 'GET', '/api/users') }, env)
    expect((await debit(0, 'r', 'debit-key-0001')).status).toBe(400)
    expect((await debit(1.5, 'r', 'debit-key-0002')).status).toBe(400)
    const body = JSON.stringify({ amount: 5, reference: 'r' })
    const noKey = await app.request(
      '/api/economy/idle-debit',
      {
        method: 'POST',
        headers: {
          ...authHeaders(alice, 'POST', '/api/economy/idle-debit', body),
          'Content-Type': 'application/json',
        },
        body,
      },
      env,
    )
    expect(noKey.status).toBe(400)
  })

  it('debits a funded wallet with kind purchase', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 500, { idempotencyKey: 'seed-debit-01', kind: 'grant' })
    const res = await debit(120, 'cap:blue', 'debit-key-0003')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.balance).toBe(380)
    const txs = await economy.listTransactions(alice.orbitId)
    const purchase = txs.find((t) => t.kind === 'purchase')
    expect(purchase?.reference).toBe('idle:cap:blue')
  })

  it('rejects overdraft', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 10, { idempotencyKey: 'seed-debit-02', kind: 'grant' })
    const res = await debit(50, 'tag:x', 'debit-key-0004')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('replays the same key without double-debit', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 500, { idempotencyKey: 'seed-debit-03', kind: 'grant' })
    const first = await debit(100, 'tag:y', 'debit-key-0005')
    expect(first.status).toBe(200)
    const second = await debit(100, 'tag:y', 'debit-key-0005')
    expect(second.status).toBe(200)
    const data = await second.json()
    expect(data.balance).toBe(400)
    expect(data.replayed).toBe(true)
  })
})
