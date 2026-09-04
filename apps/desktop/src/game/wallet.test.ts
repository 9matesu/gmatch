import { describe, expect, it } from 'vitest'
import { createWallet, markCredited, markDebited, pendingDelta, gpToGc, type WalletState } from './wallet'

describe('wallet (single g$ unit, plan D4)', () => {
  it('starts empty', () => {
    const w = createWallet()
    expect(w.gc).toBe(0)
    expect(w.credited).toBe(0)
    expect(w.debited).toBe(0)
  })

  it('pendingDelta = floor(gc) - (credited - debited)', () => {
    expect(pendingDelta({ gc: 50, credited: 12, debited: 0 })).toBe(38)
    expect(pendingDelta({ gc: 30, credited: 50, debited: 0 })).toBe(-20)
    expect(pendingDelta({ gc: 12.4, credited: 12, debited: 0 })).toBe(0)
  })

  it('markCredited clamps to the floor (no double-pay on replay)', () => {
    const w: WalletState = { gc: 12, credited: 5, debited: 0 }
    const next = markCredited(w, 7)
    expect(next.credited).toBe(12)
    expect(pendingDelta(next)).toBe(0)
    expect(markCredited(next, 7).credited).toBe(12)
  })

  it('markDebited clamps so the mirror never goes below floor(gc)', () => {
    const w: WalletState = { gc: 30, credited: 50, debited: 0 }
    const next = markDebited(w, 20)
    expect(next.debited).toBe(20)
    expect(pendingDelta(next)).toBe(0)
    expect(markDebited(next, 20).debited).toBe(20)
  })

  it('gpToGc is a 1:1 rename (D4)', () => {
    expect(gpToGc(150)).toBe(150)
    expect(gpToGc(-5)).toBe(0)
  })
})
