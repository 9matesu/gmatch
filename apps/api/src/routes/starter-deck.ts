import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { adminAuth } from '../middleware/admin'
import type { D1Turso, AtomicStatement } from '../db'
import { getBotConfig, buildApiRequestUrl, extractImageUrlsFromJson } from '../bot-image-api'
import { mintCardStatements } from '../cards'
import crypto from 'crypto'

type Bindings = {
  DB: D1Turso
}

export const starterDeck = new Hono<{ Bindings: Bindings; Variables: { orbitId: string; publicKeyHex: string } }>()

/** Fetch 5 unique starter cards from configured provider & tags */
export async function generateStarterCards(
  db: D1Turso,
  count = 5
): Promise<Array<{ url: string; caption: string; tags: string[] }>> {
  const metaRows = await db
    .prepare("SELECT key, value FROM SystemMeta WHERE key IN ('starter_cards_provider', 'starter_cards_tags')")
    .bind()
    .all<{ key: string; value: string }>()

  const map = new Map<string, string>()
  for (const r of metaRows.results || []) {
    map.set(r.key, r.value)
  }

  const configuredProvId = map.get('starter_cards_provider') || 'prov_rule34'
  const configuredTagsRaw = map.get('starter_cards_tags') || 'highres, 1girl, solo, aesthetic'
  const tags = configuredTagsRaw.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean)

  const botConfig = await getBotConfig(db)
  const provider = botConfig.providers.find((p) => p.id === configuredProvId)

  if (!provider) {
    // No provider configured - return resilient fallback starter set
    const fallbacks = [
      { url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800', caption: 'Cyber Vanguard #1', tags: ['cyberpunk', 'holo'] },
      { url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800', caption: 'Astral Valkyrie #2', tags: ['anime', 'valkyrie'] },
      { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800', caption: 'Iridescent Pulse #3', tags: ['rare', 'shiny'] },
      { url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800', caption: 'Neon Sovereign #4', tags: ['neon', 'legendary'] },
      { url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800', caption: 'Chrono Mirage #5', tags: ['synthwave', 'epic'] },
    ]
    return fallbacks.slice(0, count)
  }

  try {
    const { url, headers } = buildApiRequestUrl(provider, tags, provider.apiKey, Math.max(15, count * 3), provider.userId)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = await res.json()
      const extracted = extractImageUrlsFromJson(data)
      if (extracted.length > 0) {
        // Deduplicate URLs and take requested count
        const uniqueMap = new Map<string, { url: string; caption: string; tags: string[] }>()
        for (const item of extracted) {
          if (!uniqueMap.has(item.url)) {
            uniqueMap.set(item.url, {
              url: item.url,
              caption: item.caption || `Starter Holo Card #${uniqueMap.size + 1}`,
              tags: item.tags || tags,
            })
          }
          if (uniqueMap.size >= count) break
        }
        if (uniqueMap.size >= count) {
          return Array.from(uniqueMap.values())
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch booru starter cards:', err)
  }

  // Resilient fallback starter set
  const fallbacks = [
    { url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800', caption: 'Cyber Vanguard #1', tags: ['cyberpunk', 'holo'] },
    { url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800', caption: 'Astral Valkyrie #2', tags: ['anime', 'valkyrie'] },
    { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800', caption: 'Iridescent Pulse #3', tags: ['rare', 'shiny'] },
    { url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800', caption: 'Neon Sovereign #4', tags: ['neon', 'legendary'] },
    { url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800', caption: 'Chrono Mirage #5', tags: ['synthwave', 'epic'] },
  ]
  return fallbacks.slice(0, count)
}

// User Endpoint: Initialize 5 starter cards for newcomers
starterDeck.post('/init', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const db = c.env.DB

  try {
    const cards = await generateStarterCards(db, 5)
    const nowIso = new Date().toISOString()

    // Idempotent + concurrency-safe init gate. If the marker already exists the
    // INSERT OR IGNORE affects 0 rows, changes() stays 0, and no card mints.
    const initKey = `starter_deck_init_v1_${orbitId}`
    const statements: AtomicStatement[] = [
      { sql: 'INSERT OR IGNORE INTO SystemMeta (key, value) VALUES (?, ?)', args: [initKey, '1'] },
    ]

    const minted: Array<{ id: string; name: string; content_url: string }> = []
    for (const card of cards) {
      const cardId = crypto.randomUUID()
      const objectId = crypto.randomUUID()
      statements.push(...mintCardStatements({
        ownerId: orbitId,
        cardId,
        objectId,
        spec: { name: card.caption, rarity: 'common', contentUrl: card.url, mimeType: 'image/jpeg', sizeBytes: 1024 },
        historyId: crypto.randomUUID(),
        nowIso,
        source: 'starter-deck',
      }))
      minted.push({ id: cardId, name: card.caption, content_url: card.url })
    }

    const res = await db.atomicBatch(statements)

    if (res[0].rowsAffected === 0) {
      const existing = await db
        .prepare('SELECT c.id, c.name, o.content_url FROM Cards c JOIN CardOwnership co ON co.card_id = c.id JOIN Objects o ON o.id = c.media_object_id WHERE co.owner_id = ? ORDER BY c.created_at ASC')
        .bind(orbitId)
        .all<{ id: string; name: string | null; content_url: string | null }>()
      return c.json({ success: true, message: 'User already has starter cards', cards: existing.results, replayed: true })
    }

    return c.json({ success: true, cards_created: minted.length, cards: minted })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to initialize starter deck' }, 500)
  }
})

// Admin Endpoints
starterDeck.get('/settings', orbitAuth, adminAuth, async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM SystemMeta WHERE key IN ('starter_cards_provider', 'starter_cards_tags')").bind().all<{ key: string; value: string }>()
  const map = new Map<string, string>()
  for (const r of rows.results || []) {
    map.set(r.key, r.value)
  }
  return c.json({
    provider_id: map.get('starter_cards_provider') || 'prov_rule34',
    tags: map.get('starter_cards_tags') || 'highres, 1girl, solo, aesthetic',
  })
})

starterDeck.put('/settings', orbitAuth, adminAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const providerId = body?.provider_id || 'prov_rule34'
  const tags = body?.tags || 'highres, 1girl, solo, aesthetic'

  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('starter_cards_provider', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(providerId).run()
  await c.env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('starter_cards_tags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(tags).run()

  return c.json({ success: true, provider_id: providerId, tags })
})

starterDeck.post('/test', orbitAuth, async (c) => {
  const cards = await generateStarterCards(c.env.DB, 5)
  return c.json({ success: true, count: cards.length, cards })
})
