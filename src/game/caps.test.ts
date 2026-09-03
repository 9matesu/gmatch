import { describe, expect, it } from 'vitest'
import {
  ALL_CAP_IDS,
  CAPS,
  activeCaps,
  capAutoClicksPerSec,
  capClickMult,
  capPassiveMult,
  popCap,
} from './caps'

const NOW = 10_000

describe('cap definitions (SPEC §5)', () => {
  it('four caps with correct costs/durations/effects', () => {
    expect(ALL_CAP_IDS).toHaveLength(4)
    expect(CAPS.blue).toMatchObject({ name: 'Blue Cap', cost: 150, durationMs: 60_000, clickMult: 2 })
    expect(CAPS.filter).toMatchObject({ name: 'Goon Filter', cost: 900, durationMs: 120_000, autoClicksPerSec: 1 })
    expect(CAPS.hypno).toMatchObject({ name: 'Hypno Drop', cost: 5_000, durationMs: 180_000, passiveMult: 2 })
    expect(CAPS.melt).toMatchObject({ name: 'Brain Melt', cost: 50_000, durationMs: 30_000, clickMult: 10, passiveMult: 10 })
  })
})

describe('stacking rules (SPEC §5)', () => {
  it('different caps stack', () => {
    let active = popCap([], 'blue', NOW)
    active = popCap(active, 'hypno', NOW)
    expect(active).toHaveLength(2)
    expect(capClickMult(active, NOW)).toBe(2)
    expect(capPassiveMult(active, NOW)).toBe(2)
  })

  it('same cap refreshes duration instead of stacking', () => {
    let active = popCap([], 'blue', NOW)
    expect(active[0].expiresAt).toBe(NOW + 60_000)
    active = popCap(active, 'blue', NOW + 30_000)
    expect(active).toHaveLength(1)
    expect(active[0].expiresAt).toBe(NOW + 90_000)
  })

  it('expired caps drop out', () => {
    const active = popCap([], 'melt', NOW)
    expect(capClickMult(active, NOW + 29_999)).toBe(10)
    expect(capClickMult(active, NOW + 30_001)).toBe(1)
    expect(activeCaps(active, NOW + 30_001)).toEqual([])
  })

  it('Brain Melt multiplies everything x10 on top of other caps', () => {
    let active = popCap([], 'blue', NOW)
    active = popCap(active, 'melt', NOW)
    expect(capClickMult(active, NOW)).toBe(20)
    expect(capPassiveMult(active, NOW)).toBe(10)
  })

  it('Goon Filter gives 1 auto-click/s', () => {
    const active = popCap([], 'filter', NOW)
    expect(capAutoClicksPerSec(active, NOW)).toBe(1)
    expect(capAutoClicksPerSec(active, NOW + 120_001)).toBe(0)
  })
})
