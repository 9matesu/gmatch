import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import { encryptBlob } from './crypto'

/**
 * One-shot migration: move inline data: URLs out of Objects.content_url into
 * the encrypted blob store (AES-256-GCM via crypto.ts).
 *
 * Idempotent: rows already holding bucket keys (objects/<id>) or URLs are skipped.
 */
export async function migrateDataUrls(db: D1Turso, bucket: LocalBlobStore): Promise<number> {
  const { results } = await db.prepare(
    "SELECT id, content_url FROM Objects WHERE content_url LIKE 'data:%'"
  ).all<{ id: string; content_url: string }>()

  let moved = 0
  for (const r of results || []) {
    const m = r.content_url.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
    if (!m) continue
    const mimeType = m[1] || 'application/octet-stream'
    const bytes = m[2]
      ? Buffer.from(m[3], 'base64')
      : Buffer.from(decodeURIComponent(m[3]))

    const encrypted = encryptBlob(new Uint8Array(bytes))
    await bucket.put(`objects/${r.id}`, encrypted, { httpMetadata: { contentType: mimeType } })

    await db.prepare(
      'UPDATE Objects SET content_url = ?, mime_type = ?, size_bytes = ? WHERE id = ?'
    ).bind(`objects/${r.id}`, mimeType, bytes.length, r.id).run()

    moved++
  }

  return moved
}
