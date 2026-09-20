import { createClient } from '@libsql/client'
import { D1Turso } from './db'
import { LocalBlobStore } from './blob'
import { migrate } from './migrate'
import { generateIdentity, signMessage } from '@orbit/crypto'

// Set test encryption key so crypto module works without zero-key fallback
if (!process.env.STORAGE_ENCRYPTION_KEY) {
  process.env.STORAGE_ENCRYPTION_KEY = 'a'.repeat(64) // 32-byte test key
}

export interface TestIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPrivHex: string
  encryptionPubHex: string
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function createTestIdentity(): TestIdentity {
  return generateIdentity() as TestIdentity
}

export function signRequestHeaders(
  identity: TestIdentity,
  method: string,
  url: string,
  body?: string,
  timestamp?: string
): Record<string, string> {
  const ts = timestamp || Date.now().toString()
  const payload = `${method.toUpperCase()}|${url}|${ts}|${body || ''}`
  const messageBytes = new TextEncoder().encode(payload)
  const signatureBytes = signMessage(messageBytes, identity.privateKeyHex)
  const signatureHex = toHex(signatureBytes)

  return {
    'X-Orbit-Id': identity.orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-Signature': signatureHex,
    'X-Orbit-PubKey': identity.publicKeyHex,
  }
}

export async function createMockEnv() {
  const client = createClient({ url: ':memory:' })
  const db = new D1Turso(client)

  // Schema is applied by the shared migration runner (apps/api/schema.sql),
  // the single source of truth — no hand-copied DDL here.
  await migrate(client)

  const randomSuffix = Math.random().toString(36).slice(2, 10)
  const blob = new LocalBlobStore(`./test-blobs-${randomSuffix}`)

  return { DB: db, BUCKET: blob, _client: client }
}

/** Seed an owned, queue-valid deck (size cards, all active) for a user id.
 * Direct-service seeding — mirrors decks.test.ts, no HTTP round-trips. */
export async function seedActiveDeck(env: { DB: D1Turso }, ownerId: string, size = 5): Promise<string> {
  const { DeckService } = await import('./decks')
  const { CardService } = await import('./cards')
  const decks = new DeckService(env.DB)
  const cards = new CardService(env.DB)
  const deck = await decks.createDeck(ownerId, `Queue Deck ${Math.random().toString(36).slice(2, 8)}`)
  for (let i = 0; i < size; i++) {
    const mid = `media-sd-${deck.id.slice(0, 8)}-${i}`
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
      .bind(mid, ownerId, 1000, 'image/jpeg').run()
    const card = await cards.createCard({ creatorId: ownerId, mediaObjectId: mid, name: 'Seed Card ' + i })
    await decks.addCard(ownerId, deck.id, card.id)
  }
  return deck.id
}
