import { describe, expect, it } from 'vitest'
import {
  ALL_CAP_IDS,
  CAPS,
  activeCaps,
  capClickMult,
  capEffectLabel,
  capStacks,
  popCap,
} from './caps'

const NOW = 10_000

/** Only click caps are sold: the idle economy (passive, auto-click) is gone. */
describe('cap definitions (SPEC §5)', () => {
  it('two click caps on sale, and the retired ids stay inert for old saves', () => {
    expect(ALL_CAP_IDS).toEqual(['blue', 'melt'])
    expect(CAPS.blue).toMatchObject({ name: 'E-Girl Spit', cost: 150, clickMult: 2 })
    expect(CAPS.melt).toMatchObject({ name: 'Brain Drain', cost: 50_000, clickMult: 10 })
    // A loaded save may still carry `filter`/`hypno`: the lookup must resolve
    // to a no-op instead of `undefined` (which would crash the panel).
    expect(CAPS.filter.clickMult).toBe(1)
    expect(CAPS.hypno.clickMult).toBe(1)
    for (const id of ALL_CAP_IDS) expect(CAPS[id]).not.toHaveProperty('durationMs')
  })
})

describe('stacking rules (SPEC §5)', () => {
  it('different caps stack', () => {
    let active = popCap([], 'blue', NOW)
    active = popCap(active, 'melt', NOW)
    expect(active).toHaveLength(2)
    expect(capClickMult(active, NOW)).toBe(20)
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
})

describe('button stats helpers', () => {
  it('every cap has a non-empty effect label', () => {
    for (const id of ALL_CAP_IDS) {
      expect(capEffectLabel(id).length).toBeGreaterThan(0)
    }
    expect(capEffectLabel('blue')).toContain('x2 click')
  })

  it('capStacks reports the live count', () => {
    const stacked = popCap(popCap([], 'blue', NOW), 'blue', NOW + 10_000)
    expect(capStacks(stacked, 'blue', NOW + 10_000)).toEqual({ count: 2 })
    expect(capStacks(stacked, 'melt', NOW + 10_000)).toEqual({ count: 0 })
  })
})
