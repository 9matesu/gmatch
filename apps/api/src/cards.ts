// CardService — canonical card asset + ownership + marketplace.
//
// Data ownership:
//   - Cards        -> immutable-ish metadata (creator, media reference, value)
//   - CardOwnership-> the single source of truth for who owns a card
//   - CardHistory  -> append-only audit of every ownership/market event
//   - MarketListings -> one open listing per card at a time
//
// Ownership changes are always server-validated and conditional within the same
// write transaction as the money movement, so a purchase can never charge the
// buyer without transferring the card (and vice versa). Every marketplace
// mutation re-verifies ownership/listing state inside the atomic batch rather
// than trusting a prior read.

import crypto from 'crypto'
import type { D1Turso, AtomicStatement } from './db'
import { SqlError } from './db'
import { computeCardRarity, computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, type CardRarity } from '@orbit/shared'
import { badRequest, conflict, forbidden, idempotencyConflict, insufficientFunds, notFound } from './common/errors'
import { requireId, requireString, requireNonNegativeInt } from './common/validation'
import { EconomyService, buildTransferStatements, type TransferResult } from './economy'

export type ModerationState = 'active' | 'hidden' | 'banned'
export type MarketStatus = 'none' | 'listed' | 'sold' | 'cancelled' | 'cashed_out'

const RARITIES: readonly CardRarity[] = ['common', 'copper', 'silver', 'gold', 'diamond']

const CASHOUT_RATE_KEY = 'economy_cashout_rate_bps'

// Read the admin-controlled cashout inflation rate from SystemMeta. Falls back
// to the shared default and clamps to the legal range so a malformed stored
// value can never produce an absurd payout.
export async function getCashoutRateBps(db: D1Turso): Promise<number> {
  const row = await db
    .prepare('SELECT value FROM SystemMeta WHERE key = ?')
    .bind(CASHOUT_RATE_KEY)
    .first<{ value: string | null }>()
  if (row?.value) return clampCashoutRateBps(Number(row.value))
  return DEFAULT_CASHOUT_RATE_BPS
}

export interface CardRecord {
  id: string
  creatorId: string
  mediaObjectId: string
  name: string | null
  tags: string[]
  description: string | null
  frame: string
  accentColor: string
  rarity: CardRarity
  value: number
  likeCount: number
  marketStatus: MarketStatus
  moderationState: ModerationState
  ownerId: string
  createdAt: string
  updatedAt: string
  // Media projection (joined from Objects) so consumers can render the card
  // without a separate object lookup.
  contentUrl?: string | null
  mimeType?: string | null
  caption?: string | null
}

export interface PurchaseResult extends TransferResult {
  cardId: string
  sellerId: string
  buyerId: string
}

export interface CashOutResult {
  operationId: string
  cardId: string
  userId: string
  value: number
  rateBps: number
  payout: number
  balance: number
  replayed?: boolean
}

export interface CardHistoryRecord {
  id: string
  cardId: string
  event: string
  fromUser: string | null
  toUser: string | null
  meta: unknown
  createdAt: string
}

export interface MarketListingRecord {
  listingId: string
  cardId: string
  price: number
  sellerId: string
  listedAt: string
  card: CardRecord
}

export interface BackfillResult {
  created: number
  skipped: number
}

interface CardRow {
  id: string
  creator_id: string
  media_object_id: string
  name: string | null
  tags?: string | null
  description?: string | null
  frame?: string | null
  accent_color?: string | null
  rarity: CardRarity
  value: number
  like_count: number
  market_status: MarketStatus
  moderation_state: ModerationState
  created_at: string
  updated_at: string
  content_url?: string | null
  mime_type?: string | null
  caption?: string | null
}

function isConstraintError(err: unknown): boolean {
  return err instanceof SqlError && !!err.code && err.code.includes('CONSTRAINT')
}

