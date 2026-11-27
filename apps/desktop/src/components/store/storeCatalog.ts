/**
 * The Store catalogue — one pure model behind the shop grid.
 *
 * The store is exactly three real things: the shared `STORE_ITEMS` gear, the
 * community market listings the node returns, and the player's own canonical
 * cards. They arrive as three shapes and are folded into ONE `StoreProduct`
 * list here, so search, category filters and sort are a single pass over one
 * array instead of three ad-hoc renders.
 *
 * Nothing here invents a price, a discount, a rating or a stock count: every
 * number is the one the node/shared catalogue supplied, and `null` means
 * "not for sale" (a collection card), which sorts and prints honestly.
 *
 * Pure apart from nothing (no React, no DOM) — unit-tested in
 * `storeCatalog.test.ts`.
 */
import { computeCardRarity, type CardRarity, type StoreItem } from '@orbit/shared'
import type { CanonicalCard } from '../../utils/cardCollection'

export type StoreSource = 'gear' | 'market' | 'collection'
export type StoreCategory = 'all' | StoreSource
export type StoreSort = 'featured' | 'price-asc' | 'price-desc' | 'recent' | 'rarity'

/** A community-market row, shape-matched to `GET /api/cards/market`. */
export interface StoreMarketListing {
  listingId: string
  cardId: string
  price: number
  sellerId: string
  /** Resolved server-side (the joined card's owner name); may be absent. */
  sellerName?: string | null
  /** When the listing was opened (`MarketListings.created_at`), the real
   *  newest-first key — a card minted long ago can be listed today. */
  listedAt?: string | null
  card: CanonicalCard
}

export interface StoreProduct {
  /** Stable local key: the wishlist / recently-viewed id. */
  key: string
  source: StoreSource
  name: string
  /** g$ the player pays; `null` when the row is not for sale (collection). */
  price: number | null
  /** Card identity for a quick view / detail; `null` for gear. */
  cardId: string | null
  card: CanonicalCard | null
  item: StoreItem | null
  sellerId: string | null
  sellerName: string | null
  /** The player's own market listing (not buyable). */
  own: boolean
  createdAt: string | null
  rarity: CardRarity | null
  value: number | null
}

export const RARITY_RANK = {
  common: 0,
  copper: 1,
  silver: 2,
  gold: 3,
  diamond: 4,
} as const satisfies Record<CardRarity, number>

export const STORE_CATEGORIES: { id: StoreCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'gear', label: 'Gear' },
  { id: 'market', label: 'Community' },
  { id: 'collection', label: 'Collection' },
]

export const STORE_SORTS: { id: StoreSort; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'recent', label: 'Newest' },
  { id: 'rarity', label: 'Rarity' },
]

/** Storage keys + caps for the local wishlist / recently-viewed state. */
export const WISHLIST_KEY = 'gmatch_store_wishlist_v1'
export const RECENT_KEY = 'gmatch_store_recent_v1'
export const WISHLIST_LIMIT = 200
export const RECENT_LIMIT = 12

function cardName(card: CanonicalCard | null, fallback: string): string {
  return card?.name?.trim() || fallback
}

/** The listing's newest-first key: when it was opened, else the card's mint. */
function listingDate(l: StoreMarketListing): string {
  return l.listedAt || l.card?.createdAt || ''
}

/**
 * Fold the three real catalogues into one ordered list. Order is the
 * "featured" default: gear first, then market newest-first, then collection.
 * A card already on the market is dropped from the collection half, so "All"
 * shows one tile per card (the listing, which carries a price).
 */
