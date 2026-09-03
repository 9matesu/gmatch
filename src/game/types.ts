export type Rarity = 'Common' | 'Copper' | 'Silver' | 'Gold' | 'Diamond'

export type CapId = 'blue' | 'filter' | 'hypno' | 'melt'

export interface OwnedTag {
  name: string
  level: number
  base: number
  income: number
  weight: number
  /**
   * Feed selection: selected pills drive the round-robin picture pool.
   * Undefined = legacy default (owned tags feed, market offers don't).
   * Income always counts owned levels — selection only steers pictures.
   */
  selected?: boolean
}

export interface GalleryImage {
  id: string
  url: string
  tags: string[]
  rarityBase: number
  clicks: number
  rarity: Rarity
  boughtAt?: number
}

export interface ActiveCap {
  capId: CapId
  expiresAt: number
}

export interface BooruPost {
  id: string
  url: string
  tags: string[]
  rating?: string
}
