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
  it('four permanent caps with correct costs/effects', () => {
    expect(ALL_CAP_IDS).toHaveLength(4)
    expect(CAPS.blue).toMatchObject({ name: 'E-Girl Spit', cost: 150, clickMult: 2 })
    expect(CAPS.filter).toMatchObject({ name: 'Braceface', cost: 900, autoClicksPerSec: 1 })
    expect(CAPS.hypno).toMatchObject({ name: 'Pornmeat', cost: 5_000, passiveMult: 2 })
    expect(CAPS.melt).toMatchObject({ name: 'Brain Drain', cost: 50_000, clickMult: 10, passiveMult: 10 })
    for (const id of ALL_CAP_IDS) expect(CAPS[id]).not.toHaveProperty('durationMs')
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
    expect(active[0].expiresAt).toBe(Number.POSITIVE_INFINITY)
    active = popCap(active, 'blue', NOW + 30_000)
    expect(active).toHaveLength(2)
    expect(active[1].expiresAt).toBe(Number.POSITIVE_INFINITY)
    expect(capClickMult(active, NOW + 30_000)).toBe(4)
  })

  it('popped caps NEVER expire — no timers, no wear', () => {
    const active = popCap([], 'melt', NOW)
    expect(capClickMult(active, NOW + 1e12)).toBe(10)
    expect(activeCaps(active, NOW + 1e12)).toHaveLength(1)
  })

  it('Brain Drain multiplies everything x10 on top of other caps', () => {
    let active = popCap([], 'blue', NOW)
    active = popCap(active, 'melt', NOW)
    expect(capClickMult(active, NOW)).toBe(20)
    expect(capPassiveMult(active, NOW)).toBe(10)
  })

  it('Braceface gives 1 auto-click/s, forever', () => {
    const active = popCap([], 'filter', NOW)
    expect(capAutoClicksPerSec(active, NOW)).toBe(1)
    expect(capAutoClicksPerSec(active, NOW + 1e12)).toBe(1)
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

  it('capStacks reports the live count', () => {
    const stacked = popCap(popCap([], 'blue', NOW), 'blue', NOW + 10_000)
    expect(capStacks(stacked, 'blue', NOW + 10_000)).toEqual({ count: 2 })
    expect(capStacks(stacked, 'melt', NOW + 10_000)).toEqual({ count: 0 })
  })
})
