import { describe, expect, it } from 'vitest'
import { applyCanonicalCard } from './galleryMapping'
import type { CanonicalCard } from '../utils/cardCollection'

function card(over: Partial<CanonicalCard> = {}): CanonicalCard {
  return {
    id: 'card-1',
    creatorId: 'u1',
    mediaObjectId: 'm1',
    name: 'My Card',
    tags: ['alpha', 'beta'],
    description: 'desc',
    frame: 'gold',
    accentColor: '#ffcc00',
    rarity: 'gold',
    value: 800,
    likeCount: 42,
    marketStatus: 'none',
    moderationState: 'active',
    ownerId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as CanonicalCard
}

const raw: Record<string, any> = {
  id: 'm1',
  caption: 'old caption',
  tags: ['stale', 'removed'],
  description: 'old desc',
  likes_count: 1,
}

describe('applyCanonicalCard', () => {
  it('returns the raw item untouched when there is no canonical card', () => {
    expect(applyCanonicalCard(raw, null)).toBe(raw)
    expect(applyCanonicalCard(raw, undefined)).toBe(raw)
  })

  it('uses canonical tags as the source of truth', () => {
    const mapped = applyCanonicalCard(raw, card({ tags: ['alpha', 'beta'] }))
    expect(mapped.tags).toEqual(['alpha', 'beta'])
  })

  it('does not resurrect stale media tags when card tags were cleared (regression)', () => {
    const mapped = applyCanonicalCard(raw, card({ tags: [] }))
    expect(mapped.tags).toEqual([])
    expect(mapped.tags).not.toContain('stale')
    expect(mapped.tags).not.toContain('removed')
  })

  it('parses string-encoded canonical tags', () => {
    const mapped = applyCanonicalCard(raw, card({ tags: '["x","y"]' as unknown as string[] }))
    expect(mapped.tags).toEqual(['x', 'y'])
  })

  it('maps value/rarity/likes onto both legacy field names', () => {
    const mapped = applyCanonicalCard(raw, card({ value: 800, rarity: 'gold', likeCount: 42 }))
    expect(mapped.value).toBe(800)
    expect(mapped.gacha_downloads_count).toBe(800)
    expect(mapped.rarity).toBe('gold')
    expect(mapped.likes_count).toBe(42)
    expect(mapped.like_count).toBe(42)
    expect(mapped.card_id).toBe('card-1')
    expect(mapped.accent_color).toBe('#ffcc00')
  })
})
