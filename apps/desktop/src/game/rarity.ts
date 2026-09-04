import type { Rarity } from './types'

export const RARITY_ORDER: readonly Rarity[] = [
  'Common',
  'Copper',
  'Silver',
  'Gold',
  'Diamond',
]

/** Ladder thresholds from SPEC §4 (value = buy price + clicks). */
export const RARITY_THRESHOLDS: Record<Rarity, number> = {
  Common: 0,
  Copper: 100,
  Silver: 500,
  Gold: 1500,
  Diamond: 5000,
}

/** Passive g$/s per owned image by rarity (SPEC §4). */
export const RARITY_INCOME: Record<Rarity, number> = {
  Common: 1,
  Copper: 3,
  Silver: 10,
  Gold: 30,
  Diamond: 100,
}

export const GALLERY_COST_GROWTH = 1.1

/** cost = rarityBase * 1.1^gallerySize (SPEC §4). Epsilon absorbs FP drift (100*1.1 = 110.00000000000001). */
export function imageBuyCost(rarityBase: number, gallerySize: number): number {
  return Math.ceil(rarityBase * Math.pow(GALLERY_COST_GROWTH, gallerySize) - 1e-9)
}

export function rarityFor(value: number): Rarity {
  for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
    if (value >= RARITY_THRESHOLDS[RARITY_ORDER[i]]) return RARITY_ORDER[i]
  }
  return 'Common'
}

/** Rarity of an image from its price + accumulated clicks (SPEC §4). */
export function imageRarity(rarityBase: number, gallerySize: number, clicks = 0): Rarity {
  return rarityFor(imageBuyCost(rarityBase, gallerySize) + clicks)
}

export function rarityIncome(rarity: Rarity): number {
  return RARITY_INCOME[rarity]
}
