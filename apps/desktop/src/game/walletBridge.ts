import { orbitFetch } from '../utils/api'
import { reconcileFromServer, syncWallet, type WalletSyncCtx } from './walletSync'
import type { WalletState } from './wallet'

/**
 * Glue between the idle store (zustand) and the server ledger (plan 4.3/4.4).
 * The store stays network-free; this module reads its wallet slice, signs
 * requests via orbitFetch, and writes the synced mirror markers back.
 */

export interface IdleWalletSlice extends WalletState {
  setWallet: (w: { gc?: number; credited: number; debited: number }) => void
  /** Monotonic lifetime g$ earned. The sync loop MEASURES earning velocity
   * from it for the ledger envelope claim (economy-idle.ts idleEnvelope):
   * measured beats estimated — after a restart it under-claims for one
   * sample window (harmless: the delta just waits for the next tick), and it
   * can never over-claim what was actually earned. */
  totalEarned: number
}

interface IdentityLike {
  orbitId: string
  privateKeyHex: string
  publicKeyHex: string
  encryptionPrivHex: string
  encryptionPubHex: string
}

/** Build the injectable sync context around orbitFetch (signs every request). */
export function makeSyncCtx(
  slice: IdleWalletSlice,
  identity: IdentityLike,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  gps = 0,
  onThrottled?: (ms: number) => void,
): WalletSyncCtx {
  const call = async (
    endpoint: string,
    init: { body: string; headers: Record<string, string> },
    method: 'GET' | 'POST',
  ) => {
    const res = await orbitFetch(
      endpoint,
      { method, headers: init.headers, ...(method === 'POST' ? { body: init.body } : {}) },
      identity,
      fetchFn,
    )
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, json: async () => json as Record<string, unknown> }
  }
  return {
    orbitId: identity.orbitId,
    gps,
    onThrottled,
    gc: slice.gc,
    credited: slice.credited,
    debited: slice.debited,
    post: (e, i) => call(e, i, 'POST'),
    get: (e) => call(e, { body: '', headers: {} }, 'GET'),
  }
}

/**
 * Adopt a freshly server-confirmed balance into the idle wallet mirror
 * (plan D4 hardening): a store purchase debits the ledger directly, and
 * until now the idle `gc` only learned about it at the next 65s sync tick —
 * the header/profile number and the clicker disagreed for a minute. Same
 * math as reconcileFromServer, with the balance the purchase already
 * returned: the ledger becomes the mirror base, unflushed local earnings
 * stay pending. Never negative.
 */
export function adoptServerBalance(slice: IdleWalletSlice, balance: number): boolean {
  if (!Number.isFinite(balance)) return false
  const pending = Math.max(0, Math.floor(slice.gc) - (slice.credited - slice.debited))
  slice.setWallet({ gc: balance + pending, credited: balance, debited: 0 })
  return true
}

/**
 * Periodic sync loop: every `intervalMs`, push the net wallet delta to the
 * ledger. Returns a stop function. No-op until an identity exists.
 */
export function startWalletSync(
  getSlice: () => IdleWalletSlice,
  identity: IdentityLike | null,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  intervalMs = 65_000, // > the server's 60s idle-credit throttle: a 429 becomes the exception (reconcile races), not every-other-tick
): () => void {
  if (!identity) return () => undefined
  let stopped = false
  const first = getSlice()
  const sample = { at: Date.now(), total: first.totalEarned, rate: 0 }
  let tick = async () => {
    if (stopped) return
    const slice = getSlice()
    // Velocity sampler: over windows >= 5s, earning per second from the
    // monotonic total. A negative delta means a prestige/reset wrote a fresh
    // save on top — re-anchor instead of claiming 0 forever.
    const now = Date.now()
    const d = slice.totalEarned - sample.total
    const dt = now - sample.at
    if (dt >= 5_000) {
      if (d >= 0) sample.rate = (d / dt) * 1000
      sample.at = now
      sample.total = slice.totalEarned
    }
    const ctx = makeSyncCtx(slice, identity, fetchFn, sample.rate, throttled)
    const next = await syncWallet(ctx)
    // Markers only: gc may have grown during the round-trip (stale snapshot).
    if (next) slice.setWallet({ credited: next.credited, debited: next.debited })
  }
  // Adopt the server balance once up front (server truth wins, plan D4).
  void (async () => {
    const slice = getSlice()
    const ctx = makeSyncCtx(slice, identity, fetchFn)
    const r = await reconcileFromServer(ctx)
    if (r && !stopped) slice.setWallet(r)
  })()
  // Backoff: a 429 (server one-per-60s credit throttle) used to be
  // re-attempted blindly on EVERY 30s tick — console spam + useless traffic.
  // The server answers 429 with retryInMs; skip ticks until that passes.
  let retryAfter = 0
  const throttled = (ms: number) => { retryAfter = Date.now() + ms }
  const origTick = tick
  tick = () => (Date.now() < retryAfter ? Promise.resolve() : origTick())
  const t = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => {
    stopped = true
    clearInterval(t)
  }
}
