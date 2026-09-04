/**
 * Unified g$ wallet (plan D4). The idle game's earnings are denominated in
 * g$ directly (GP retired; legacy GP costs were divided by GP_TO_GC once at
 * merge). The server ledger is authoritative: whole-g$ chunks of local
 * earnings flush through POST /api/economy/idle-credit, idempotently.
 */

/** Legacy conversion used ONLY for the one-time save migration. */
export const GP_TO_GC = 100

export interface WalletState {
  /** Local float balance (spendable, mirrors the ledger + unflushed earnings). */
  gc: number
  /** Whole g$ already credited to the server ledger this save. */
  credited: number
}

export function createWallet(): WalletState {
  return { gc: 0, credited: 0 }
}

/** Integer g$ earned but not yet flushed to the ledger. */
export function pendingCredit(w: WalletState): number {
  return Math.max(0, Math.floor(w.gc) - w.credited)
}

/** Mark `amount` as flushed (clamped to the floor — replays pay nothing). */
export function markCredited(w: WalletState, amount: number): WalletState {
  return { ...w, credited: Math.min(Math.floor(w.gc), w.credited + Math.max(0, Math.floor(amount))) }
}

/** Migrate a legacy GP save value into g$ (floor, never rounds up). */
export function gpToGc(gp: number): number {
  return Math.max(0, Math.floor(gp / GP_TO_GC))
}
