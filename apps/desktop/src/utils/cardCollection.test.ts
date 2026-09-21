import { describe, it, expect } from 'vitest'
import { deriveMyCards, mergeMyCards, filterToActiveDeck, type CanonicalCard } from './cardCollection'
import type { OrbitObject } from '@orbit/shared'

const base = {
  owner_id: '',
  size_bytes: 1,
  mime_type: 'image/jpeg',
  content_url: 'data:image/jpeg;base64,/9j/4AAQ',
  created_at: new Date().toISOString(),
}

const cardBase: CanonicalCard = {
  id: 'card-1',
  creatorId: 'me',
  mediaObjectId: 'obj-1',
  name: 'My Card',
  rarity: 'common',
  value: 100,
  likeCount: 0,
  marketStatus: 'none',
  moderationState: 'active',
  ownerId: 'me',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  contentUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  tags: [],
  description: null,
  frame: 'chrome',
  accentColor: '#9FE3FF',
}

describe('card collection derivation', () => {
  it('includes only non-story, non-public, non-chat objects the user owns', () => {
    const items = [
      { ...base, id: 'own-card', owner_id: 'me' },
      { ...base, id: 'own-story', owner_id: 'me', is_story: 1 },
      { ...base, id: 'own-post', owner_id: 'me', is_public: 1 },
      { ...base, id: 'own-chat', owner_id: 'me', is_chat: 1 },
      { ...base, id: 'other-card', owner_id: 'them' },
      { ...base, id: 'p2p-obj-123', owner_id: 'them' },
    ]
    const cards = deriveMyCards(items as OrbitObject[], 'me')
    expect(cards.map(c => c.id)).toEqual(['own-card'])
  })

  it('dedupes by id, not content_url', () => {
    const items = [
      { ...base, id: 'a', owner_id: 'me', content_url: 'data:image/jpeg;base64,SAME' },
      { ...base, id: 'b', owner_id: 'me', content_url: 'data:image/jpeg;base64,SAME' },
    ]
    const cards = deriveMyCards(items as OrbitObject[], 'me')
    expect(cards.length).toBe(2)
  })

  it('returns empty for anonymous', () => {
    expect(deriveMyCards([], '')).toEqual([])
  })
})

describe('mergeMyCards', () => {
  it('returns only canonical cards, ignoring unminted objects (uploads are not cards)', () => {
    const items = [
      { ...base, id: 'obj-1', owner_id: 'me' },
      { ...base, id: 'legacy-1', owner_id: 'me' },
    ]
    const merged = mergeMyCards(items as OrbitObject[], [cardBase], 'me')
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('obj-1')
    expect(merged[0].card_id).toBe('card-1')
    expect(merged[0].rarity).toBe('common')
    expect(merged[0].gacha_downloads_count).toBe(100)
  })

  it('excludes canonical cards owned by someone else', () => {
    const foreign: CanonicalCard = { ...cardBase, id: 'card-x', mediaObjectId: 'obj-x', ownerId: 'them' }
    const merged = mergeMyCards(
      [{ ...base, id: 'obj-x', owner_id: 'them' }] as OrbitObject[],
      [cardBase, foreign],
      'me'
    )
    expect(merged.map((m) => m.card_id)).toEqual(['card-1'])
  })

  it('returns empty when there are no canonical cards, even with stories, posts, and chat attachments', () => {
    const items = [
      { ...base, id: 'plain-obj', owner_id: 'me' },
      { ...base, id: 'story', owner_id: 'me', is_story: 1 },
      { ...base, id: 'post', owner_id: 'me', is_public: 1 },
      { ...base, id: 'chat-pic', owner_id: 'me', is_chat: 1 },
    ]
    const merged = mergeMyCards(items as OrbitObject[], [], 'me')
    expect(merged).toEqual([])
  })

  it('excludes avatar objects and objects matching the user profile picture', () => {
    const items = [
      { ...base, id: 'plain-card', owner_id: 'me' },
      { ...base, id: 'avatar-flagged', owner_id: 'me', is_avatar: 1 },
      { ...base, id: 'avatar-url-match', owner_id: 'me', content_url: '/api/objects/avatar-url-match' },
    ]
    const derived = deriveMyCards(items as OrbitObject[], 'me', '/api/objects/avatar-url-match')
    expect(derived.map(c => c.id)).toEqual(['plain-card'])

    const merged = mergeMyCards(items as OrbitObject[], [], 'me', '/api/objects/avatar-url-match')
    expect(merged).toEqual([])
  })
})
describe('filterToActiveDeck', () => {
  const mk = (id: string, card_id?: string) => ({ id, ...(card_id ? { card_id } : {}) })
  it('returns all cards when no active deck or empty deck', () => {
    expect(filterToActiveDeck([mk('a')], undefined)).toHaveLength(1)
    expect(filterToActiveDeck([mk('a')], { cards: [] } as any)).toHaveLength(1)
  })
  it('keeps only cards whose canonical id is in the deck', () => {
    const cards = [mk('m1', 'c1'), mk('m2', 'c2')]
    expect(filterToActiveDeck(cards, { cards: ['c1'] } as any)).toEqual([cards[0]])
  })
  it('falls back to all cards when deck members are not in the list', () => {
    const cards = [mk('m1', 'c1')]
    expect(filterToActiveDeck(cards, { cards: ['zz'] } as any)).toEqual(cards)
  })
})
