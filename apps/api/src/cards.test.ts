import { describe, it, expect, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { CardService, getCashoutRateBps } from './cards'
import { DeckService } from './decks'
import { EconomyService } from './economy'
import type { D1Turso } from './db'

const CREATOR = 'creator-0001'
const BUYER = 'buyer-00001'
const OTHER = 'other-user-1'

async function seedMedia(db: D1Turso, id: string, owner: string) {
  await db
    .prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
    .bind(id, owner, 1000, 'image/jpeg')
    .run()
}

describe('CardService', () => {
  let db: D1Turso
  let cards: CardService
  let economy: EconomyService

  beforeEach(async () => {
    const env = await createMockEnv()
    db = env.DB
    cards = new CardService(db)
    economy = new EconomyService(db)
  })

  it('creates a card owned by its creator with history', async () => {
    await seedMedia(db, 'media-0001', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0001', name: 'My Card' })

    expect(card.ownerId).toBe(CREATOR)
    expect(card.creatorId).toBe(CREATOR)
    expect(card.name).toBe('My Card')
    expect(card.rarity).toBe('common')

    const history = await db.prepare('SELECT event FROM CardHistory WHERE card_id = ?').bind(card.id).all<{ event: string }>()
    expect(history.results.map((h) => h.event)).toContain('created')
  })

  it('seeds card valuation and like count from the media object', async () => {
    await db
      .prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, gacha_downloads_count) VALUES (?, ?, 1000, 'image/jpeg', ?)")
      .bind('media-valued', CREATOR, 200)
      .run()
    await db.prepare("INSERT INTO Likes (id, user_id, object_id, decision) VALUES (?, ?, ?, 'like')").bind('like-1', OTHER, 'media-valued').run()
    await db.prepare("INSERT INTO Likes (id, user_id, object_id, decision) VALUES (?, ?, ?, 'like')").bind('like-2', 'third-user-1', 'media-valued').run()

    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-valued', name: 'Valued Card' })

    expect(card.value).toBe(200)
    expect(card.likeCount).toBe(2)
    // Value 200 → Copper tier (100–499) when no rarity is supplied.
    expect(card.rarity).toBe('copper')
  })

  it('is idempotent: re-creating the same media returns the existing card and updates its name', async () => {
    await seedMedia(db, 'media-0001b', CREATOR)
    const first = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0001b', name: 'Original' })
    const again = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0001b', name: 'Renamed' })

    expect(again.id).toBe(first.id)
    expect(again.name).toBe('Renamed')

    const rows = await db.prepare('SELECT COUNT(*) AS c FROM Cards WHERE media_object_id = ?').bind('media-0001b').first<{ c: number }>()
    expect(rows?.c).toBe(1)
  })

  it('mints only once per unique picture (content_hash), returning existing card for identical image bytes', async () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    await db
      .prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_hash) VALUES (?, ?, 1000, ?, ?)')
      .bind('media-hash-1', CREATOR, 'image/jpeg', hash)
      .run()
    await db
      .prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_hash) VALUES (?, ?, 1000, ?, ?)')
      .bind('media-hash-2', CREATOR, 'image/jpeg', hash)
      .run()

    const first = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-hash-1', name: 'First Mint' })
    const second = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-hash-2', name: 'Second Mint Attempt' })

    expect(second.id).toBe(first.id)
    const count = await db.prepare('SELECT COUNT(*) AS c FROM Cards WHERE id = ?').bind(first.id).first<{ c: number }>()
    expect(count?.c).toBe(1)
  })

  it('persists bounded creator metadata on card creation', async () => {
    await seedMedia(db, 'media-meta-1', CREATOR)
    const card = await cards.createCard({
      creatorId: CREATOR,
      mediaObjectId: 'media-meta-1',
      name: 'Neon Ace',
      tags: ['art', 'NEON', 'rare', 'art'],
      description: 'A neon-trimmed showstopper.',
      frame: 'neon',
      accentColor: '#FF00FF',
    })

    expect(card.tags).toEqual(['art', 'neon', 'rare'])
    expect(card.description).toBe('A neon-trimmed showstopper.')
    expect(card.frame).toBe('neon')
    expect(card.accentColor).toBe('#FF00FF')
  })

  it('sanitizes invalid metadata to safe defaults', async () => {
    await seedMedia(db, 'media-meta-2', CREATOR)
    const card = await cards.createCard({
      creatorId: CREATOR,
      mediaObjectId: 'media-meta-2',
      name: 'Plain Card',
      tags: [123 as unknown as string, '  ', 'ok'],
      description: 'still fine',
      frame: 'lava',
      accentColor: 'not-a-color',
    })

    expect(card.tags).toEqual(['ok'])
    expect(card.description).toBe('still fine')
    expect(card.frame).toBe('chrome')
    expect(card.accentColor).toBe('#9FE3FF')
  })

  it('rejects over-length metadata', async () => {
    await seedMedia(db, 'media-meta-3', CREATOR)
    await expect(cards.createCard({
      creatorId: CREATOR,
      mediaObjectId: 'media-meta-3',
      name: 'Test Card',
      description: 'x'.repeat(300),
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(cards.createCard({
      creatorId: CREATOR,
      mediaObjectId: 'media-meta-3',
      name: 'Test Card',
      tags: ['x'.repeat(40)],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects card creation when name is missing', async () => {
    await seedMedia(db, 'media-noname', CREATOR)
    await expect(cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-noname' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-noname', name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects card creation for media the creator does not own', async () => {
    await seedMedia(db, 'media-0002', OTHER)
    await expect(cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0002', name: 'Test Card' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects card creation for media that is a public post or story', async () => {
    await db.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_public) VALUES (?, ?, 100, ?, 1)').bind('media-post', CREATOR, 'image/jpeg').run()
    await db.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story) VALUES (?, ?, 100, ?, 1)').bind('media-story', CREATOR, 'image/jpeg').run()

    await expect(cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-post', name: 'Test Card' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-story', name: 'Test Card' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('lists owned cards in the collection', async () => {
    await seedMedia(db, 'media-0003', CREATOR)
    await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0003', name: 'Test Card' })
    const collection = await cards.getCollection(CREATOR)
    expect(collection).toHaveLength(1)
  })

  it('sells a listed card atomically and moves funds', async () => {
    await seedMedia(db, 'media-0004', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0004', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 250)
    await economy.credit(BUYER, 1000, { idempotencyKey: 'seed-buyer-funds', kind: 'grant' })

    const purchase = await cards.buyCard(BUYER, card.id, 'purchase-key-0001')
    expect(purchase.amount).toBe(250)
    expect(purchase.buyerId).toBe(BUYER)
    expect(purchase.sellerId).toBe(CREATOR)

    const bought = await cards.getCard(card.id)
    expect(bought!.ownerId).toBe(BUYER)
    expect(bought!.marketStatus).toBe('none')

    await expect(economy.getBalance(CREATOR)).resolves.toBe(250)
    await expect(economy.getBalance(BUYER)).resolves.toBe(750)

    const history = await db.prepare('SELECT event FROM CardHistory WHERE card_id = ?').bind(card.id).all<{ event: string }>()
    expect(history.results.map((h) => h.event)).toContain('purchased')
  })

  it('rejects a purchase with insufficient funds and changes nothing', async () => {
    await seedMedia(db, 'media-0005', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0005', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 500)

    await expect(cards.buyCard(BUYER, card.id, 'purchase-key-0002')).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })

    const still = await cards.getCard(card.id)
    expect(still!.ownerId).toBe(CREATOR)
    expect(still!.marketStatus).toBe('listed')
    await expect(economy.getBalance(CREATOR)).resolves.toBe(0)
  })

  it('is idempotent on repeated purchase with the same key', async () => {
    await seedMedia(db, 'media-0006', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0006', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 100)
    await economy.credit(BUYER, 1000, { idempotencyKey: 'seed-buyer-2', kind: 'grant' })

    await cards.buyCard(BUYER, card.id, 'purchase-key-0003')
    const replay = await cards.buyCard(BUYER, card.id, 'purchase-key-0003')

    expect(replay.replayed).toBe(true)
    await expect(economy.getBalance(BUYER)).resolves.toBe(900)
  })

  it('forbids buying your own listed card', async () => {
    await seedMedia(db, 'media-0007', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0007', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 100)
    await expect(cards.buyCard(CREATOR, card.id, 'purchase-key-0004')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cancels a listing only by the seller', async () => {
    await seedMedia(db, 'media-0008', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0008', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 100)
    await cards.cancelListing(CREATOR, card.id)

    const after = await cards.getCard(card.id)
    expect(after!.marketStatus).toBe('none')

    await cards.listForSale(CREATOR, card.id, 120)
    await expect(cards.cancelListing(OTHER, card.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('transfers ownership only from the current owner', async () => {
    await seedMedia(db, 'media-0009', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0009', name: 'Test Card' })

    await expect(cards.transferOwnership(OTHER, BUYER, card.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const transferred = await cards.transferOwnership(CREATOR, BUYER, card.id)
    expect(transferred.ownerId).toBe(BUYER)
  })

  it('rejects purchase key reuse by a different buyer', async () => {
    await seedMedia(db, 'media-0010', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0010', name: 'Test Card' })
    await cards.listForSale(CREATOR, card.id, 100)
    await economy.credit(BUYER, 1000, { idempotencyKey: 'seed-buyer-3', kind: 'grant' })

    await cards.buyCard(BUYER, card.id, 'purchase-key-0005')

    // A different buyer reusing the same key must not receive BUYER's purchase.
    await expect(cards.buyCard(OTHER, card.id, 'purchase-key-0005')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('rejects listing a card the caller no longer owns (atomic check)', async () => {
    await seedMedia(db, 'media-0011', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0011', name: 'Test Card' })
    await cards.transferOwnership(CREATOR, BUYER, card.id)

    await expect(cards.listForSale(CREATOR, card.id, 100)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns card history to owner/creator and forbids strangers', async () => {
    await seedMedia(db, 'media-0012', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0012', name: 'History' })
    await cards.transferOwnership(CREATOR, BUYER, card.id)

    const history = await cards.getHistory(card.id, CREATOR)
    const events = history.map((h) => h.event)
    expect(events).toContain('created')
    expect(events).toContain('transferred')

    await expect(cards.getHistory(card.id, OTHER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('browses open marketplace listings and excludes non-active cards', async () => {
    await seedMedia(db, 'media-0013', CREATOR)
    await seedMedia(db, 'media-0014', CREATOR)
    const a = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0013', name: 'Test Card A' })
    const b = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-0014', name: 'Test Card B' })
    await cards.listForSale(CREATOR, a.id, 300)
    await cards.listForSale(CREATOR, b.id, 150)
    await db.prepare("UPDATE Cards SET moderation_state = 'hidden' WHERE id = ?").bind(b.id).run()

    const listings = await cards.listMarket()
    expect(listings).toHaveLength(1)
    expect(listings[0].cardId).toBe(a.id)
    expect(listings[0].price).toBe(300)
    expect(listings[0].sellerId).toBe(CREATOR)
  })

  it('cashes out a card for g$ and burns it from the collection', async () => {
    await seedMedia(db, 'media-cash-1', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-1', name: 'Cash Card' })
    await db.prepare('UPDATE Cards SET value = 1000 WHERE id = ?').bind(card.id).run()

    const result = await cards.cashOutCard(CREATOR, card.id, 'cashout-key-0001')
    expect(result.payout).toBe(1250) // 1000 * 125% default rate
    expect(result.rateBps).toBe(12500)
    expect(result.balance).toBe(1250)

    await expect(economy.getBalance(CREATOR)).resolves.toBe(1250)

    // Card is removed from the collection but its row survives for audit.
    const collection = await cards.getCollection(CREATOR)
    expect(collection.find((c) => c.id === card.id)).toBeUndefined()

    const media = await db.prepare('SELECT id FROM Objects WHERE id = ?').bind('media-cash-1').first()
    expect(media).toBeNull()

    const audited = await cards.getCard(card.id)
    expect(audited!.marketStatus).toBe('cashed_out')

    const history = await db.prepare('SELECT event FROM CardHistory WHERE card_id = ?').bind(card.id).all<{ event: string }>()
    expect(history.results.map((h) => h.event)).toContain('cashed_out')
  })

  it('rejects cashing out a listed card', async () => {
    await seedMedia(db, 'media-cash-2', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-2', name: 'Cash Card' })
    await cards.listForSale(CREATOR, card.id, 100)

    await expect(cards.cashOutCard(CREATOR, card.id, 'cashout-key-0002')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects a second cashout of the same card', async () => {
    await seedMedia(db, 'media-cash-3', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-3', name: 'Cash Card' })
    await cards.cashOutCard(CREATOR, card.id, 'cashout-key-0003')

    await expect(cards.cashOutCard(CREATOR, card.id, 'cashout-key-0003b')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('is idempotent on repeated cashout with the same key', async () => {
    await seedMedia(db, 'media-cash-4', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-4', name: 'Cash Card' })
    await db.prepare('UPDATE Cards SET value = 500 WHERE id = ?').bind(card.id).run()

    await cards.cashOutCard(CREATOR, card.id, 'cashout-key-0004')
    const replay = await cards.cashOutCard(CREATOR, card.id, 'cashout-key-0004')

    expect(replay.replayed).toBe(true)
    await expect(economy.getBalance(CREATOR)).resolves.toBe(625) // 500 * 125%
  })

  it('uses the admin-controlled cashout rate', async () => {
    await db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('economy_cashout_rate_bps', '20000') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
    await expect(getCashoutRateBps(db)).resolves.toBe(20000)

    await seedMedia(db, 'media-cash-5', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-5', name: 'Cash Card' })
    await db.prepare('UPDATE Cards SET value = 1000 WHERE id = ?').bind(card.id).run()

    const result = await cards.cashOutCard(CREATOR, card.id, 'cashout-key-0005')
    expect(result.rateBps).toBe(20000)
    expect(result.payout).toBe(2000) // 1000 * 200%
  })

  it('removes the card from every deck on cash-out', async () => {
    const decks = new DeckService(db)
    await seedMedia(db, 'media-cash-deck', CREATOR)
    const card = await cards.createCard({ creatorId: CREATOR, mediaObjectId: 'media-cash-deck', name: 'Deck Card' })

    const deck = await decks.createDeck(CREATOR, 'Deck For Burn')
    await decks.addCard(CREATOR, deck.id, card.id)

    const before = await db.prepare('SELECT card_id FROM DeckCards WHERE card_id = ?').bind(card.id).all()
    expect(before.results.length).toBe(1)

    await cards.cashOutCard(CREATOR, card.id, 'cashout-key-deck-0001')

    const after = await db.prepare('SELECT card_id FROM DeckCards WHERE card_id = ?').bind(card.id).all()
    expect(after.results.length).toBe(0)

    // The deck no longer reports a dangling ownership violation.
    const validation = await decks.validateDeck(deck.id)
    expect(validation.issues.some((i) => i.includes(card.id))).toBe(false)
  })

  it('clamps a malformed stored cashout rate into legal bounds', async () => {
    await db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('economy_cashout_rate_bps', '999999') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
    await expect(getCashoutRateBps(db)).resolves.toBe(50000)
  })
})
