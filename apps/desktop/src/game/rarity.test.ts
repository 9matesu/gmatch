import { describe, expect, it } from 'vitest'
import {
  RARITY_INCOME,
  imageBuyCost,
  imageRarity,
  rarityFor,
  rarityIncome,
} from './rarity'

describe('rarity ladder (SPEC §4)', () => {
  it('thresholds: Common 0-99, Copper 100-499, Silver 500-1499, Gold 1500-4999, Diamond 5000+', () => {
    expect(rarityFor(0)).toBe('Common')
    expect(rarityFor(99)).toBe('Common')
    expect(rarityFor(100)).toBe('Copper')
    expect(rarityFor(499)).toBe('Copper')
    expect(rarityFor(500)).toBe('Silver')
    expect(rarityFor(1499)).toBe('Silver')
    expect(rarityFor(1500)).toBe('Gold')
    expect(rarityFor(4999)).toBe('Gold')
    expect(rarityFor(5000)).toBe('Diamond')
    expect(rarityFor(999_999)).toBe('Diamond')
  })

  it('income per rarity 1/3/10/30/100', () => {
    expect(RARITY_INCOME).toEqual({
      Common: 1, Copper: 3, Silver: 10, Gold: 30, Diamond: 100,
    })
    expect(rarityIncome('Diamond')).toBe(100)
  })
})

describe('imageBuyCost (SPEC §4)', () => {
  it('cost = rarityBase * 1.1^gallerySize', () => {
    expect(imageBuyCost(100, 0)).toBe(100)
    expect(imageBuyCost(100, 1)).toBe(110)
    expect(imageBuyCost(100, 2)).toBe(121)
    expect(imageBuyCost(50, 5)).toBe(Math.ceil(50 * Math.pow(1.1, 5)))
  })
})

describe('imageRarity', () => {
  it('rarity comes from price + clicks', () => {
    expect(imageRarity(50, 0, 0)).toBe('Common')
    expect(imageRarity(50, 0, 60)).toBe('Copper')
    expect(imageRarity(5000, 0, 0)).toBe('Diamond')
  })
})
