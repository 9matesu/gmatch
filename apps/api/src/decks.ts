// DeckService — per-game deck ownership and validation.
//
// A deck is owned by one user and scoped to a game id. Deck size / eligibility
// rules are game-defined via `DeckRules` so new games can impose different
// requirements without touching this service. DeckCards enforces no duplicate
// card within a deck (UNIQUE(deck_id, card_id)); ownership, moderation, and
// capacity are re-validated inside the same write transaction as the insert so
// concurrent additions cannot exceed the limit or deck a card the user no
// longer owns.

import crypto from 'crypto'
import type { D1Turso } from './db'
import { badRequest, conflict, forbidden, notFound } from './common/errors'
import { requireId, requireString, requireNonNegativeInt } from './common/validation'
import { getGame } from './games'

export interface DeckRules {
  minSize: number
  maxSize: number
}

export const DEFAULT_CARD_DUEL_RULES: DeckRules = { minSize: 1, maxSize: 5 }

export interface DeckRecord {
  id: string
  ownerId: string
  name: string
  gameId: string
  cards: string[]
  createdAt: string
  updatedAt: string
}

export interface DeckValidation {
  valid: boolean
  issues: string[]
}

interface DeckRow {
  id: string
  owner_id: string
  name: string
  game_id: string
  created_at: string
  updated_at: string
}

function validateRules(rules: DeckRules): DeckRules {
  const minSize = requireNonNegativeInt(rules.minSize, 'minSize', { max: 1000 })
  const maxSize = requireNonNegativeInt(rules.maxSize, 'maxSize', { max: 1000 })
  if (minSize > maxSize) throw badRequest('minSize must be <= maxSize')
  return { minSize, maxSize }
}

export class DeckService {
  constructor(private db: D1Turso) {}