export function buildStoreProducts(input: {
  items: StoreItem[]
  listings: StoreMarketListing[]
  portfolio: CanonicalCard[]
  myId?: string | null
}): StoreProduct[] {
  const { items, listings, portfolio, myId } = input
  const out: StoreProduct[] = []

  for (const item of items) {
    out.push({
      key: `gear:${item.id}`,
      source: 'gear',
      name: item.name,
      price: Number(item.cost) || 0,
      cardId: null,
      card: null,
      item,
      sellerId: null,
      sellerName: null,
      own: false,
      createdAt: null,
      rarity: null,
      value: null,
    })
  }

  const listedCardIds = new Set<string>()
  // The real newest-first key is when the LISTING was opened, not when the
  // card was minted; fall back to the mint date for any row without one.
  const byNewest = [...listings].sort((a, b) =>
    listingDate(b).localeCompare(listingDate(a)),
  )
  for (const l of byNewest) {
    if (!l?.cardId) continue
    listedCardIds.add(l.cardId)
    const card = l.card ?? null
    out.push({
      key: `market:${l.listingId}`,
      source: 'market',
      name: cardName(card, 'Unnamed Card'),
      price: Number(l.price) || 0,
      cardId: l.cardId,
      card,
      item: null,
      sellerId: l.sellerId,
      sellerName: l.sellerName ?? card?.ownerName ?? null,
      own: Boolean(myId && l.sellerId === myId),
      createdAt: listingDate(l) || null,
      rarity: card ? computeCardRarity(card.value ?? 0).rarity : null,
      value: card ? Number(card.value || 0) : null,
    })
  }

  for (const card of portfolio) {
    if (!card?.id || listedCardIds.has(card.id)) continue
    out.push({
      key: `collection:${card.id}`,
      source: 'collection',
      name: cardName(card, 'Unnamed Card'),
      price: null,
      cardId: card.id,
      card,
      item: null,
      sellerId: card.ownerId ?? null,
      sellerName: card.ownerName ?? null,
      own: Boolean(myId && card.ownerId === myId),
      createdAt: card.createdAt ?? null,
      rarity: computeCardRarity(card.value ?? 0).rarity,
      value: Number(card.value || 0),
    })
  }

  return out
}

/** The lowercase haystack one search query is matched against. */
export function productSearchText(p: StoreProduct): string {
  const parts = [
    p.name,
    p.item?.desc,
    p.item?.badge,
    p.card?.description,
    ...(p.card?.tags ?? []),
  ]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

function nullableNumber(a: number | null, b: number | null, dir: number): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return (a - b) * dir
}

function byRecency(a: StoreProduct, b: StoreProduct): number {
  const at = a.createdAt || ''
  const bt = b.createdAt || ''
  if (!at && !bt) return 0
  if (!at) return 1
  if (!bt) return -1
  return bt.localeCompare(at)
}

/** Category → text → sort, in that order. `featured` keeps build order. */
export function filterAndSortProducts(
  products: StoreProduct[],
  opts: { query?: string; category?: StoreCategory; sort?: StoreSort } = {},
): StoreProduct[] {
  const query = (opts.query || '').trim().toLowerCase()
  const category = opts.category || 'all'
  const sort = opts.sort || 'featured'

  let list = category === 'all' ? products : products.filter((p) => p.source === category)
  if (query) list = list.filter((p) => productSearchText(p).includes(query))
  if (sort === 'featured') return list

  return [...list].sort((a, b) => {
    if (sort === 'price-asc') return nullableNumber(a.price, b.price, 1)
    if (sort === 'price-desc') return nullableNumber(a.price, b.price, -1)
    if (sort === 'recent') return byRecency(a, b)
    const ar = a.rarity ? RARITY_RANK[a.rarity] : -1
    const br = b.rarity ? RARITY_RANK[b.rarity] : -1
    if (ar !== br) return br - ar
    return (b.value ?? 0) - (a.value ?? 0)
  })
}

/** Keep only non-empty string ids from whatever was on disk. */
export function sanitizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/** Add/remove a key, newest first, capped. */
export function toggleKey(list: string[], key: string, limit = WISHLIST_LIMIT): string[] {
  if (list.includes(key)) return list.filter((k) => k !== key)
  return [key, ...list].slice(0, limit)
}

/** Push a key to the front, deduped and capped. */
export function pushRecentKey(list: string[], key: string, limit = RECENT_LIMIT): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, limit)
}

/** Resolve stored keys to live products, preserving key order, skipping gone rows. */
export function productsForKeys(products: StoreProduct[], keys: string[]): StoreProduct[] {
  const byKey = new Map(products.map((p) => [p.key, p]))
  const out: StoreProduct[] = []
  for (const k of keys) {
    const p = byKey.get(k)
    if (p) out.push(p)
  }
  return out
}
