import { describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { makeSyncCtx, startWalletSync, type IdleWalletSlice } from './walletBridge'

function slice(over: Partial<IdleWalletSlice> = {}): IdleWalletSlice {
  return { gc: 50, credited: 0, debited: 0, totalEarned: 50, setWallet: vi.fn(), ...over }
}

const identity = generateIdentity()

describe('makeSyncCtx', () => {
  it('passes the measured gps claim through to the sync ctx', () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const ctx = makeSyncCtx(slice(), identity, fetchFn as unknown as typeof globalThis.fetch, 42.9)
    expect(ctx.gps).toBe(42.9)
  })

  it('wraps fetch into the injectable post/get contract', async () => {
    const fetchFn = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ balance: 1 }), { status: 200 }))
    const ctx = makeSyncCtx(slice(), identity, fetchFn as unknown as typeof globalThis.fetch)
    const res = await ctx.post('/api/economy/idle-credit', {
      body: '{}',
      headers: { 'Idempotency-Key': 'x' },
    })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ balance: 1 })
    // orbitFetch may probe GET /api/identity first (sealed-request support);
    // find the actual mutation call.
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit & { headers: Headers }]>
    const [url, init] = calls.find(([u]) => String(u).includes('/api/economy/idle-credit'))!
    expect(String(url)).toContain('/api/economy/idle-credit')
    expect(init.headers.get('Idempotency-Key')).toBe('x')
    expect(init.headers.get('X-Orbit-Id')).toBe(identity.orbitId)
  })
})

describe('startWalletSync', () => {
  it('reconciles on start, then flushes pending earnings', async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url)
      // Fresh server account: balance 0. Reconcile keeps local gc, markers 0.
      if (u.includes('idle-credit')) return new Response(JSON.stringify({ balance: 50 }), { status: 200 })
      return new Response(JSON.stringify({ balance: 0 }), { status: 200 })
    })
    const s = slice({ gc: 50, credited: 0 })
    const stop = startWalletSync(() => s, identity, fetchFn as unknown as typeof globalThis.fetch, 10)
    await new Promise((r) => setTimeout(r, 40))
    stop()
    // reconcile: server 0 + pending 50 -> gc 50, credited 0 (full state write)
    expect(s.setWallet).toHaveBeenCalledWith({ gc: 50, credited: 0, debited: 0 })
    // flush: markers-only write after the credit lands
    expect(s.setWallet).toHaveBeenCalledWith({ credited: 50, debited: 0 })
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('idle-credit'))).toBe(true)
  })

  it('does nothing when identity is null', () => {
    const fetchFn = vi.fn()
    const s = slice()
    const stop = startWalletSync(() => s, null, fetchFn as unknown as typeof globalThis.fetch, 10)
    expect(stop()).toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
