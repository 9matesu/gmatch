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
    expect(txs[0].kind).toBe('reward')
    expect(txs[0].reference).toBe('idle:session-a')
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
