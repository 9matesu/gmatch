import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { getSlideshowImagesByTags } from '../bot-image-api'
import { normalizeTagShape } from '@orbit/shared'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const slideshows = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

slideshows.use('*', orbitAuth)

const SOURCES = ['cards', 'posts', 'both', 'api'] as const
type Source = (typeof SOURCES)[number]

const MAX_ITEMS = 200
const MAX_TITLE = 120
const MIN_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 60000

interface SlideshowRow {
  id: string
  owner_id: string
  title: string | null
  source: Source
  tags: string | null
  interval_ms: number
  created_at: string
  updated_at: string
}

interface ResolvedItem {
  object_id: string | null
  url: string | null
  caption: string | null
  mime_type: string | null
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((t) => String(t)).filter(Boolean)
  } catch { }
  return []
}

function serializeSlideshow(row: SlideshowRow, itemCount: number) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    tags: parseTags(row.tags),
    interval_ms: row.interval_ms,
    item_count: itemCount,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Resolve the playable items for a slideshow. For cards/posts/both this joins
 * the referenced Objects and drops anything the caller can no longer access or
 * that was deleted. For 'api' it fetches a fresh batch from the configured
 * providers using the stored tags. */
async function resolveItems(db: D1Turso, orbitId: string, row: SlideshowRow): Promise<ResolvedItem[]> {
  if (row.source === 'api') {
    const tags = parseTags(row.tags)
    const images = await getSlideshowImagesByTags(db, tags, 20)
    return images.map((i) => ({ object_id: null, url: i.url, caption: i.caption || null, mime_type: null }))
  }

  const items = await db
    .prepare('SELECT id, object_id, caption, mime_type FROM SlideshowItems WHERE slideshow_id = ? ORDER BY position ASC')
    .bind(row.id)
    .all<{ id: string; object_id: string | null; caption: string | null; mime_type: string | null }>()

  const out: ResolvedItem[] = []
  for (const item of items.results || []) {
    if (!item.object_id) continue
    const obj = await db
      .prepare(`
        SELECT o.id, o.content_url, o.mime_type, COALESCE(o.post_caption, o.caption) as caption
        FROM Objects o
        LEFT JOIN Recipients r ON o.id = r.object_id AND r.recipient_id = ?
        WHERE o.id = ? AND o.hidden_at IS NULL
          AND (o.owner_id = ? OR o.is_public = 1 OR r.recipient_id IS NOT NULL)
      `)
      .bind(orbitId, item.object_id, orbitId)
      .first<{ id: string; content_url: string | null; mime_type: string; caption: string | null }>()
    if (!obj) continue
    out.push({
      object_id: obj.id,
      url: obj.content_url || null,
      caption: item.caption || obj.caption || null,
      mime_type: item.mime_type || obj.mime_type || 'image/jpeg',
    })
  }
  return out
}

slideshows.get('/', async (c) => {
  const orbitId = c.get('orbitId')
  const rows = await c.env.DB
    .prepare('SELECT * FROM Slideshows WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(orbitId)
    .all<SlideshowRow>()

  const counts = await c.env.DB
    .prepare(`
      SELECT slideshow_id, COUNT(*) as n FROM SlideshowItems
      WHERE slideshow_id IN (SELECT id FROM Slideshows WHERE owner_id = ?)
      GROUP BY slideshow_id
    `)
    .bind(orbitId)
    .all<{ slideshow_id: string; n: number }>()
  const countMap = new Map<string, number>()
  for (const r of counts.results || []) countMap.set(r.slideshow_id, Number(r.n || 0))

  return c.json({ slideshows: (rows.results || []).map((r) => serializeSlideshow(r, countMap.get(r.id) || 0)) })
})

slideshows.get('/:id/items', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM Slideshows WHERE id = ? AND owner_id = ?').bind(id, orbitId).first<SlideshowRow>()
  if (!row) return c.json({ error: 'Slideshow not found' }, 404)
  return c.json({ items: await resolveItems(c.env.DB, orbitId, row) })
})

