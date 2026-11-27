// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { orbitFetch } from '../utils/api'
import { redeemShards } from './shardRedeem'

vi.mock('../utils/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/api')>()
  return { ...mod, orbitFetch: vi.fn(async () => new Response('{}', { status: 200 })) }
})

const mocked = vi.mocked(orbitFetch)
const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))

describe('redeemShards', () => {
  beforeEach(() => mocked.mockReset())

  it('signed request carries shards only, never a client-set amount', async () => {
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, grantedG: 1, shardsSpent: 1000, balance: 1,
      remaining24h: 4, nextRedeemAt: 'later',
    }), { status: 200 }))
    const out = await redeemShards(IDENTITY, 1000)
    expect(out.ok).toBe(true)
    expect(out.grantedG).toBe(1)
    expect(out.shardsSpent).toBe(1000)
    const [, init] = mocked.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ shards: 1000 })
    expect(String((init.headers as Record<string, string>)['Idempotency-Key']).length).toBeGreaterThanOrEqual(8)
  })

  it('passes a replay through with shardsSpent 0 (no second local deduction)', async () => {
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, grantedG: 1, shardsSpent: 0, balance: 1,
      remaining24h: 4, nextRedeemAt: 'later', replayed: true,
    }), { status: 200 }))
    const out = await redeemShards(IDENTITY, 1000)
    expect(out).toMatchObject({ ok: true, grantedG: 1, shardsSpent: 0, replayed: true })
  })

  it('reports a cooldown honestly with a zero grant', async () => {
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'Shard redemption is cooling down', remaining24h: 0,
      nextRedeemAt: 'later', retryAfterMs: 5000,
    }), { status: 429 }))
    const out = await redeemShards(IDENTITY, 5000)
    expect(out.ok).toBe(false)
    expect(out.grantedG).toBe(0)
    expect(out.shardsSpent).toBe(0)
    expect(out.retryAfterMs).toBe(5000)
  })

  it('refuses bad local input without a network call', async () => {
    const out = await redeemShards(IDENTITY, 1.5)
    expect(out.ok).toBe(false)
    expect(mocked).not.toHaveBeenCalled()
  })

  it('never credits locally on a transport failure', async () => {
    mocked.mockRejectedValueOnce(new Error('offline'))
    const out = await redeemShards(IDENTITY, 1000)
    expect(out).toMatchObject({ ok: false, grantedG: 0, shardsSpent: 0 })
  })
})
