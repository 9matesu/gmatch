import { describe, it, expect, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { DeckService, DEFAULT_CARD_DUEL_RULES } from './decks'
import { CardService } from './cards'
import type { D1Turso } from './db'

const OWNER = 'deck-owner-01'
const OTHER = 'deck-other-1'

async function seedMedia(db: D1Turso, id: string, owner: string) {
  await db
    .prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
    .bind(id, owner, 1000, 'image/jpeg')
    .run()
}

describe('DeckService', () => {
  let db: D1Turso
  let decks: DeckService
  let cards: CardService

  beforeEach(async () => {
    const env = await createMockEnv()
    db = env.DB
    decks = new DeckService(db)
    cards = new CardService(db)
  })

  it('creates a deck owned by the caller', async () => {
    const deck = await decks.createDeck(OWNER, 'My Deck')
    expect(deck.ownerId).toBe(OWNER)
    expect(deck.gameId).toBe('card-duel')
    expect(deck.cards).toHaveLength(0)
  })

  it('adds an owned, active card to a deck', async () => {
    await seedMedia(db, 'media-0001', OWNER)
    const card = await cards.createCard({ creatorId: OWNER, mediaObjectId: 'media-0001' })
    const deck = await decks.createDeck(OWNER, 'Deck A')

    const updated = await decks.addCard(OWNER, deck.id, card.id)
    expect(updated.cards).toEqual([card.id])
  })

  it('rejects adding a card the caller does not own', async () => {
    await seedMedia(db, 'media-0002', OTHER)
    const card = await cards.createCard({ creatorId: OTHER, mediaObjectId: 'media-0002' })
    const deck = await decks.createDeck(OWNER, 'Deck B')

    await expect(decks.addCard(OWNER, deck.id, card.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects duplicate cards in a deck', async () => {
    await seedMedia(db, 'media-0003', OWNER)
    const card = await cards.createCard({ creatorId: OWNER, mediaObjectId: 'media-0003' })
    const deck = await decks.createDeck(OWNER, 'Deck C')

    await decks.addCard(OWNER, deck.id, card.id)
    await expect(decks.addCard(OWNER, deck.id, card.id)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects a moderated card from a deck', async () => {
    await seedMedia(db, 'media-0004', OWNER)
    const card = await cards.createCard({ creatorId: OWNER, mediaObjectId: 'media-0004' })
    await db.prepare("UPDATE Cards SET moderation_state = 'banned' WHERE id = ?").bind(card.id).run()
    const deck = await decks.createDeck(OWNER, 'Deck D')

    await expect(decks.addCard(OWNER, deck.id, card.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('enforces max deck size', async () => {
    const deck = await decks.createDeck(OWNER, 'Deck E')
    const rules = { minSize: 1, maxSize: 2 }
    const cardIds: string[] = []
    for (let i = 1; i <= 3; i++) {
      const media = `media-${String(i).padStart(4, '0')}`
      await seedMedia(db, media, OWNER)
      const c = await cards.createCard({ creatorId: OWNER, mediaObjectId: media })
      cardIds.push(c.id)
    }

    await decks.addCard(OWNER, deck.id, cardIds[0], rules)
    await decks.addCard(OWNER, deck.id, cardIds[1], rules)
    await expect(decks.addCard(OWNER, deck.id, cardIds[2], rules)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('validates a deck against size rules', async () => {
    await seedMedia(db, 'media-0005', OWNER)
    const card = await cards.createCard({ creatorId: OWNER, mediaObjectId: 'media-0005' })
    const deck = await decks.createDeck(OWNER, 'Deck F')

    const empty = await decks.validateDeck(deck.id, DEFAULT_CARD_DUEL_RULES)
    expect(empty.valid).toBe(false)

    await decks.addCard(OWNER, deck.id, card.id)
    const filled = await decks.validateDeck(deck.id, DEFAULT_CARD_DUEL_RULES)
    expect(filled.valid).toBe(true)
    expect(filled.issues).toHaveLength(0)
  })

  it('removes a card from a deck', async () => {
    await seedMedia(db, 'media-0006', OWNER)
    const card = await cards.createCard({ creatorId: OWNER, mediaObjectId: 'media-0006' })
    const deck = await decks.createDeck(OWNER, 'Deck G')
    await decks.addCard(OWNER, deck.id, card.id)

    const updated = await decks.removeCard(OWNER, deck.id, card.id)
    expect(updated.cards).toHaveLength(0)
  })

  it('rejects deck creation for an unknown game id', async () => {
    await expect(decks.createDeck(OWNER, 'Ghost Deck', 'no-such-game')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
