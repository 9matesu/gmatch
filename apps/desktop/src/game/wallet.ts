/**
 * Unified g$ wallet (plan D4). gMatch's GP and Orbit's g$ turned out to be
 * the SAME order of magnitude (idle caps 150–50k vs hacks 800–4500), and the
 * server ledger only accepts integer amounts — so the merge is a rename, not
 * a rescale: 1 GP = 1 g$, everything stays integer, one unit everywhere.
 *
 * The local game state stays authoritative for gameplay (a click never waits
 * on the network); the ledger mirrors it via a NET delta (see walletSync):
 * credited = total flushed to the server, debited = total mirrored spend.
 */

/** Legacy conversion (1:1 — see above; kept as the migration seam). */
export const GP_TO_GC = 1

export interface WalletState {
  /** Local balance (float-safe: passive income may accrue fractions). */
  gc: number
  /** Whole g$ already credited to the server ledger. */
  credited: number
  /** Whole g$ already mirrored as spend on the server ledger. */
  debited: number
}

export function createWallet(): WalletState {
  return { gc: 0, credited: 0, debited: 0 }
}

/** Signed integer delta the ledger is missing (positive = credit, negative = debit). */
export function pendingDelta(w: WalletState): number {
  return Math.floor(w.gc) - (w.credited - w.debited)
}

/** Mark `amount` as flushed (clamped to the floor — replays pay nothing). */
export function markCredited(w: WalletState, amount: number): WalletState {
  const mirror = w.credited - w.debited
  const credited = w.credited + Math.max(0, Math.min(Math.floor(amount), Math.floor(w.gc) - mirror))
  return { gc: w.gc, credited, debited: w.debited }
}

/** Mark `amount` as mirrored spend (clamped so the mirror tracks floor(gc)). */
export function markDebited(w: WalletState, amount: number): WalletState {
  const mirror = w.credited - w.debited
  const room = mirror - Math.floor(w.gc)
  const debited = w.debited + Math.max(0, Math.min(Math.floor(amount), room))
  return { gc: w.gc, credited: w.credited, debited }
}

/** Migrate a legacy GP save value into g$ (1:1 rename, floor, never rounds up). */
export function gpToGc(gp: number): number {
  return Math.max(0, Math.floor(gp / GP_TO_GC))
}
