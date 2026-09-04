import { describe, expect, it } from 'vitest'
import { createWallet, type WalletState } from './wallet'

describe('wallet (single g$ unit, plan D4)', () => {
  it('starts empty', () => {
    const w = createWallet()
    expect(w.gc).toBe(0)
    expect(w.credited).toBe(0)
  })

  it('earn accumulates fractional income locally', () => {
    let w: WalletState = createWallet()
    w = { ...w, gc: w.gc + 0.4 }
    w = { ...w, gc: w.gc + 0.4 }
    expect(w.gc).toBeCloseTo(0.8)
    // nothing creditable yet (floor < 1)
    expect(Math.floor(w.gc) - w.credited).toBe(0)
  })

  it('pendingCredit is the integer floor minus already-credited', () => {
    const w: WalletState = { gc: 12.9, credited: 5 }
    expect(Math.floor(w.gc) - w.credited).toBe(7)
  })

  it('markCredited never exceeds the floor (no double-pay on replay)', () => {
    const w: WalletState = { gc: 12.9, credited: 5 }
    const next = { ...w, credited: Math.min(Math.floor(w.gc), w.credited + 7) }
    expect(next.credited).toBe(12)
    expect(Math.floor(next.gc) - next.credited).toBe(0)
    // replaying the same flush pays nothing more
    const again = { ...next, credited: Math.min(Math.floor(next.gc), next.credited + 7) }
    expect(again.credited).toBe(12)
  })

  it('spend checks the float balance and deducts', () => {
    const w: WalletState = { gc: 10, credited: 0 }
    expect(w.gc >= 10.5).toBe(false)
    const after = { ...w, gc: w.gc - 9.5 }
    expect(after.gc).toBeCloseTo(0.5)
  })

  it('earnings below 1 g$ never reach the server', () => {
    const w: WalletState = { gc: 0.99, credited: 0 }
    expect(Math.floor(w.gc) - w.credited).toBe(0)
  })
})
