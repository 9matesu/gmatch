import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reconcileFromServer, syncWallet, type WalletSyncCtx } from './walletSync'
import { pendingDelta } from './wallet'

function ctx(overrides: Partial<WalletSyncCtx> = {}): WalletSyncCtx {
  return {
    orbitId: 'abc123',
    gps: 4.7,
    gc: 50,
    credited: 0,
    debited: 0,
    post: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ balance: 50, replayed: false }) })),
    get: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ balance: 40 }) })),
    ...overrides,
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('syncWallet (net flush, both directions)', () => {
  it('does nothing when the server already mirrors the local floor', async () => {
    const c = ctx({ gc: 50, credited: 50, debited: 0 })
    expect(await syncWallet(c)).toBeNull()
    expect(c.post).not.toHaveBeenCalled()
  })

  it('credits unflushed earnings with a stable idempotency key + floored claimed gps', async () => {
    const c = ctx({ gc: 50, credited: 12, debited: 0 })
    const r = await syncWallet(c)
    expect(r).toEqual({ gc: 50, credited: 50, debited: 0 })
    expect(c.post).toHaveBeenCalledWith(
      '/api/economy/idle-credit',
      expect.objectContaining({
        body: JSON.stringify({ amount: 38, session: 'abc123', gps: 4 }),
        headers: expect.objectContaining({ 'Idempotency-Key': 'idle-abc123-12' }),
      }),
    )
  })

  it('debits when mirrored spend exceeds flushed earnings', async () => {
    // earned 50 (credited 50), spent 20 locally -> gc 30, server expects 50
    const c = ctx({ gc: 30, credited: 50, debited: 0 })
    const r = await syncWallet(c)
    expect(r).toEqual({ gc: 30, credited: 50, debited: 20 })
    expect(c.post).toHaveBeenCalledWith(
      '/api/economy/idle-debit',
      expect.objectContaining({
        body: JSON.stringify({ amount: 20, reference: 'idle-net' }),
        headers: expect.objectContaining({ 'Idempotency-Key': 'debit-abc123-50-0' }),
      }),
    )
  })

  it('keeps state unchanged on failure (retry with same key later)', async () => {
    const c = ctx({
      gc: 50,
      credited: 12,
      debited: 0,
      post: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    })
    expect(await syncWallet(c)).toBeNull()
  })

  it('never sends sub-g$ deltas', async () => {
    const c = ctx({ gc: 12.4, credited: 12, debited: 0 })
    expect(await syncWallet(c)).toBeNull()
    expect(c.post).not.toHaveBeenCalled()
  })
})

describe('reconcileFromServer', () => {
  it('adopts the server balance plus unflushed net delta', async () => {
    // server 40; local floor 50 with credited 20 debited 0 -> pending +30
    const c = ctx({ gc: 50, credited: 20, debited: 0 })
    const r = await reconcileFromServer(c)
    // gc = 40 + 30; mirror = 40 (server truth); the +30 stays pending
    expect(r).toEqual({ gc: 70, credited: 40, debited: 0 })
    expect(pendingDelta(r!)).toBe(30)
  })

  it('returns null when the server is unreachable', async () => {
    const c = ctx({ get: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
    expect(await reconcileFromServer(c)).toBeNull()
  })
})
