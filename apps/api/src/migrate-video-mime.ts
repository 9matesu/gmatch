import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import { decryptBlob } from './crypto'
import { detectMediaMime, isValidMediaMagicBytes } from './routes/objects'

export interface VideoMimeRepairStats {
  sniffed: number
  loopbackRewritten: number
}

const FLAG = 'video_mime_repair_v1'
const HEX64 = /^[0-9a-f]{64}$/

/**
 * One-shot repair for pre-1.4.7 mislabeled video rows. Idempotent via a
 * SystemMeta flag; only runs once per database.
 *
 * 1. Byte-backed rows (inline data: or encrypted bucket blobs) whose stored
 *    MIME is empty/generic/wrong are re-sniffed from the actual bytes and
 *    updated ONLY when the sniff says video/*. Deterministic — no URL,
 *    sibling, or gossip hints are ever trusted here.
 * 2. Loopback content_urls (http://127.0.0.1|localhost — unrenderable
 *    off-machine) are rewritten to urn:sha256:<hash> when a valid content
 *    hash exists (re-enters swarm resolution), else to /api/objects/<id>
 *    (honest 404 downstream, never a lie).
 *
 * Explicitly untouched: magnet:/urn: rows with no server bytes (no bytes =
 * no truth; render-time sniffing covers them when the seeder is alive).
 */
export async function repairVideoMime(db: D1Turso, bucket: LocalBlobStore | null): Promise<VideoMimeRepairStats> {
  const done = await db.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(FLAG).first<{ value?: string }>().catch(() => null)
  if (done?.value) return { sniffed: 0, loopbackRewritten: 0 }

  let sniffed = 0
  let loopbackRewritten = 0

  // 1. Re-sniff byte-backed rows with empty/generic/wrong MIME.
  const candidates = await db.prepare(
    `SELECT id, mime_type, content_url FROM Objects
     WHERE mime_type IN ('', 'application/octet-stream', 'binary/octet-stream', 'image/jpeg')
       AND (content_url LIKE 'data:%' OR content_url LIKE 'objects/%' OR content_url LIKE '/api/objects/%')`
  ).all<{ id: string; mime_type: string; content_url: string }>().catch(() => ({ results: [] }))
  for (const row of candidates.results || []) {
    try {
      const bytes = await readRowBytes(row.id, row.content_url, bucket)
      if (!bytes || bytes.length < 8) continue
      if (!isValidMediaMagicBytes(bytes)) continue
      const sniffedMime = detectMediaMime(bytes)
      if (!sniffedMime.startsWith('video/')) continue
      if ((row.mime_type || '').toLowerCase() === sniffedMime) continue
      await db.prepare('UPDATE Objects SET mime_type = ? WHERE id = ?').bind(sniffedMime, row.id).run()
      sniffed++
    } catch {
      /* best-effort per row: never fail boot for one bad blob */
    }
  }

  // 2. Rewrite unrenderable loopback URLs.
  const loopbacks = await db.prepare(
    `SELECT id, content_hash FROM Objects
     WHERE content_url LIKE '%127.0.0.1%' OR content_url LIKE '%localhost%' OR content_url LIKE '%[::1]%'`
  ).all<{ id: string; content_hash?: string | null }>().catch(() => ({ results: [] }))
  for (const row of loopbacks.results || []) {
    try {
      const hash = (row.content_hash || '').trim().toLowerCase()
      const replacement = HEX64.test(hash) ? `urn:sha256:${hash}` : `/api/objects/${row.id}`
      await db.prepare('UPDATE Objects SET content_url = ? WHERE id = ?').bind(replacement, row.id).run()
      loopbackRewritten++
    } catch {
      /* best-effort per row */
    }
  }

  await db.prepare('INSERT OR IGNORE INTO SystemMeta (key, value) VALUES (?, ?)').bind(FLAG, '1').run().catch(() => { })
  return { sniffed, loopbackRewritten }
}

async function readRowBytes(id: string, contentUrl: string, bucket: LocalBlobStore | null): Promise<Uint8Array | null> {
  // Inline data: URLs (pre-migrate-dataurls leftovers and small inlines).
  if (contentUrl.startsWith('data:')) {
    const m = contentUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
    if (!m) return null
    try {
      return new Uint8Array(m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])))
    } catch {
      return null
    }
  }
  if (!bucket) return null
  // Encrypted bucket blobs (objects/<id>); absolute /api/objects/<id> URLs
  // without a data: payload or bucket key have no local bytes to sniff.
  const key = contentUrl.startsWith('objects/') ? contentUrl : null
  if (!key) return null
  const blob = await bucket.get(key).catch(() => null)
  const reader = blob?.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0)
  if (!total) return null
  const encrypted = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    encrypted.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return decryptBlob(encrypted)
  } catch {
    return null
  }
}