slideshows.get('/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM Slideshows WHERE id = ? AND owner_id = ?').bind(id, orbitId).first<SlideshowRow>()
  if (!row) return c.json({ error: 'Slideshow not found' }, 404)
  const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM SlideshowItems WHERE slideshow_id = ?').bind(id).first<{ n: number }>()
  return c.json({ slideshow: serializeSlideshow(row, Number(count?.n || 0)), items: await resolveItems(c.env.DB, orbitId, row) })
})

slideshows.post('/', async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json().catch(() => null) as any
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid body' }, 400)

  const source = SOURCES.includes(body.source) ? body.source as Source : null
  if (!source) return c.json({ error: 'Invalid source' }, 400)

  const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_TITLE) || null
  let interval = Number(body.interval_ms)
  if (!Number.isFinite(interval)) interval = 5000
  interval = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(interval)))

  const id = crypto.randomUUID()

  if (source === 'api') {
    const rawTags = Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? body.tags.split(/[\n,]+/) : [])
    // Client-side filtering only: store tags verbatim (shared/blocklist.json).
    const tags = normalizeTagShape(rawTags.map((t: unknown) => String(t ?? '')))
    await c.env.DB
      .prepare('INSERT INTO Slideshows (id, owner_id, title, source, tags, interval_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, orbitId, title, source, JSON.stringify(tags), interval)
      .run()
    return c.json({ slideshow: serializeSlideshow({ id, owner_id: orbitId, title, source, tags: JSON.stringify(tags), interval_ms: interval, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 0) })
  }

  const rawItems = Array.isArray(body.items) ? body.items : []
  const items: Array<{ object_id: string; caption: string | null; mime_type: string | null }> = []
  for (const it of rawItems.slice(0, MAX_ITEMS)) {
    const objectId = typeof it?.object_id === 'string' ? it.object_id.trim() : (typeof it?.id === 'string' ? it.id.trim() : '')
    if (!objectId) continue
    items.push({
      object_id: objectId,
      caption: typeof it?.caption === 'string' ? it.caption.trim().slice(0, 300) || null : null,
      mime_type: typeof it?.mime_type === 'string' ? it.mime_type : null,
    })
  }
  if (items.length === 0) return c.json({ error: 'Select at least one item' }, 400)

  await c.env.DB
    .prepare('INSERT INTO Slideshows (id, owner_id, title, source, interval_ms) VALUES (?, ?, ?, ?, ?)')
    .bind(id, orbitId, title, source, interval)
    .run()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    await c.env.DB
      .prepare('INSERT INTO SlideshowItems (id, slideshow_id, object_id, caption, mime_type, position) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, item.object_id, item.caption, item.mime_type, i)
      .run()
  }

  return c.json({ slideshow: serializeSlideshow({ id, owner_id: orbitId, title, source, tags: null, interval_ms: interval, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, items.length) })
})

slideshows.patch('/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM Slideshows WHERE id = ? AND owner_id = ?').bind(id, orbitId).first<SlideshowRow>()
  if (!row) return c.json({ error: 'Slideshow not found' }, 404)

  const body = await c.req.json().catch(() => null) as any
  let title = row.title
  let interval = row.interval_ms
  if (typeof body?.title === 'string') title = body.title.trim().slice(0, MAX_TITLE) || null
  if (body?.interval_ms !== undefined) {
    const n = Number(body.interval_ms)
    if (Number.isFinite(n)) interval = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(n)))
  }

  await c.env.DB
    .prepare('UPDATE Slideshows SET title = ?, interval_ms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?')
    .bind(title, interval, id, orbitId)
    .run()
  return c.json({ success: true })
})

slideshows.delete('/:id', async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id FROM Slideshows WHERE id = ? AND owner_id = ?').bind(id, orbitId).first()
  if (!row) return c.json({ error: 'Slideshow not found' }, 404)
  await c.env.DB.atomicBatch([
    { sql: 'DELETE FROM SlideshowItems WHERE slideshow_id = ?', args: [id] },
    { sql: 'DELETE FROM Slideshows WHERE id = ? AND owner_id = ?', args: [id, orbitId] },
  ])
  return c.json({ success: true })
})
