import { describe, expect, it } from 'vitest'
import {
  ALL_CAP_IDS,
  CAPS,
  activeCaps,
  capAutoClicksPerSec,
  capClickMult,
  capEffectLabel,
  capPassiveMult,
  capStacks,
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

  it('same cap STACKS — every pop adds a live entry, mults compound', () => {
    let active = popCap([], 'blue', NOW)
    expect(active[0].expiresAt).toBe(NOW + 60_000)
    active = popCap(active, 'blue', NOW + 30_000)
    expect(active).toHaveLength(2)
    expect(active[1].expiresAt).toBe(NOW + 90_000)
    expect(capClickMult(active, NOW + 30_000)).toBe(4)
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

  it('stacked auto-click rates add up', () => {
    const active = popCap(popCap([], 'filter', NOW), 'filter', NOW)
    expect(capAutoClicksPerSec(active, NOW)).toBe(2)
  })
})

describe('button stats helpers', () => {
  it('every cap has a non-empty effect label', () => {
    for (const id of ALL_CAP_IDS) {
      expect(capEffectLabel(id).length).toBeGreaterThan(0)
    }
    expect(capEffectLabel('blue')).toContain('x2 click')
    expect(capEffectLabel('filter')).toContain('auto/s')
  })

  it('capStacks reports count + longest remaining', () => {
    const stacked = popCap(popCap([], 'blue', NOW), 'blue', NOW + 10_000)
    const s = capStacks(stacked, 'blue', NOW + 10_000)
    expect(s.count).toBe(2)
    expect(s.secsLeft).toBe(Math.ceil(CAPS.blue.durationMs / 1000))
    expect(capStacks(stacked, 'melt', NOW + 10_000)).toEqual({ count: 0, secsLeft: 0 })
  })
})
