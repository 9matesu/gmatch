import { describe, expect, it } from 'vitest'
import type { StoreItem } from '@orbit/shared'
import type { CanonicalCard } from '../../utils/cardCollection'
import {
  buildStoreProducts, filterAndSortProducts, productsForKeys, pushRecentKey, sanitizeKeys, toggleKey,
} from './storeCatalog'

const item = (over: Partial<StoreItem> = {}): StoreItem => ({
  id: 'item-flash-drop', name: 'Flash Drop Broadcast', desc: 'Broadcasts a photo',
  category: 'hack', cost: 1000, icon: 'Zap', badge: 'ABILITY', consumable: true, ...over,
})

const card = (over: Partial<CanonicalCard> = {}): CanonicalCard => ({
  id: 'card-1', creatorId: 'me-1', mediaObjectId: 'obj-1', name: 'Alpha', tags: ['space'],
  description: 'a card', frame: 'chrome', accentColor: '#fff', rarity: 'common', value: 100,
  likeCount: 0, marketStatus: 'none', moderationState: 'active', ownerId: 'me-1',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
})

describe('buildStoreProducts', () => {
  it('orders gear, then market newest-first, then collection, and dedupes a listed card', () => {
    const products = buildStoreProducts({
      items: [item()],
      listings: [
        { listingId: 'l-old', cardId: 'card-b', price: 200, sellerId: 'seller-1', card: card({ id: 'card-b', name: 'Beta', createdAt: '2026-01-01' }) },
        { listingId: 'l-new', cardId: 'card-c', price: 350, sellerId: 'seller-1', card: card({ id: 'card-c', name: 'Gamma', createdAt: '2026-03-01' }) },
      ],
      portfolio: [
        card({ id: 'card-b', name: 'Beta' }), // already listed -> dropped
        card({ id: 'card-d', name: 'Delta' }),
      ],
      myId: 'me-1',
    })

    expect(products.map((p) => p.key)).toEqual([
      'gear:item-flash-drop',
      'market:l-new',
      'market:l-old',
      'collection:card-d',
    ])
  })

  it('marks the player s own listing and carries the real price, never a null one', () => {
    const [market] = buildStoreProducts({
      items: [],
      listings: [{ listingId: 'l1', cardId: 'card-1', price: 0, sellerId: 'me-1', card: card({ ownerId: 'me-1' }) }],
      portfolio: [],
      myId: 'me-1',
    })
    expect(market.own).toBe(true)
    expect(market.price).toBe(0)
    expect(market.source).toBe('market')
  })
})

describe('filterAndSortProducts', () => {
  const products = buildStoreProducts({
    items: [item()],
    listings: [{ listingId: 'l1', cardId: 'card-1', price: 900, sellerId: 's', card: card({ id: 'card-1', name: 'Gold Thing', value: 900 }) }],
    portfolio: [card({ id: 'card-2', name: 'Diamond Thing', value: 6000, tags: ['rare'] })],
    myId: 'me-1',
  })

  it('filters by category', () => {
    expect(filterAndSortProducts(products, { category: 'gear' }).map((p) => p.source)).toEqual(['gear'])
    expect(filterAndSortProducts(products, { category: 'collection' }).map((p) => p.source)).toEqual(['collection'])
  })

  it('matches a query against names and tags', () => {
    expect(filterAndSortProducts(products, { query: 'diamond' }).map((p) => p.name)).toEqual(['Diamond Thing'])
    expect(filterAndSortProducts(products, { query: 'rare' }).map((p) => p.name)).toEqual(['Diamond Thing'])
    expect(filterAndSortProducts(products, { query: 'broadcast' }).map((p) => p.name)).toEqual(['Flash Drop Broadcast'])
  })

  it('sorts price ascending with the not-for-sale collection rows last', () => {
    const asc = filterAndSortProducts(products, { sort: 'price-asc' })
    expect(asc.map((p) => p.key)).toEqual(['market:l1', 'gear:item-flash-drop', 'collection:card-2'])
  })

  it('sorts by rarity, rarest first', () => {
    const byRarity = filterAndSortProducts(products, { sort: 'rarity' })
    expect(byRarity[0].name).toBe('Diamond Thing')
  })

  it('keeps build order for featured', () => {
    expect(filterAndSortProducts(products, { sort: 'featured' }).map((p) => p.key)).toEqual(products.map((p) => p.key))
  })

  it('sorts recent by the LISTING time, not the card mint date', () => {
    // The old card is listed today; the new card was listed last week.
    const withListings = buildStoreProducts({
      items: [],
      listings: [
        { listingId: 'l-old-card', cardId: 'c1', price: 10, sellerId: 's', listedAt: '2026-06-10', card: card({ id: 'c1', name: 'Minted Long Ago', createdAt: '2026-01-01' }) },
        { listingId: 'l-new-card', cardId: 'c2', price: 20, sellerId: 's', listedAt: '2026-06-01', card: card({ id: 'c2', name: 'Minted Recently', createdAt: '2026-05-30' }) },
      ],
      portfolio: [],
      myId: null,
    })
    const recent = filterAndSortProducts(withListings, { sort: 'recent' })
    expect(recent.map((p) => p.key)).toEqual(['market:l-old-card', 'market:l-new-card'])
  })
})

describe('local list helpers', () => {
  it('toggles a key in and out and caps the list', () => {
    expect(toggleKey(['a'], 'b')).toEqual(['b', 'a'])
    expect(toggleKey(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleKey(['a', 'b'], 'c', 2)).toEqual(['c', 'a'])
  })

  it('pushes a recent key to the front, deduped and capped', () => {
    expect(pushRecentKey(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(pushRecentKey(['a', 'b'], 'c', 2)).toEqual(['c', 'a'])
  })

  it('sanitizes whatever was on disk', () => {
    expect(sanitizeKeys(['a', '', 3, null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizeKeys('nope')).toEqual([])
  })

  it('resolves stored keys to live products, skipping gone ones', () => {
    const products = buildStoreProducts({ items: [item()], listings: [], portfolio: [], myId: null })
    expect(productsForKeys(products, ['gear:item-flash-drop', 'gone']).map((p) => p.key)).toEqual(['gear:item-flash-drop'])
  })
})
