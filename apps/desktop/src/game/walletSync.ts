import { pendingDelta, markCredited, markDebited, type WalletState } from './wallet'

/**
 * Wallet <-> server ledger bridge (plan D4/D3). The local game state stays
 * authoritative for gameplay (never blocks a click on network); the ledger
 * mirrors it via a NET delta: floor(gc) - (credited - debited). Positive ->
 * idle-credit, negative -> idle-debit. Purchases need no separate call: they
 * lower gc and the next sync mirrors them.
 *
 * `post`/`get` are injectable (orbitFetch in production, mocks in tests).
 */

export interface WalletSyncCtx extends WalletState {
  orbitId: string
  /** Passive+click earning rate the ledger envelope validates credits
   * against (server: economy-idle.ts idleEnvelope). */
  gps: number
  post: (endpoint: string, init: { body: string; headers: Record<string, string> }) => Promise<{
    ok: boolean
    status: number
    json: () => Promise<Record<string, unknown>>
  }>
  get: (endpoint: string) => Promise<{
    ok: boolean
    status: number
    json: () => Promise<Record<string, unknown>>
  }>
}

/** Push the net delta to the ledger. Returns the new wallet state, or null (no-op / failure). */
export async function syncWallet(c: WalletSyncCtx): Promise<WalletState | null> {
  const delta = pendingDelta(c)
  if (delta === 0) return null
  if (delta > 0) {
    // The ledger caps one credit at 1M — chunk honest big flushes (a long
    // offline resume at high g$/s) instead of wedging on a permanent 400.
    const amount = Math.min(delta, 1_000_000)
    // Stable key per (identity, credited-marker): a retry after a dropped
    // response replays server-side instead of double-paying.
    const key = `idle-${c.orbitId}-${c.credited}`.slice(0, 128)
    try {
      const res = await c.post('/api/economy/idle-credit', {
        body: JSON.stringify({ amount, session: c.orbitId, gps: Math.floor(c.gps || 0) }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      })
      if (!res.ok) return null
      return markCredited(c, amount)
    } catch {
      return null
    }
  }
  const amount = -delta
  const key = `debit-${c.orbitId}-${c.credited}-${c.debited}`.slice(0, 128)
  try {
    const res = await c.post('/api/economy/idle-debit', {
      body: JSON.stringify({ amount, reference: 'idle-net' }),
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    })
    if (!res.ok) return null
    return markDebited(c, amount)
  } catch {
    return null
  }
}

/**
 * Adopt the server balance on load: the ledger wins, unflushed local delta
 * stays pending (syncWallet will push it next tick).
 */
export async function reconcileFromServer(c: WalletSyncCtx): Promise<WalletState | null> {
  try {
    const res = await c.get('/api/economy/balance')
    if (!res.ok) return null
    const data = await res.json()
    const balance = Number(data.balance)
    if (!Number.isFinite(balance)) return null
    // Server truth becomes the mirror; the unflushed local delta (either
    // sign) stays pending and syncWallet pushes it on the next tick.
    return { gc: balance + pendingDelta(c), credited: balance, debited: 0 }
  } catch {
    return null
  }
}
