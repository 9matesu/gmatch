export type Rarity = 'Common' | 'Copper' | 'Silver' | 'Gold' | 'Diamond'

export type CapId = 'blue' | 'filter' | 'hypno' | 'melt'

export interface OwnedTag {
  name: string
  level: number
  base: number
  income: number
  weight: number
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
