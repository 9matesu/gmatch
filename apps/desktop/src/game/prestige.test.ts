import { describe, expect, it } from 'vitest'
import {
  PRESTIGE_MIN_TIER,
  TITLES,
  applyBrainmelt,
  canBrainmelt,
  shardsFromEarned,
  tierForXp,
  titleForTier,
  type PrestigeState,
} from './prestige'

function state(over: Partial<PrestigeState> = {}): PrestigeState {
  return {
    gc: 500,
    totalEarnedGc: 4_000_000,
    xp: 9_000,
    tags: [{ name: 'wet', level: 3, base: 10, income: 1, weight: 1 }],
    caps: [{ capId: 'blue', expiresAt: 1e12 }],
    gallery: [{ id: 'g1', url: '', tags: [], rarityBase: 1, clicks: 0, rarity: 'Gold' }],
    shards: 2,
    achievements: ['first_click'],
    prestigeCount: 0,
    ...over,
  }
}

describe('shards (SPEC §9)', () => {
  it('shards = floor(sqrt(totalEarnedGc / 1e6))', () => {
    expect(shardsFromEarned(0)).toBe(0)
    expect(shardsFromEarned(999_999)).toBe(0)
    expect(shardsFromEarned(1_000_000)).toBe(1)
    expect(shardsFromEarned(4_000_000)).toBe(2)
    expect(shardsFromEarned(9_000_000)).toBe(3)
    expect(shardsFromEarned(100_000_000)).toBe(10)
  })
})

describe('tier gating', () => {
  it('Brainmelt unlocks at tier 5', () => {
    expect(PRESTIGE_MIN_TIER).toBe(5)
    expect(canBrainmelt(4)).toBe(false)
    expect(canBrainmelt(5)).toBe(true)
    expect(titleForTier(5)).toBe('Degenerate')
    expect(titleForTier(10)).toBe('Brainmelt God')
  })

  it('tierForXp is monotonic', () => {
    expect(tierForXp(0)).toBe(1)
    expect(tierForXp(1_600)).toBe(5)
    expect(tierForXp(8_100)).toBe(10)
    expect(tierForXp(1_000_000)).toBeLessThanOrEqual(TITLES.length)
  })
})

describe('applyBrainmelt (SPEC §9)', () => {
  it('resets g$/XP/tags/caps, keeps gallery/shards/achievements', () => {
    const out = applyBrainmelt(state())
    expect(out.gc).toBe(0)
    expect(out.xp).toBe(0)
    expect(out.totalEarnedGc).toBe(0)
    expect(out.tags).toEqual([])
    expect(out.caps).toEqual([])
    expect(out.gallery).toHaveLength(1)
    expect(out.achievements).toEqual(['first_click'])
  })

  it('grants shards and increments prestige count', () => {
    const out = applyBrainmelt(state({ totalEarnedGc: 9_000_000 }))
    expect(out.shardsGained).toBe(3)
    expect(out.shards).toBe(5)
    expect(out.prestigeCount).toBe(1)
  })
})