  async createDeck(ownerId: string, name: string, gameId = 'card-duel'): Promise<DeckRecord> {
    requireId(ownerId, 'ownerId')
    const deckName = requireString(name, 'name', { min: 1, max: 60 })
    const gid = requireString(gameId, 'gameId', { min: 1, max: 40 })
    getGame(gid) // reject unknown game ids

    const id = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    await this.db
      .prepare('INSERT INTO Decks (id, owner_id, name, game_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, ownerId, deckName, gid, nowIso, nowIso)
      .run()

    return (await this.getDeck(id, ownerId))!
  }

  async getDeck(deckId: string, callerId?: string): Promise<DeckRecord | null> {
    requireId(deckId, 'deckId')
    const row = await this.db.prepare('SELECT * FROM Decks WHERE id = ?').bind(deckId).first<DeckRow>()
    if (!row) return null
    if (callerId && callerId !== row.owner_id) return null

    const cards = await this.db
      .prepare('SELECT card_id FROM DeckCards WHERE deck_id = ? ORDER BY position ASC, created_at ASC')
      .bind(deckId)
      .all<{ card_id: string }>()

    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      gameId: row.game_id,
      cards: cards.results.map((c) => c.card_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async getDecksForUser(ownerId: string): Promise<DeckRecord[]> {
    requireId(ownerId, 'ownerId')
    const rows = await this.db
      .prepare('SELECT * FROM Decks WHERE owner_id = ? ORDER BY created_at ASC')
      .bind(ownerId)
      .all<DeckRow>()

    const decks: DeckRecord[] = []
    for (const row of rows.results) {
      const deck = await this.getDeck(row.id, ownerId)
      if (deck) decks.push(deck)
    }
    return decks
  }

  async renameDeck(ownerId: string, deckId: string, name: string): Promise<DeckRecord> {
    requireId(ownerId, 'ownerId')
    requireId(deckId, 'deckId')
    const deckName = requireString(name, 'name', { min: 1, max: 60 })
    await this.requireOwnedDeck(deckId, ownerId)
    await this.db.prepare('UPDATE Decks SET name = ?, updated_at = ? WHERE id = ?')
      .bind(deckName, new Date().toISOString(), deckId)
      .run()
    return (await this.getDeck(deckId, ownerId))!
  }

  async deleteDeck(ownerId: string, deckId: string): Promise<void> {
    requireId(ownerId, 'ownerId')
    requireId(deckId, 'deckId')
    await this.requireOwnedDeck(deckId, ownerId)
    await this.db.prepare('DELETE FROM Decks WHERE id = ? AND owner_id = ?').bind(deckId, ownerId).run()
  }

  async addCard(ownerId: string, deckId: string, cardId: string, rules: DeckRules = DEFAULT_CARD_DUEL_RULES): Promise<DeckRecord> {
    requireId(ownerId, 'ownerId')
    requireId(deckId, 'deckId')
    requireId(cardId, 'cardId')
    const { maxSize } = validateRules(rules)

    const deck = await this.requireOwnedDeck(deckId, ownerId)

    // Pre-checks for friendly errors; the atomic insert re-validates below.
    const ownership = await this.db
      .prepare('SELECT owner_id FROM CardOwnership WHERE card_id = ?')
      .bind(cardId)
      .first<{ owner_id: string }>()
    if (!ownership) throw notFound('card not found')
    if (ownership.owner_id !== ownerId) throw forbidden('you do not own this card')

    const card = await this.db
      .prepare('SELECT moderation_state FROM Cards WHERE id = ?')
      .bind(cardId)
      .first<{ moderation_state: string }>()
    if (!card) throw notFound('card not found')
    if (card.moderation_state !== 'active') throw forbidden('this card is not eligible')

    if (deck.cards.length >= maxSize) {
      throw badRequest(`deck is full (max ${maxSize} cards)`)
    }

    const nowIso = new Date().toISOString()
    let res
    try {
      res = await this.db.atomicBatch([
        {
          sql: `INSERT INTO DeckCards (deck_id, card_id, position, created_at)
                SELECT ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM DeckCards WHERE deck_id = ?), ?
                WHERE EXISTS (SELECT 1 FROM CardOwnership WHERE card_id = ? AND owner_id = ?)
                  AND EXISTS (SELECT 1 FROM Cards WHERE id = ? AND moderation_state = 'active')
                  AND (SELECT COUNT(*) FROM DeckCards WHERE deck_id = ?) < ?`,
          args: [deckId, cardId, deckId, nowIso, cardId, ownerId, cardId, deckId, maxSize],
        },
        { sql: 'UPDATE Decks SET updated_at = ? WHERE id = ? AND changes() = 1', args: [nowIso, deckId] },
      ])
    } catch (err: any) {
      if (err?.code?.includes('CONSTRAINT')) throw conflict('card is already in this deck')
      throw err
    }

    if (res[0].rowsAffected === 0) {
      throw conflict('card cannot be added (ownership, eligibility, or capacity changed)')
    }

    return (await this.getDeck(deckId, ownerId))!
  }

  async removeCard(ownerId: string, deckId: string, cardId: string): Promise<DeckRecord> {
    requireId(ownerId, 'ownerId')
    requireId(deckId, 'deckId')
    requireId(cardId, 'cardId')

    await this.requireOwnedDeck(deckId, ownerId)

    const nowIso = new Date().toISOString()
    await this.db.atomicBatch([
      { sql: 'DELETE FROM DeckCards WHERE deck_id = ? AND card_id = ?', args: [deckId, cardId] },
      { sql: 'UPDATE Decks SET updated_at = ? WHERE id = ?', args: [nowIso, deckId] },
    ])

    return (await this.getDeck(deckId, ownerId))!
  }

  /** The deck a player queues with: must exist, belong to them, hold exactly
   * `minSize` cards, and every member must still be owned + active. getDeck
   * already 404s foreign decks via the caller filter. */
  async getQueueEligibleDeck(deckId: string, ownerId: string, minSize: number): Promise<DeckRecord> {
    const deck = await this.getDeck(deckId, ownerId)
    if (!deck) throw notFound('deck not found')
    if (deck.cards.length !== minSize) throw conflict(`deck must have exactly ${minSize} cards`)
    const bad = await this.db
      .prepare(`
        SELECT COUNT(*) AS n FROM DeckCards dc
        LEFT JOIN Cards c ON c.id = dc.card_id
        LEFT JOIN CardOwnership co ON co.card_id = c.id AND co.owner_id = ?
        WHERE dc.deck_id = ? AND (c.id IS NULL OR c.moderation_state != 'active' OR co.card_id IS NULL)
      `)
      .bind(ownerId, deckId)
      .first<{ n: number }>()
    if ((bad?.n ?? 0) > 0) throw conflict('deck contains ineligible cards')
    return deck
  }

  // Validate a deck against the given rules and current ownership/moderation
  // state. Uses LEFT JOINs so cards whose ownership row is missing are reported
  // as violations rather than silently omitted.
  async validateDeck(deckId: string, rules: DeckRules = DEFAULT_CARD_DUEL_RULES): Promise<DeckValidation> {
    requireId(deckId, 'deckId')
    const { minSize, maxSize } = validateRules(rules)
    const row = await this.db.prepare('SELECT * FROM Decks WHERE id = ?').bind(deckId).first<DeckRow>()
    if (!row) throw notFound('deck not found')

    const members = await this.db
      .prepare(
        `SELECT dc.card_id, o.owner_id AS card_owner_id, c.moderation_state
         FROM DeckCards dc
         LEFT JOIN CardOwnership o ON o.card_id = dc.card_id
         LEFT JOIN Cards c ON c.id = dc.card_id
         WHERE dc.deck_id = ?`,
      )
      .bind(deckId)
      .all<{ card_id: string; card_owner_id: string | null; moderation_state: string | null }>()

    const cardIds = members.results.map((m) => m.card_id)
    const issues: string[] = []

    if (cardIds.length < minSize) issues.push(`deck needs at least ${minSize} card(s)`)
    if (cardIds.length > maxSize) issues.push(`deck exceeds ${maxSize} cards`)

    // Distinctness is guaranteed by UNIQUE(deck_id, card_id), but report it if
    // data somehow violated the constraint.
    if (new Set(cardIds).size !== cardIds.length) issues.push('deck contains duplicate cards')

    for (const m of members.results) {
      if (!m.card_owner_id) issues.push(`card ${m.card_id} has no ownership record`)
      else if (m.card_owner_id !== row.owner_id) issues.push(`card ${m.card_id} is not owned by the deck owner`)
      if (!m.moderation_state || m.moderation_state !== 'active') issues.push(`card ${m.card_id} is not eligible`)
    }

    return { valid: issues.length === 0, issues }
  }

  private async requireOwnedDeck(deckId: string, ownerId: string): Promise<DeckRecord> {
    const deck = await this.getDeck(deckId, ownerId)
    if (!deck) throw notFound('deck not found')
    return deck
  }
}
