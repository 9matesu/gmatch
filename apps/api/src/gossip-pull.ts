import type { D1Turso } from './db'
import { applyGossipEnvelope } from './routes/gossip'
import type { GossipEnvelope } from '@orbit/shared'

/**
 * Host pull loop (plan G1 — every user a self-hosting db).
 *
 * A host node periodically pulls SIGNED public-post envelopes from an
 * upstream relay (central by default) and applies them to its own db via
  * applyGossipEnvelope (re-validates shape + signature, upserts
 * a Users stub + the public Objects row, idempotent). Offline hosts catch
 * up on next pull thanks to the durable cursor in SystemMeta.
 *
 * Blind by construction: pull is an unauthenticated GET of public posts;
 * the applier trusts signatures, never the relay.
 */

const CURSOR_KEY = 'gossip_cursor'
const PULL_LIMIT = 200

export interface GossipPullResult {
  applied: number
  duplicates: number
  rejected: number
  nextCursor: string | null
}

async function readCursor(db: D1Turso): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(CURSOR_KEY)
      .first<{ value: string }>()
    return row?.value || null
  } catch {
    return null
  }
}

async function writeCursor(db: D1Turso, cursor: string): Promise<void> {
  try {
    await db.prepare('INSERT OR REPLACE INTO SystemMeta (key, value) VALUES (?, ?)').bind(CURSOR_KEY, cursor).run()
  } catch {
    /* cursor persistence is best-effort; next pull replays */
  }
}

/** Pull one page from upstream and apply it. Throws on transport failure. */
export async function pullGossipUpstream(
  db: D1Turso,
  upstream: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GossipPullResult> {
  const base = upstream.replace(/\/+$/, '')
  const cursor = await readCursor(db)
  const url = `${base}/api/gossip/since?limit=${PULL_LIMIT}` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`gossip pull failed: ${res.status}`)
  const data = (await res.json()) as { envelopes?: GossipEnvelope[]; nextCursor?: string | null }
  const envelopes = Array.isArray(data.envelopes) ? data.envelopes : []
  const out: GossipPullResult = { applied: 0, duplicates: 0, rejected: 0, nextCursor: null }
  for (const env of envelopes) {
    try {
      const r = await applyGossipEnvelope(db, env)
      if (r === 'applied') out.applied++
      else if (r === 'duplicate') out.duplicates++
      else out.rejected++
    } catch {
      out.rejected++
    }
  }
  const next = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null
  if (next) {
    out.nextCursor = next
    await writeCursor(db, next)
  }
  return out
}
