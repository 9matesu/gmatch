import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { EconomyService } from '../economy'
import { __resetIdleThrottle, __setIdleCooldown } from './economy-idle'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('POST /api/economy/idle-credit', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const alice = createTestIdentity()

  beforeEach(async () => {
    __resetIdleThrottle()
    __setIdleCooldown(60_000)
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(alice, 'GET', '/api/users') }, env)
  })

  async function credit(amount: unknown, session: string, key: string, gps?: number) {
    const bodyObj: Record<string, unknown> = { amount, session }
    if (gps !== undefined) bodyObj.gps = gps
    const body = JSON.stringify(bodyObj)
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

  it('accepts an in-envelope credit (first-ever is trusted, rate registered)', async () => {
    const res = await credit(250, 'env-a', 'env-key-0001', 1000)
    expect(res.status).toBe(200)
  })

  it('rejects a credit beyond the elapsed*rate envelope and reports the ceiling', async () => {
    __setIdleCooldown(50)
    const first = await credit(100, 'env-b', 'env-key-0002', 1)
    expect(first.status).toBe(200)
    await new Promise((r) => setTimeout(r, 1100))
    const big = await credit(5000, 'env-b', 'env-key-0003', 1)
    expect(big.status).toBe(400)
    const j = await big.json()
    expect(j.error).toMatch(/earning rate/i)
    expect(typeof j.maxAllowed).toBe('number')
    expect(j.maxAllowed).toBeLessThan(5000)
    __setIdleCooldown(60_000)
  })

  it('elapsed covers an honest offline resume (50% rate fits the 1.5x envelope)', async () => {
    __setIdleCooldown(50)
    await credit(100, 'env-c', 'env-key-0004', 10)
    await new Promise((r) => setTimeout(r, 1100))
    // 1.1s at 10 g$/s: envelope floor(1.1*10*1.5)+5 = 21
    const res = await credit(15, 'env-c', 'env-key-0005', 10)
    expect(res.status).toBe(200)
    __setIdleCooldown(60_000)
  })

  it('same-key replay after an accepted credit never re-runs the envelope', async () => {
    const first = await credit(100, 'env-e', 'env-key-0006', 10)
    expect(first.status).toBe(200)
    const replay = await credit(100, 'env-e', 'env-key-0006', 10)
    expect(replay.status).toBe(200)
    const j = await replay.json()
    expect(j.replayed).toBe(true)
  })

  it('requires gps once an identity has an anchor (old clients fail loudly, not silently)', async () => {
    const first = await credit(10, 'env-f', 'env-key-0007', 5)
    expect(first.status).toBe(200)
    __setIdleCooldown(50)
    await new Promise((r) => setTimeout(r, 60))
    const body = JSON.stringify({ amount: 10, session: 'env-f' })
    const noGps = await app.request('/api/economy/idle-credit', {
      method: 'POST',
      headers: {
        ...authHeaders(alice, 'POST', '/api/economy/idle-credit', body),
        'Content-Type': 'application/json',
        'Idempotency-Key': 'env-key-0008',
      },
      body,
    }, env)
    expect(noGps.status).toBe(400)
    const j = await noGps.json()
    expect(j.error).toMatch(/gps/i)
    __setIdleCooldown(60_000)
  })

  it('idleEnvelope caps claimed gps at 50k and floors elapsed earnings', async () => {
    const { idleEnvelope } = await import('./economy-idle')
    expect(idleEnvelope(10, 1_100, false)).toBe(21)
    expect(idleEnvelope(9_999_999, 1_000, false)).toBe(75_005)
    expect(idleEnvelope(10, 0, false)).toBe(5)
    expect(idleEnvelope(0, 60_000, false)).toBe(5)
    expect(idleEnvelope(10, 1_100, true)).toBe(1_000_000)
  })

  it('rate-limits a second distinct credit within 60s', async () => {
    const first = await credit(100, 'session-c', 'idle-key-0003')
    expect(first.status).toBe(200)
    const second = await credit(50, 'session-d', 'idle-key-0004')
    expect(second.status).toBe(429)
    // 429 must tell the client WHEN to retry (wallet sync backoff)
    const j = await second.json()
    expect(typeof j.retryInMs).toBe('number')
    expect(j.retryInMs).toBeGreaterThan(0)
    expect(j.retryInMs).toBeLessThanOrEqual(60_000)
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
