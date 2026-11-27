import { describe, it, expect } from 'vitest'
import { BADGES, getLockedBadges, getUnlockedBadges } from './badges'
import type { PlayerStats } from './playerStats'
import { ACHIEVEMENTS } from './achievements'
import { ALL_CAP_IDS } from './caps'

/**
 * The badge catalog is a SPEC §10a artifact: 18 cosmetic, lifetime milestones
 * on top of the 12 power-granting achievements. This test pins the exact
 * grammar the shelf and the docs rely on — the count, unique ids, a distinct
 * name set, and the threshold behaviour of every single badge (locked at
 * target-1, unlocked at target).
 */

/** Every badge id mapped to the one metric and target it is built from. */
const THRESHOLDS: ReadonlyArray<{ id: string; metric: keyof PlayerStats; target: number }> = [
  { id: 'clicks_1000', metric: 'clicks', target: 1_000 },
  { id: 'clicks_10000', metric: 'clicks', target: 10_000 },
  { id: 'clicks_100000', metric: 'clicks', target: 100_000 },
  { id: 'crit_100', metric: 'crits', target: 100 },
  { id: 'crit_500', metric: 'crits', target: 500 },

  { id: 'gallery_50', metric: 'gallerySaved', target: 50 },
  { id: 'gallery_100', metric: 'gallerySaved', target: 100 },
  { id: 'caps_all', metric: 'capsUsed', target: ALL_CAP_IDS.length },
  { id: 'tags_bought_50', metric: 'tagPurchases', target: 50 },
  { id: 'tags_bought_200', metric: 'tagPurchases', target: 200 },

  { id: 'prestige_5', metric: 'prestigeCount', target: 5 },
  { id: 'prestige_10', metric: 'prestigeCount', target: 10 },

  { id: 'shards_50', metric: 'totalShardsEarned', target: 50 },
  { id: 'shards_100', metric: 'totalShardsEarned', target: 100 },
  { id: 'idle_shards_10', metric: 'idleShardsEarned', target: 10 },

  { id: 'kos_100', metric: 'kOs', target: 100 },
  { id: 'kos_1000', metric: 'kOs', target: 1_000 },
  { id: 'heat_50', metric: 'maxHeatStreak', target: 50 },
]

const ZERO: PlayerStats = {
  clicks: 0,
  crits: 0,
  gallerySaved: 0,
  capsUsed: 0,
  tagPurchases: 0,
  prestigeCount: 0,
  totalShardsEarned: 0,
  idleShardsEarned: 0,
  kOs: 0,
  maxHeatStreak: 0,
}

/** A stats snapshot with exactly one metric set. */
function statsWith(metric: keyof PlayerStats, value: number): PlayerStats {
  return { ...ZERO, [metric]: value }
}

describe('badges catalog', () => {
  it('defines exactly 18 badges', () => {
    expect(BADGES).toHaveLength(18)
  })

  it('has unique ids', () => {
    const ids = BADGES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every badge in the threshold table exactly once', () => {
    expect(new Set(BADGES.map((b) => b.id))).toEqual(new Set(THRESHOLDS.map((t) => t.id)))
  })

  it('names every badge differently from every achievement', () => {
    const achievementNames = new Set(ACHIEVEMENTS.map((a) => a.name))
    for (const badge of BADGES) {
      expect(achievementNames.has(badge.name)).toBe(false)
    }
  })

  it('bases caps_all on ALL_CAP_IDS.length, so it is true only with every cap', () => {
    const capsAll = BADGES.find((b) => b.id === 'caps_all')
    expect(capsAll).toBeDefined()

    expect(capsAll!.check(statsWith('capsUsed', ALL_CAP_IDS.length - 1))).toBe(false)
    expect(capsAll!.check(statsWith('capsUsed', ALL_CAP_IDS.length))).toBe(true)
  })

  it.each(THRESHOLDS)('$id flips exactly at its target ($target)', ({ id, metric, target }) => {
    expect(target).toBeGreaterThan(0)
    // Below the target the badge is locked; at the target it is earned.
    expect(getUnlockedBadges(statsWith(metric, target - 1)).map((b) => b.id)).not.toContain(id)
    expect(getLockedBadges(statsWith(metric, target)).map((b) => b.id)).not.toContain(id)
    expect(getUnlockedBadges(statsWith(metric, target)).map((b) => b.id)).toContain(id)
  })
})
