import { describe, expect, it } from 'vitest'
import { FOE_HP_BASE, foeMaxHp, killBonusPoints } from './battle'

describe('foeMaxHp', () => {
  it('starts at base HP', () => {
    expect(foeMaxHp(0)).toBe(FOE_HP_BASE)
  })

  it('grows strictly with every KO', () => {
    let prev = foeMaxHp(0)
    for (let k = 1; k <= 30; k++) {
      const hp = foeMaxHp(k)
      expect(hp).toBeGreaterThan(prev)
      prev = hp
    }
  })

  it('clamps garbage input to at least 1 HP', () => {
    expect(foeMaxHp(-5)).toBe(FOE_HP_BASE)
    expect(foeMaxHp(NaN)).toBeGreaterThanOrEqual(1)
  })
})

describe('killBonusPoints', () => {
  it('pays the rarity base, floored, minimum 1', () => {
    expect(killBonusPoints(250)).toBe(250)
    expect(killBonusPoints(49.7)).toBe(49)
    expect(killBonusPoints(0)).toBe(1)
  })
})
