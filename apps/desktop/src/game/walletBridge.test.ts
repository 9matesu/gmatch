import { describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { adoptServerBalance, makeSyncCtx, startWalletSync, type IdleWalletSlice } from './walletBridge'

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

  it('backs off after a 429 that carries retryInMs (no hammering the server throttle)', async () => {
    let creditCalls = 0
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('idle-credit')) {
        creditCalls++
        // Retry-After: 0 — orbitFetch retries its own 429 handling after that
        // header's seconds; the mock resolves immediately so the bridge's
        // backoff arms inside the test window (prod server sends real seconds).
        return new Response(JSON.stringify({ error: 'limited', retryInMs: 400 }), { status: 429, headers: { 'Retry-After': '0' } })
      }
      return new Response(JSON.stringify({ balance: 0 }), { status: 200 })
    })
    const s = slice({ gc: 50, credited: 0 })
    const stop = startWalletSync(() => s, generateIdentity(), fetchFn as unknown as typeof globalThis.fetch, 15)
    await new Promise((r) => setTimeout(r, 200))
    stop()
    // 200ms at a 15ms tick = ~13 POSTs without backoff. With it, only the
    // pre-backoff race (initial tick + orbitFetch's own retry) fires:
    // the interval ticks after ~2ms are all skipped until 400ms.
    expect(creditCalls).toBeLessThanOrEqual(4)
  })

  it('retries credits once the server-given backoff window passed', async () => {
    let creditCalls = 0
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('idle-credit')) {
        creditCalls++
        // first attempt throttled; later ones accepted
        return creditCalls === 1
          ? new Response(JSON.stringify({ error: 'limited', retryInMs: 20 }), { status: 429, headers: { 'Retry-After': '0' } })
          : new Response(JSON.stringify({ balance: 50 }), { status: 200 })
      }
      return new Response(JSON.stringify({ balance: 0 }), { status: 200 })
    })
    const s = slice({ gc: 50, credited: 0 })
    const stop = startWalletSync(() => s, generateIdentity(), fetchFn as unknown as typeof globalThis.fetch, 15)
    await new Promise((r) => setTimeout(r, 80))
    stop()
    expect(creditCalls).toBeGreaterThanOrEqual(2)
  })

  it('does nothing when identity is null', () => {
    const fetchFn = vi.fn()
    const s = slice()
    const stop = startWalletSync(() => s, null, fetchFn as unknown as typeof globalThis.fetch, 10)
    expect(stop()).toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('adoptServerBalance (purchase echo)', () => {
  it('mirrors the server balance and keeps unflushed earnings pending', () => {
    const s = slice({ gc: 140, credited: 100, debited: 0 })
    expect(adoptServerBalance(s, 80)).toBe(true)
    expect(s.setWallet).toHaveBeenCalledWith({ gc: 120, credited: 80, debited: 0 })
  })

  it('ignores a non-numeric balance', () => {
    const s = slice()
    expect(adoptServerBalance(s, NaN)).toBe(false)
    expect(s.setWallet).not.toHaveBeenCalled()
  })
})
