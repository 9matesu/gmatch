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
    gc: slice.gc,
    credited: slice.credited,
    debited: slice.debited,
    post: (e, i) => call(e, i, 'POST'),
    get: (e) => call(e, { body: '', headers: {} }, 'GET'),
  }
}

/**
 * Periodic sync loop: every `intervalMs`, push the net wallet delta to the
 * ledger. Returns a stop function. No-op until an identity exists.
 */
export function startWalletSync(
  getSlice: () => IdleWalletSlice,
  identity: IdentityLike | null,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  intervalMs = 30_000,
): () => void {
  if (!identity) return () => undefined
  let stopped = false
  const tick = async () => {
    if (stopped) return
    const slice = getSlice()
    const ctx = makeSyncCtx(slice, identity!, fetchFn)
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
  const t = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => {
    stopped = true
    clearInterval(t)
  }
}