function parseStored(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseTags(raw: string | null | undefined): string[] {
  const parsed = parseStored(raw ?? null)
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
}

function mapCard(row: CardRow, ownerId: string): CardRecord {
  return {
    id: row.id,
    creatorId: row.creator_id,
    mediaObjectId: row.media_object_id,
    name: row.name,
    tags: parseTags(row.tags),
    description: row.description ?? null,
    frame: row.frame || 'chrome',
    accentColor: row.accent_color || '#9FE3FF',
    rarity: row.rarity,
    value: row.value,
    likeCount: row.like_count,
    marketStatus: row.market_status,
    moderationState: row.moderation_state,
    ownerId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentUrl: row.content_url,
    mimeType: row.mime_type,
    caption: row.caption,
  }
}

// A fully-specified card mint input (media + metadata). Used by pack opening and
// starter-deck initialization where media is generated/fetched server-side.
export interface MintCardSpec {
  name: string | null
  rarity: CardRarity
  contentUrl: string
  mimeType: string
  sizeBytes: number
  value?: number
}

// Statement list that mints one canonical card (Objects media + Cards +
// CardOwnership + CardHistory). Every statement is gated on SQLite's changes()
// so it composes with a preceding gate (e.g. inventory decrement or an
// init-marker insert) inside a single atomicBatch — if the gate fails, the card
// is not minted.
export function mintCardStatements(params: {
  ownerId: string
  cardId: string
  objectId: string
  spec: MintCardSpec
  historyId: string
  nowIso: string
  source: string
}): AtomicStatement[] {
  const { ownerId, cardId, objectId, spec, historyId, nowIso, source } = params
  const value = spec.value != null && Number.isSafeInteger(spec.value) && spec.value >= 0 ? spec.value : 0
  return [
    { sql: 'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story, created_at) SELECT ?, ?, ?, ?, ?, 0, 0, ? WHERE changes() = 1', args: [objectId, ownerId, spec.sizeBytes, spec.mimeType, spec.contentUrl, nowIso] },
    { sql: "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, 0, 'none', 'active', ?, ? WHERE changes() = 1", args: [cardId, ownerId, objectId, spec.name, spec.rarity, value, nowIso, nowIso] },
    { sql: 'INSERT INTO CardOwnership (card_id, owner_id, acquired_at) SELECT ?, ?, ? WHERE changes() = 1', args: [cardId, ownerId, nowIso] },
    { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta, created_at) SELECT ?, ?, 'created', NULL, ?, ?, ? WHERE changes() = 1", args: [historyId, cardId, ownerId, JSON.stringify({ source, mediaObjectId: objectId }), nowIso] },
  ]
}

export class CardService {
  private economy: EconomyService

  constructor(private db: D1Turso) {
    this.economy = new EconomyService(db)
  }

  // Mint a single canonical card from server-generated media (no pre-existing
  // media object required). Creates Objects + Cards + CardOwnership + CardHistory
  // atomically. Used by starter-deck initialization and other server mints.
  async mintCard(input: {
    ownerId: string
    name?: string | null
    rarity?: CardRarity
    contentUrl: string
    mimeType: string
    sizeBytes: number
    value?: number
    source: string
  }): Promise<CardRecord> {
    const ownerId = requireId(input.ownerId, 'ownerId')
    const rarity = input.rarity ?? 'common'
    if (!(RARITIES as readonly string[]).includes(rarity)) {
      throw badRequest('rarity must be one of: ' + RARITIES.join(', '))
    }
    const name = input.name ? requireString(input.name, 'name', { max: 80 }) : null
    const contentUrl = requireString(input.contentUrl, 'contentUrl', { max: 5_000_000 })
    const mimeType = requireString(input.mimeType, 'mimeType', { min: 1, max: 100 })
    const value = input.value != null && Number.isSafeInteger(input.value) && input.value >= 0 ? input.value : 0

    const cardId = crypto.randomUUID()
    const objectId = crypto.randomUUID()
    const historyId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    await this.db.atomicBatch([
      { sql: 'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)', args: [objectId, ownerId, input.sizeBytes, mimeType, contentUrl, nowIso] },
      { sql: "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'none', 'active', ?, ?)", args: [cardId, ownerId, objectId, name, rarity, value, nowIso, nowIso] },
      { sql: 'INSERT INTO CardOwnership (card_id, owner_id, acquired_at) VALUES (?, ?, ?)', args: [cardId, ownerId, nowIso] },
      { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta, created_at) VALUES (?, ?, 'created', NULL, ?, ?, ?)", args: [historyId, cardId, ownerId, JSON.stringify({ source: input.source, mediaObjectId: objectId }), nowIso] },
    ])

    return (await this.getCard(cardId, ownerId))!
  }

  // Create a card from a media object the creator owns. The creator becomes the
  // first owner. The card insert is conditional on the media still being owned
  // by the creator within the same transaction (no TOCTOU).
  async createCard(input: {
    creatorId: string
    mediaObjectId: string
    name?: string | null
    tags?: string[]
    description?: string | null
    frame?: string
    accentColor?: string
    rarity?: CardRarity
  }): Promise<CardRecord> {
    const creatorId = requireId(input.creatorId, 'creatorId')
    const mediaObjectId = requireId(input.mediaObjectId, 'mediaObjectId')
    const name = input.name ? requireString(input.name, 'name', { max: 80 }) : null
    const rawTags = Array.isArray(input.tags) ? input.tags : []
    const tags = [...new Set(rawTags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
    if (tags.some((tag) => tag.length > 24)) throw badRequest('tags must be 24 characters or fewer')
    const description = input.description ? requireString(input.description, 'description', { max: 240 }) : null
    const frame = ['chrome', 'holo', 'carbon', 'neon'].includes(input.frame || '') ? input.frame! : 'chrome'
    const accentColor = /^#[0-9a-f]{6}$/i.test(input.accentColor || '') ? input.accentColor! : '#9FE3FF'
    const requestedRarity = input.rarity
    if (requestedRarity && !(RARITIES as readonly string[]).includes(requestedRarity)) {
      throw badRequest('rarity must be one of: ' + RARITIES.join(', '))
    }

    const media = await this.db
      .prepare('SELECT id, owner_id, is_public, is_story, is_chat, gacha_downloads_count FROM Objects WHERE id = ?')
      .bind(mediaObjectId)
      .first<{ id: string; owner_id: string; is_public?: number; is_story?: number; is_chat?: number; gacha_downloads_count?: number | null }>()
    if (!media) throw notFound('media object not found')
    if (media.owner_id !== creatorId) throw forbidden('you do not own this media')
    if (media.is_public === 1 || media.is_story === 1 || media.is_chat === 1) throw badRequest('cannot create a card from a post, story, or chat attachment')

    // Seed the canonical card's valuation from the media object's existing
    // reputation score and like count so card info shows the live g$ value
    // instead of a fresh 0 (mirrors backfillFromObjects).
    const score = Math.max(0, Number(media.gacha_downloads_count ?? 0))
    const likeCount = (await this.db
      .prepare("SELECT COUNT(*) AS c FROM Likes WHERE object_id = ? AND decision = 'like'")
      .bind(mediaObjectId)
      .first<{ c: number }>())?.c ?? 0
    const rarity = requestedRarity ?? computeCardRarity(score).rarity

    // Idempotent creation: a media object maps to at most one canonical card.
    // Re-uploading the same media (or re-submitting the create intent) returns
    // the existing card and refreshes its name when the creator re-names it,
    // instead of minting a duplicate canonical card.
    const existing = await this.db
      .prepare('SELECT id, name FROM Cards WHERE media_object_id = ?')
      .bind(mediaObjectId)
      .first<{ id: string; name: string | null }>()
    if (existing) {
      if (name && name !== existing.name) {
        await this.db
          .prepare('UPDATE Cards SET name = ?, updated_at = ? WHERE id = ?')
          .bind(name, new Date().toISOString(), existing.id)
          .run()
      }
      return (await this.getCard(existing.id, creatorId))!
    }

    const cardId = crypto.randomUUID()
    const historyId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    const res = await this.db.atomicBatch([
      {
        sql: "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, tags, description, frame, accent_color, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'none', 'active', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM Objects WHERE id = ? AND owner_id = ?) AND NOT EXISTS (SELECT 1 FROM Cards WHERE media_object_id = ?)",
        args: [cardId, creatorId, mediaObjectId, name, rarity, score, likeCount, JSON.stringify(tags), description, frame, accentColor, nowIso, nowIso, mediaObjectId, creatorId, mediaObjectId],
      },
      { sql: 'INSERT INTO CardOwnership (card_id, owner_id, acquired_at) SELECT ?, ?, ? WHERE changes() = 1', args: [cardId, creatorId, nowIso] },
      { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta, created_at) SELECT ?, ?, 'created', NULL, ?, ?, ? WHERE changes() = 1", args: [historyId, cardId, creatorId, JSON.stringify({ mediaObjectId }), nowIso] },
    ])

    if (res[0].rowsAffected === 0) {
      // Either the media changed ownership or a concurrent create won — return
      // the existing card for this media (idempotent) or surface the conflict.
      const winner = await this.db
        .prepare('SELECT id FROM Cards WHERE media_object_id = ?')
        .bind(mediaObjectId)
        .first<{ id: string }>()
      if (winner) {
        if (name) {
          await this.db
            .prepare('UPDATE Cards SET name = ?, updated_at = ? WHERE id = ?')
            .bind(name, new Date().toISOString(), winner.id)
            .run()
        }
        return (await this.getCard(winner.id, creatorId))!
      }
      throw conflict('media ownership changed')
    }

    return (await this.getCard(cardId, creatorId))!
  }

  // Returns a card with its current owner. Non-active cards are only visible to
  // their owner or creator; omitting callerId treats the caller as public and
  // still hides non-active cards.
  async getCard(cardId: string, callerId?: string): Promise<CardRecord | null> {
    requireId(cardId, 'cardId')
    const row = await this.db
      .prepare('SELECT c.*, o.content_url, o.mime_type, o.caption FROM Cards c LEFT JOIN Objects o ON o.id = c.media_object_id WHERE c.id = ?')
      .bind(cardId)
      .first<CardRow>()
    if (!row) return null
    const owner = await this.db
      .prepare('SELECT owner_id FROM CardOwnership WHERE card_id = ?')
      .bind(cardId)
      .first<{ owner_id: string }>()
    const ownerId = owner?.owner_id ?? row.creator_id
    if (row.moderation_state !== 'active' && callerId !== ownerId && callerId !== row.creator_id) {
      return null
    }
    return mapCard(row, ownerId)
  }

  async getCollection(userId: string): Promise<CardRecord[]> {
    requireId(userId, 'userId')
    const rows = await this.db
      .prepare(
        `SELECT c.*, o.content_url, o.mime_type, o.caption, co.owner_id FROM Cards c
         JOIN CardOwnership co ON co.card_id = c.id
         LEFT JOIN Objects o ON o.id = c.media_object_id
         WHERE co.owner_id = ?
         ORDER BY c.value DESC, c.created_at ASC`,
      )
      .bind(userId)
      .all<CardRow & { owner_id: string }>()
    return rows.results.map((r) => mapCard(r, r.owner_id))
  }

  // Append-only audit trail for a card, newest first. Only the current owner or
  // the original creator may read a card's history (mirrors the getCard
  // visibility rule).
  async getHistory(cardId: string, callerId?: string): Promise<CardHistoryRecord[]> {
    requireId(cardId, 'cardId')
    const card = await this.db
      .prepare('SELECT creator_id FROM Cards WHERE id = ?')
      .bind(cardId)
      .first<{ creator_id: string }>()
    if (!card) throw notFound('card not found')

    const owner = await this.db
      .prepare('SELECT owner_id FROM CardOwnership WHERE card_id = ?')
      .bind(cardId)
      .first<{ owner_id: string }>()
    const ownerId = owner?.owner_id ?? card.creator_id

    if (callerId && callerId !== ownerId && callerId !== card.creator_id) {
      throw forbidden('you do not have access to this card history')
    }

    const rows = await this.db
      .prepare(
        'SELECT id, card_id, event, from_user, to_user, meta, created_at FROM CardHistory WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 200',
      )
      .bind(cardId)
      .all<{ id: string; card_id: string; event: string; from_user: string | null; to_user: string | null; meta: string | null; created_at: string }>()

    return rows.results.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      event: r.event,
      fromUser: r.from_user,
      toUser: r.to_user,
      meta: parseStored(r.meta),
      createdAt: r.created_at,
    }))
  }

  // Browse open marketplace listings (active cards only), newest first. Each
  // entry carries the full card projection so buyers can render without extra
  // lookups. Paginated to keep the response bounded.
  async listMarket(input: { limit?: number; offset?: number } = {}): Promise<MarketListingRecord[]> {
    const safeLimit = Math.min(Math.max(1, Math.floor(input.limit ?? 50) || 50), 100)
    const safeOffset = Math.max(0, Math.floor(input.offset ?? 0) || 0)

    const rows = await this.db
      .prepare(
        `SELECT ml.id AS listing_id, ml.card_id, ml.price, ml.seller_id, ml.created_at AS listed_at,
                c.*, o.content_url, o.mime_type, o.caption, co.owner_id
         FROM MarketListings ml
         JOIN Cards c ON c.id = ml.card_id
         JOIN CardOwnership co ON co.card_id = c.id
         LEFT JOIN Objects o ON o.id = c.media_object_id
         WHERE ml.status = 'open' AND c.moderation_state = 'active'
         ORDER BY ml.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(safeLimit, safeOffset)
      .all<CardRow & { listing_id: string; card_id: string; price: number; seller_id: string; listed_at: string; owner_id: string }>()

    return rows.results.map((r) => ({
      listingId: r.listing_id,
      cardId: r.card_id,
      price: Number(r.price),
      sellerId: r.seller_id,
      listedAt: r.listed_at,
      card: mapCard(r, r.owner_id),
    }))
  }

  // Non-canonical -> canonical migration: mint canonical Cards for a user's own
  // shared media objects (non-story, self-uploaded, not already carded). Each
  // mint re-verifies "not already carded" inside its own write transaction, so
  // concurrent/rerepeated runs never double-mint. Returns mint/skip counts.
  async backfillFromObjects(): Promise<BackfillResult> {
    const rows = await this.db
      .prepare(
        `SELECT o.id, o.owner_id, o.caption, o.gacha_downloads_count, o.mime_type
         FROM Objects o
         WHERE o.is_story = 0
           AND o.is_public = 0
           AND o.id NOT LIKE 'p2p-obj-%'
           AND o.sender_id IS NULL
           AND o.owner_id IS NOT NULL
           AND (o.content_url IS NOT NULL OR o.mime_type IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM Cards c WHERE c.media_object_id = o.id)`,
      )
      .bind()
      .all<{ id: string; owner_id: string; caption: string | null; gacha_downloads_count: number | null; mime_type: string }>()

    let created = 0
    let skipped = 0

    for (const o of rows.results) {
      const cardId = crypto.randomUUID()
      const historyId = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const value = Math.max(0, Number(o.gacha_downloads_count ?? 0))
      const name = o.caption ? o.caption.slice(0, 80) : null

      const res = await this.db.atomicBatch([
        {
          sql: "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, created_at, updated_at) SELECT ?, ?, ?, ?, 'common', ?, 0, 'none', 'active', ?, ? WHERE NOT EXISTS (SELECT 1 FROM Cards WHERE media_object_id = ?)",
          args: [cardId, o.owner_id, o.id, name, value, nowIso, nowIso, o.id],
        },
        { sql: 'INSERT INTO CardOwnership (card_id, owner_id, acquired_at) SELECT ?, ?, ? WHERE changes() = 1', args: [cardId, o.owner_id, nowIso] },
        { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta, created_at) SELECT ?, ?, 'backfilled', NULL, ?, ?, ? WHERE changes() = 1", args: [historyId, cardId, o.owner_id, JSON.stringify({ source: 'backfill_v1', mediaObjectId: o.id }), nowIso] },
      ])

      if (res[0].rowsAffected > 0) created++
      else skipped++
    }

    return { created, skipped }
  }

  // List a card for sale. Only the current owner may list, and only if the card
  // is not already listed. The listing insert re-verifies ownership atomically.
  async listForSale(sellerId: string, cardId: string, price: number): Promise<CardRecord> {
    requireId(sellerId, 'sellerId')
    requireId(cardId, 'cardId')
    const priceValue = requireNonNegativeInt(price, 'price', { max: 10_000_000 })
    if (priceValue === 0) throw badRequest('price must be greater than 0')

    const owner = await this.db
      .prepare('SELECT owner_id FROM CardOwnership WHERE card_id = ?')
      .bind(cardId)
      .first<{ owner_id: string }>()
    if (!owner) throw notFound('card not found')
    if (owner.owner_id !== sellerId) throw forbidden('you do not own this card')

    const open = await this.db
      .prepare("SELECT 1 FROM MarketListings WHERE card_id = ? AND status = 'open'")
      .bind(cardId)
      .first()
    if (open) throw conflict('card is already listed')

    const listingId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    const res = await this.db.atomicBatch([
      {
        sql: "INSERT INTO MarketListings (id, card_id, seller_id, price, status, created_at, updated_at) SELECT ?, ?, ?, ?, 'open', ?, ? WHERE EXISTS (SELECT 1 FROM CardOwnership WHERE card_id = ? AND owner_id = ?)",
        args: [listingId, cardId, sellerId, priceValue, nowIso, nowIso, cardId, sellerId],
      },
      { sql: "UPDATE Cards SET market_status = 'listed', updated_at = ? WHERE id = ? AND changes() = 1", args: [nowIso, cardId] },
      { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta) SELECT ?, ?, 'listed', ?, NULL, ? WHERE changes() = 1", args: [crypto.randomUUID(), cardId, sellerId, JSON.stringify({ price: priceValue })] },
    ])

    if (res[0].rowsAffected === 0) throw conflict('card ownership changed')

    return (await this.getCard(cardId, sellerId))!
  }

  // Cancel a listing. Only the seller may cancel while it is still open. The
  // dependent updates are gated on the listing update succeeding so a concurrent
  // sale cannot be marked unlisted.
  async cancelListing(sellerId: string, cardId: string): Promise<void> {
    requireId(sellerId, 'sellerId')
    requireId(cardId, 'cardId')

    const listing = await this.db
      .prepare("SELECT id, seller_id, status FROM MarketListings WHERE card_id = ? AND status = 'open'")
      .bind(cardId)
      .first<{ id: string; seller_id: string; status: string }>()
    if (!listing) throw notFound('no open listing found')
    if (listing.seller_id !== sellerId) throw forbidden('only the seller can cancel this listing')

    const nowIso = new Date().toISOString()
    const res = await this.db.atomicBatch([
      { sql: "UPDATE MarketListings SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open' AND seller_id = ? RETURNING id", args: [nowIso, listing.id, sellerId] },
      { sql: "UPDATE Cards SET market_status = 'none', updated_at = ? WHERE id = ? AND changes() = 1", args: [nowIso, cardId] },
      { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user) SELECT ?, ?, 'delisted', ?, NULL WHERE changes() = 1", args: [crypto.randomUUID(), cardId, sellerId] },
    ])

    if ((res[0].rows?.length ?? 0) === 0) throw conflict('listing is no longer open')
  }

  // Buy a listed card. Atomically debits the buyer, credits the seller, moves
  // ownership, and closes the listing. The debit is gated on the card still
  // being listed and owned by the seller, so a concurrent change rolls the whole
  // purchase back (no partial purchase, no double-spend).
  async buyCard(buyerId: string, cardId: string, idempotencyKey: string): Promise<PurchaseResult> {
    requireId(buyerId, 'buyerId')
    requireId(cardId, 'cardId')
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw badRequest('idempotencyKey must be 8-128 characters')
    }

    // Idempotent replay: bind the key to the buyer and card before reading the
    // (now 'sold') listing, and never return another buyer's purchase.
    const existing = await this.db
      .prepare('SELECT user_id, fingerprint, result FROM EconomicOperations WHERE idempotency_key = ?')
      .bind(idempotencyKey)
      .first<{ user_id: string; fingerprint: string | null; result: string | null }>()
    if (existing) {
      const stored = existing.result ? (JSON.parse(existing.result) as PurchaseResult) : null
      if (existing.user_id !== buyerId) throw idempotencyConflict()
      if (stored && stored.cardId !== cardId) throw idempotencyConflict()
      if (stored) return { ...stored, replayed: true }
    }

    const listing = await this.db
      .prepare("SELECT seller_id, price FROM MarketListings WHERE card_id = ? AND status = 'open'")
      .bind(cardId)
      .first<{ seller_id: string; price: number }>()
    if (!listing) throw notFound('card is not listed for sale')
    if (listing.seller_id === buyerId) throw forbidden('you cannot buy your own card')

    const card = await this.db.prepare('SELECT id, moderation_state, value FROM Cards WHERE id = ?').bind(cardId).first<{ id: string; moderation_state: string; value: number }>()
    if (!card) throw notFound('card not found')
    if (card.moderation_state !== 'active') throw forbidden('this card is not available')

    const sellerId = listing.seller_id
    const price = listing.price
    const operationId = crypto.randomUUID()
    const debitLedgerId = crypto.randomUUID()
    const creditLedgerId = crypto.randomUUID()
    const historyId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const fingerprint = `purchase|${buyerId}|${cardId}|${sellerId}|${price}`

    const result: PurchaseResult = {
      operationId,
      fromUserId: buyerId,
      toUserId: sellerId,
      amount: price,
      fromBalance: 0,
      toBalance: 0,
      cardId,
      sellerId,
      buyerId,
    }

    const { statements, debitIndex, creditIndex } = buildTransferStatements({
      fromUserId: buyerId,
      toUserId: sellerId,
      amount: price,
      reference: cardId,
      operationId,
      debitLedgerId,
      creditLedgerId,
      idempotencyKey,
      fingerprint,
      payload: { cardId, sellerId, price },
      result,
      nowIso,
      debitGate: {
        clause: "AND EXISTS (SELECT 1 FROM CardOwnership co JOIN MarketListings ml ON ml.card_id = co.card_id WHERE co.card_id = ? AND co.owner_id = ? AND ml.status = 'open' AND ml.seller_id = ?)",
        args: [cardId, sellerId, sellerId],
      },
      extra: [
        {
          sql: 'UPDATE CardOwnership SET owner_id = ?, acquired_at = ? WHERE card_id = ? AND owner_id = ? AND changes() = 1 RETURNING owner_id',
          args: [buyerId, nowIso, cardId, sellerId],
        },
        { sql: "UPDATE MarketListings SET status = 'sold', updated_at = ? WHERE card_id = ? AND status = 'open' AND changes() = 1", args: [nowIso, cardId] },
        { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta) SELECT ?, ?, 'purchased', ?, ?, ? WHERE changes() = 1", args: [historyId, cardId, sellerId, buyerId, JSON.stringify({ price })] },
        { sql: "UPDATE Cards SET market_status = 'none', value = ?, rarity = ?, updated_at = ? WHERE id = ? AND changes() = 1", args: [card.value + price, computeCardRarity(card.value + price).rarity, nowIso, cardId] },
      ],
    })

    const ownershipIndex = statements.length - 4 // first extra statement

    let res
    try {
      res = await this.db.atomicBatch(statements)
    } catch (err) {
      if (isConstraintError(err)) {
        const recorded = await this.db
          .prepare('SELECT user_id, result FROM EconomicOperations WHERE idempotency_key = ?')
          .bind(idempotencyKey)
          .first<{ user_id: string; result: string | null }>()
        if (recorded?.result) {
          const stored = JSON.parse(recorded.result) as PurchaseResult
          if (recorded.user_id !== buyerId || stored.cardId !== cardId) throw idempotencyConflict()
          return { ...stored, replayed: true }
        }
      }
      throw err
    }

    if ((res[debitIndex].rows?.length ?? 0) === 0) {
      // Debit skipped: either insufficient funds or the card is no longer listed
      // and owned by the seller. Distinguish for a useful error.
      const stillOpen = await this.db
        .prepare("SELECT 1 FROM MarketListings WHERE card_id = ? AND status = 'open' AND seller_id = ?")
        .bind(cardId, sellerId)
        .first()
      throw stillOpen ? insufficientFunds() : conflict('card is no longer available')
    }
    if ((res[ownershipIndex].rows?.length ?? 0) === 0) {
      throw conflict('card is no longer available')
    }

    result.fromBalance = (res[debitIndex].rows[0]?.balance as number) ?? 0
    result.toBalance = (res[creditIndex].rows[0]?.balance as number) ?? 0
    return result
  }

  // Direct ownership transfer (no currency). Only the current owner may transfer
  // an active card. Used by trading flows that handle consideration separately.
  async transferOwnership(fromUserId: string, toUserId: string, cardId: string): Promise<CardRecord> {
    requireId(fromUserId, 'fromUserId')
    requireId(toUserId, 'toUserId')
    requireId(cardId, 'cardId')
    if (fromUserId === toUserId) throw badRequest('cannot transfer to yourself')

    const owner = await this.db
      .prepare('SELECT owner_id FROM CardOwnership WHERE card_id = ?')
      .bind(cardId)
      .first<{ owner_id: string }>()
    if (!owner) throw notFound('card not found')
    if (owner.owner_id !== fromUserId) throw forbidden('you do not own this card')

    const card = await this.db.prepare('SELECT moderation_state FROM Cards WHERE id = ?').bind(cardId).first<{ moderation_state: string }>()
    if (!card || card.moderation_state !== 'active') throw forbidden('this card is not transferable')

    const nowIso = new Date().toISOString()
    const historyId = crypto.randomUUID()
    const res = await this.db.atomicBatch([
      { sql: 'UPDATE CardOwnership SET owner_id = ?, acquired_at = ? WHERE card_id = ? AND owner_id = ? RETURNING owner_id', args: [toUserId, nowIso, cardId, fromUserId] },
      { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user) SELECT ?, ?, 'transferred', ?, ? WHERE changes() = 1", args: [historyId, cardId, fromUserId, toUserId] },
    ])

    if ((res[0].rows?.length ?? 0) === 0) throw conflict('card ownership changed concurrently')

    return (await this.getCard(cardId, toUserId))!
  }

  // Cash out a card for g$ at the admin-controlled inflation rate. The card is
  // burned from the caller's collection (ownership removed) but its row and
  // history are preserved for audit. The wallet credit, ledger row, ownership
  // removal, state transition, and idempotency record run in one atomic batch.
  async cashOutCard(ownerId: string, cardId: string, idempotencyKey: string): Promise<CashOutResult> {
    requireId(ownerId, 'ownerId')
    requireId(cardId, 'cardId')
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw badRequest('idempotencyKey must be 8-128 characters')
    }

    const rateBps = await getCashoutRateBps(this.db)

    // Idempotent replay: bind the key to the owner and card, never return
    // another user's cashout, and refuse keys reused with a different card.
    const existing = await this.db
      .prepare('SELECT user_id, fingerprint, result FROM EconomicOperations WHERE idempotency_key = ?')
      .bind(idempotencyKey)
      .first<{ user_id: string; fingerprint: string | null; result: string | null }>()
    if (existing) {
      const stored = existing.result ? (JSON.parse(existing.result) as CashOutResult) : null
      if (existing.user_id !== ownerId) throw idempotencyConflict()
      if (stored && stored.cardId !== cardId) throw idempotencyConflict()
      if (stored) return { ...stored, replayed: true }
    }

    const card = await this.db
      .prepare('SELECT id, media_object_id, value, moderation_state, market_status FROM Cards WHERE id = ?')
      .bind(cardId)
      .first<{ id: string; media_object_id: string; value: number; moderation_state: string; market_status: string }>()
    if (!card) throw notFound('card not found')
    if (card.moderation_state !== 'active') throw forbidden('this card is not available')
    if (card.market_status === 'listed') throw conflict('unlist the card before cashing out')
    if (card.market_status === 'cashed_out') throw conflict('card already cashed out')

    const payout = computeCashoutPayout(card.value, rateBps)

    const operationId = crypto.randomUUID()
    const ledgerId = crypto.randomUUID()
    const historyId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const fingerprint = `cashout|${ownerId}|${cardId}|${card.value}|${rateBps}`

    const result: CashOutResult = {
      operationId,
      cardId,
      userId: ownerId,
      value: card.value,
      rateBps,
      payout,
      balance: 0,
    }

    let res
    try {
      res = await this.db.atomicBatch([
        { sql: 'INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)', args: [ownerId] },
        {
          // Credit is gated on the caller still owning an active, unlisted card.
          sql: `UPDATE Wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?
                 AND EXISTS (
                   SELECT 1 FROM Cards c JOIN CardOwnership co ON co.card_id = c.id
                   WHERE c.id = ? AND co.owner_id = ? AND c.market_status = 'none' AND c.moderation_state = 'active'
                 ) RETURNING balance`,
          args: [payout, nowIso, ownerId, cardId, ownerId],
        },
        { sql: "UPDATE Cards SET market_status = 'cashed_out', updated_at = ? WHERE id = ? AND changes() = 1", args: [nowIso, cardId] },
        { sql: 'DELETE FROM CardOwnership WHERE card_id = ? AND changes() = 1', args: [cardId] },
        { sql: "INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta) SELECT ?, ?, 'cashed_out', ?, NULL, ? WHERE changes() = 1", args: [historyId, cardId, ownerId, JSON.stringify({ value: card.value, rateBps, payout })] },
        {
          sql: 'INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after, reference, operation_id) SELECT ?, ?, ?, ?, balance, ?, ? FROM Wallets WHERE user_id = ? AND changes() = 1',
          args: [ledgerId, ownerId, 'grant', payout, cardId, operationId, ownerId],
        },
        {
          sql: 'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, payload, result) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
          args: [operationId, idempotencyKey, ownerId, 'cashout', fingerprint, JSON.stringify({ cardId, value: card.value, rateBps, payout }), JSON.stringify(result)],
        },
        // A burned card's media must not remain in the owner's inbox and be
        // re-discovered by the legacy gallery after CardOwnership is removed.
        { sql: 'DELETE FROM Recipients WHERE object_id = ?', args: [card.media_object_id] },
        { sql: 'DELETE FROM Favorites WHERE object_id = ?', args: [card.media_object_id] },
        { sql: 'DELETE FROM Likes WHERE object_id = ?', args: [card.media_object_id] },
        { sql: 'DELETE FROM Objects WHERE id = ?', args: [card.media_object_id] },
        // A burned card must not linger in any deck either; drop its deck
        // references so decks never hold dangling card entries after cash-out.
        { sql: 'DELETE FROM DeckCards WHERE card_id = ?', args: [cardId] },
      ])
    } catch (err) {
      if (isConstraintError(err)) {
        const recorded = await this.db
          .prepare('SELECT user_id, result FROM EconomicOperations WHERE idempotency_key = ?')
          .bind(idempotencyKey)
          .first<{ user_id: string; result: string | null }>()
        if (recorded?.result) {
          const stored = JSON.parse(recorded.result) as CashOutResult
          if (recorded.user_id !== ownerId || stored.cardId !== cardId) throw idempotencyConflict()
          return { ...stored, replayed: true }
        }
      }
      throw err
    }

    const creditIndex = 1
    if ((res[creditIndex].rows?.length ?? 0) === 0) {
      // Credit skipped: the card is no longer owned/active/unlisted.
      throw conflict('card is no longer available to cash out')
    }

    result.balance = (res[creditIndex].rows[0]?.balance as number) ?? 0
    return result
  }
}
