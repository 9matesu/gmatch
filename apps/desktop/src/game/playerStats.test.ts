import { describe, it, expect } from 'vitest'
import { playerStatsFromGame } from './playerStats'
import type { GameState } from './store'

/** Minimal game state carrying only the fields the projection reads. */
function game(partial: Partial<GameState> = {}): GameState {
  return {
    clicks: 0,
    crits: 0,
    gallery: [],
    totalGallerySaved: 0,
    capsUsed: [],
    purchases: 0,
    prestigeCount: 0,
    shards: 0,
    totalShardsEarned: 0,
    idleShardsEarned: 0,
    defeated: 0,
    maxHeatStreak: 0,
    ...partial,
  } as unknown as GameState
}

describe('playerStatsFromGame', () => {
  it('reads lifetime scalars straight from the store', () => {
    const stats = playerStatsFromGame(game({
      clicks: 120, crits: 7, purchases: 12, prestigeCount: 3,
      totalShardsEarned: 42, idleShardsEarned: 9, defeated: 88, maxHeatStreak: 55,
    }))

    expect(stats.clicks).toBe(120)
    expect(stats.crits).toBe(7)
    expect(stats.tagPurchases).toBe(12)
    expect(stats.prestigeCount).toBe(3)
    expect(stats.totalShardsEarned).toBe(42)
    expect(stats.idleShardsEarned).toBe(9)
    expect(stats.kOs).toBe(88)
    expect(stats.maxHeatStreak).toBe(55)
  })

  it('reads lifetime earned/saved counters, never the spendable balance or current list', () => {
    const stats = playerStatsFromGame(game({
      // A player who earned 100 shards and saved 100 keeps, then spent the
      // shards and deleted the keeps: the badge must not relock.
      shards: 0,
      totalShardsEarned: 100,
      gallery: [],
      totalGallerySaved: 100,
    }))

    expect(stats.totalShardsEarned).toBe(100)
    expect(stats.gallerySaved).toBe(100)
  })

  it('counts used caps from the capsUsed array', () => {
    const stats = playerStatsFromGame(game({
      capsUsed: ['blue', 'melt'] as GameState['capsUsed'],
    }))

    expect(stats.capsUsed).toBe(2)
  })

  it('yields all-zero defaults on a fresh run', () => {
    const stats = playerStatsFromGame(game())

    expect(stats.clicks).toBe(0)
    expect(stats.gallerySaved).toBe(0)
    expect(stats.capsUsed).toBe(0)
    expect(stats.kOs).toBe(0)
  })
})
