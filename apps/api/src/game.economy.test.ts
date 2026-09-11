import { describe, expect, it } from 'vitest'
import { matchEconomy } from '@orbit/shared'

// Ranks (computeCardRarity ladder +1): common 1 · copper 2 · silver 3 · gold 4 · diamond 5
describe('matchEconomy', () => {
  it('scales payout with both cards\' rarity rank', () => {
    const low = matchEconomy(0, 0) // common vs common
    const high = matchEconomy(1500, 5000) // gold vs diamond
    expect(low.winGp).toBe(50)
    expect(high.winGp).toBe(50 * 4 * 5)
    expect(low.loseGp).toBe(10)
    expect(high.boostCost).toBe(4 * low.boostCost)
  })
  it('clamps garbage scores to the common tier', () => {
    expect(matchEconomy(-999, 0).winGp).toBe(50)
    expect(matchEconomy(null as unknown as number, undefined as unknown as number).loseGp).toBe(10)
  })
})
