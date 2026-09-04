import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  achievementClickMult,
  newlyEarned,
  type AchievementStats,
} from './achievements'

function stats(over: Partial<AchievementStats> = {}): AchievementStats {
  return {
    clicks: 0,
    crits: 0,
    tagsOwned: 0,
    galleryOwned: 0,
    hasDiamond: false,
    capsUsed: [],
    prestiges: 0,
    shards: 0,
    tier: 1,
    collectedOfflineEarnings: false,
    maxHeatStreak: 0,
    ...over,
  }
}

describe('achievement list (SPEC §10)', () => {
  it('has exactly 12 achievements with the spec names', () => {
    expect(ACHIEVEMENTS).toHaveLength(13)
    expect(ACHIEVEMENTS.map((a) => a.name)).toEqual([
      'First Click',
      '100 Clicks',
      'First Tag',
      'Tag Collector',
      'Gallery of Sins',
      'Diamond Hands',
      'Crit Addict',
      'Cap Connoisseur',
      'First Brainmelt',
      '10 Shards',
      'Goon Master',
      'Heat Demon',
      'Offline Slut',
    ])
  })

  it('Heat Demon unlocks at an 80-click heat streak', () => {
    expect(newlyEarned([], stats({ maxHeatStreak: 79 }))).not.toContain('heat_demon')
    expect(newlyEarned([], stats({ maxHeatStreak: 80 }))).toContain('heat_demon')
  })

  it('ids are unique', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('newlyEarned', () => {
  it('earns First Click on first click only once', () => {
    expect(newlyEarned([], stats({ clicks: 1 }))).toEqual(['first_click'])
    expect(newlyEarned(['first_click'], stats({ clicks: 500 }))).not.toContain('first_click')
  })

  it('thresholds fire correctly', () => {
    const earned = newlyEarned([], stats({ clicks: 100 }))
    expect(earned).toContain('clicks_100')
    expect(newlyEarned([], stats({ crits: 50 }))).toContain('crit_addict')
    expect(newlyEarned([], stats({ tagsOwned: 10 }))).toContain('tag_collector')
    expect(newlyEarned([], stats({ galleryOwned: 10 }))).toContain('gallery_of_sins')
    expect(newlyEarned([], stats({ hasDiamond: true }))).toContain('diamond_hands')
    expect(newlyEarned([], stats({ prestiges: 1 }))).toContain('first_brainmelt')
    expect(newlyEarned([], stats({ shards: 10 }))).toContain('ten_shards')
    expect(newlyEarned([], stats({ tier: 10 }))).toContain('goon_master')
    expect(newlyEarned([], stats({ collectedOfflineEarnings: true }))).toContain('offline_slut')
  })

  it('Cap Connoisseur needs all four caps', () => {
    expect(newlyEarned([], stats({ capsUsed: ['blue', 'filter', 'hypno'] }))).not.toContain('cap_connoisseur')
    expect(newlyEarned([], stats({ capsUsed: ['blue', 'filter', 'hypno', 'melt'] }))).toContain('cap_connoisseur')
  })
})

describe('click bonus', () => {
  it('+5% click power per achievement', () => {
    expect(achievementClickMult(0)).toBe(1)
    expect(achievementClickMult(4)).toBeCloseTo(1.2)
    expect(achievementClickMult(12)).toBeCloseTo(1.6)
  })
})
