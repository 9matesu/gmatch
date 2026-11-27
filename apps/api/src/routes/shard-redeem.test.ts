import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { shardRedeem, SHARDS_PER_G, MAX_G_PER_REDEEM, MAX_G_PER_24H } from './shard-redeem'
import { EconomyService } from '../economy'
import { createMockEnv, createTestIdentity, signRequestHeaders, type TestIdentity } from '../test-utils'

describe('shard redemption (the one authorised shard -> g$ bridge)', () => {
  let app: Hono
  let env: { DB: any }
  let user: TestIdentity

  function post(body: unknown, key: string, identity = user) {
    const raw = JSON.stringify(body)
    return app.request('/api/shard-redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...signRequestHeaders(identity, 'POST', '/api/shard-redeem', raw),
      },
      body: raw,
    })
  }

  beforeEach(async () => {
    vi.useRealTimers()
    env = await createMockEnv()
    user = createTestIdentity()
    app = new Hono()
    app.use('*', async (c, next) => { c.env = env as any; await next() })
    app.route('/api/shard-redeem', shardRedeem)
  })

  afterEach(() => vi.useRealTimers())

  it('caps each redemption at 1 g$ and ignores a client amount', async () => {
    const res = await post({ shards: SHARDS_PER_G * 100, amount: 9999, grantedG: 9999 }, 'redeem-key-0001')
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(MAX_G_PER_REDEEM).toBe(1)
    expect(json.grantedG).toBe(1)
    expect(json.shardsSpent).toBe(SHARDS_PER_G)
    expect(json.balance).toBe(1)
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(1)
  })

  it('refuses below one g$ and rejects fractional or negative shards', async () => {
    expect((await post({ shards: SHARDS_PER_G - 1 }, 'redeem-key-0002')).status).toBe(400)
    expect((await post({ shards: 1.5 }, 'redeem-key-0003')).status).toBe(400)
    expect((await post({ shards: SHARDS_PER_G + 0.5 }, 'redeem-key-0003b')).status).toBe(400)
    expect((await post({ shards: -10 }, 'redeem-key-0004')).status).toBe(400)
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(0)
  })

  it('requires an idempotency key and never double-credits a replay', async () => {
    const first = await post({ shards: SHARDS_PER_G }, 'redeem-key-0005')
    expect(first.status).toBe(200)
    const replay = await post({ shards: SHARDS_PER_G }, 'redeem-key-0005')
    expect(replay.status).toBe(200)
    const replayed: any = await replay.json()
    expect(replayed.replayed).toBe(true)
    expect(replayed.grantedG).toBe(1)
    expect(replayed.shardsSpent).toBe(0) // a client retry must not deduct twice
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(1)
  })

  it('rejects a key replayed by a different identity', async () => {
    await post({ shards: SHARDS_PER_G }, 'redeem-key-0006')
    const other = createTestIdentity()
    expect((await post({ shards: SHARDS_PER_G }, 'redeem-key-0006', other)).status).toBe(409)
  })

  it('a second redemption is blocked by the 6h cooldown', async () => {
    expect((await post({ shards: SHARDS_PER_G }, 'redeem-key-0007')).status).toBe(200)
    const again = await post({ shards: SHARDS_PER_G }, 'redeem-key-0008')
    expect(again.status).toBe(429)
    const json: any = await again.json()
    expect(json.retryAfterMs).toBeGreaterThan(0)
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(1)
  })

  it('lets only one of two different keys win a race inside the cooldown', async () => {
    const [a, b] = await Promise.all([
      post({ shards: SHARDS_PER_G }, 'race-key-0001'),
      post({ shards: SHARDS_PER_G }, 'race-key-0002'),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 429])
    const winner = (a.status === 200 ? a : b) as any
    const loser = (a.status === 429 ? a : b) as any
    expect((await winner.json()).shardsSpent).toBe(SHARDS_PER_G)
    expect((await loser.json()).error).toMatch(/in progress|cooling down/)
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(1)
  })

  it('caps each payout at 1 g$ and holds the 24h budget after the cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'))
    const first = await post({ shards: SHARDS_PER_G * 100 }, 'redeem-key-0009')
    expect((await first.json() as any).grantedG).toBe(1)
    expect(MAX_G_PER_24H).toBe(5)
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 60 * 1000 + 1000))
    const second = await post({ shards: SHARDS_PER_G * 100 }, 'redeem-key-0010')
    expect(second.status).toBe(429)
    const json: any = await second.json()
    expect(json.remaining24h).toBe(MAX_G_PER_24H - 1)
    expect(await new EconomyService(env.DB).getBalance(user.orbitId)).toBe(1)
  })
})
