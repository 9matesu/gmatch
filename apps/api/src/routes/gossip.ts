import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { verifySignature, hexToBytes } from '@orbit/crypto'
import {
  gossipWellFormed,
  gossipSigningMessage,
  MAX_GOSSIP_TTL_DAYS,
  type GossipEnvelope,
  type GossipPostPayload,
} from '@orbit/shared'

/**
 * Gossip relay (plan G1 — every user a self-hosting db).
 *
 * Public posts replicate node-to-node as SIGNED envelopes. This relay is
 * blind by construction: it validates SHAPE (gossipWellFormed) + SIGNATURE
 * (Ed25519 over the canonical payload) and stores the bytes verbatim.
 * Media stays local-first on the poster's disk (P2P swarm); only post
 * metadata travels here.
 *
 * - POST /api/gossip/envelopes (authed, own posts only: author_id must equal
 *   the caller) → durable store, idempotent by envelope id.
 * - GET  /api/gossip/since?cursor=&limit= (PUBLIC — hosts pull without an
 *   identity bootstrap; envelopes are public posts) → ordered envelopes.
 *
  * Write path enforces a per-author daily cap, mirroring POST /api/objects
  * policy. Tag filtering happens client-side only (shared/blocklist.json):
  * the relay stores envelopes verbatim, never hard-blocks a tag. Unlike
  * the in-memory blind mail store, envelopes are DURABLE so offline hosts
  * catch up on next pull.
  */

type Bindings = {
  DB: D1Turso
}

/** Max envelopes a pull returns (cap doubles as abuse bound). */
const MAX_PULL_LIMIT = 200
/** Max public posts one author may gossip per rolling day. */
const MAX_ENVELOPES_PER_AUTHOR_PER_DAY = 100

function envelopeRow(e: GossipEnvelope, ttlDays: number) {
  const ttl = Math.min(Math.max(ttlDays || MAX_GOSSIP_TTL_DAYS, 1), MAX_GOSSIP_TTL_DAYS)
  return {
    id: e.id,
    author_id: e.author_id,
    author_pubkey: e.payload.author_pubkey,
    kind: e.kind,
    payload: JSON.stringify(e.payload),
    sig: e.sig.toLowerCase(),
    origin_node: (e.origin_node || '').slice(0, 120),
    created_at: e.payload.created_at,
    expires_at: new Date(Date.now() + ttl * 24 * 3600 * 1000).toISOString(),
  }
}

function verifyEnvelopeSig(e: GossipEnvelope): boolean {
  try {
    const sig = hexToBytes(e.sig)
    const msg = gossipSigningMessage(e.payload)
    return verifySignature(sig, msg, e.payload.author_pubkey)
  } catch {
    return false
  }
}

/**
 * Apply one pulled envelope to a host db: re-validate everything (never
 * trust the relay), then upsert a minimal Users stub + the public Objects
 * row. Idempotent — replays and multi-path delivery collapse to 'duplicate'.
 */
export async function applyGossipEnvelope(
  db: D1Turso,
  e: GossipEnvelope,
): Promise<'applied' | 'duplicate' | 'rejected'> {
  const malformed = gossipWellFormed(e)
  if (malformed) return 'rejected'
  if (!verifyEnvelopeSig(e)) return 'rejected'
  const p: GossipPostPayload = e.payload
  // Client-side filtering only: envelopes apply verbatim (see module doc).
  // Known-author binding: never let an envelope rewrite a local user's key.
  const known = await db.prepare('SELECT public_key FROM Users WHERE id = ?').bind(p.owner_id)
    .first<{ public_key: string }>().catch(() => null)
  if (known && known.public_key.toLowerCase() !== p.author_pubkey.toLowerCase()) return 'rejected'
  if (!known) {
    await db.prepare('INSERT OR IGNORE INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(
      p.owner_id, p.author_pubkey.toLowerCase(), (p.author_name || '').slice(0, 80),
    ).run().catch(() => { })
  }
  const r = await db.prepare(
    `INSERT OR IGNORE INTO Objects
     (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, post_caption,
      location, post_tags, content_hash, post_group, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    p.id, p.owner_id, p.size_bytes, p.mime_type, p.content_url,
    p.caption, p.caption, p.location, p.post_tags, p.content_hash, p.post_group, p.created_at,
  ).run().catch(() => null)
  const changes = Number((r as any)?.meta?.changes ?? (r as any)?.changes ?? 0)
  return changes > 0 ? 'applied' : 'duplicate'
}

export const gossip = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

gossip.post('/envelopes', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  let body: GossipEnvelope
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const malformed = gossipWellFormed(body)
  if (malformed) return c.json({ error: malformed }, 400)
  // Own posts only: the caller signs with their own key, which also bounds
  // relay spam to the per-author daily cap below.
  if (body.author_id !== orbitId) return c.json({ error: 'author_id must match caller' }, 403)
  if (!verifyEnvelopeSig(body)) return c.json({ error: 'Invalid envelope signature' }, 401)
  // Home-node binding: the enclosed key must match the local Users row.
  const local = await c.env.DB.prepare('SELECT public_key FROM Users WHERE id = ?').bind(orbitId)
    .first<{ public_key: string }>().catch(() => null)
  if (local && local.public_key.toLowerCase() !== body.payload.author_pubkey.toLowerCase()) {
    return c.json({ error: 'author_pubkey does not match local user' }, 403)
  }
  // Client-side filtering only: store the envelope verbatim (see module doc).
  const dayCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM GossipEnvelopes WHERE author_id = ? AND received_at > datetime('now', '-1 day')",
  ).bind(orbitId).first<{ n: number }>().catch(() => ({ n: 0 }))
  if (Number(dayCount?.n || 0) >= MAX_ENVELOPES_PER_AUTHOR_PER_DAY) {
    return c.json({ error: 'Daily gossip quota exceeded' }, 429)
  }
  const row = envelopeRow(body, body.ttl_days ?? MAX_GOSSIP_TTL_DAYS)
  const r = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO GossipEnvelopes
     (id, author_id, author_pubkey, kind, payload, sig, origin_node, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.id, row.author_id, row.author_pubkey.toLowerCase(), row.kind, row.payload,
    row.sig, row.origin_node, row.created_at, row.expires_at,
  ).run().catch(() => null)
  if (!r) return c.json({ error: 'Failed to store envelope' }, 500)
  const changes = Number((r as any)?.meta?.changes ?? (r as any)?.changes ?? 0)
  return c.json({ id: row.id, deduped: changes === 0 }, 200)
})

gossip.get('/since', async (c) => {
  // Expired envelopes die on read (plus natural neglect — no sweeper needed).
  await c.env.DB.prepare("DELETE FROM GossipEnvelopes WHERE expires_at <= datetime('now')").run().catch(() => { })
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), MAX_PULL_LIMIT)
  const cursor = (c.req.query('cursor') || '').trim()
  let rows: any[]
  if (cursor) {
    const [ts, cid] = cursor.split(',', 2)
    if (!ts || !cid) return c.json({ error: 'cursor must be "<received_at ISO>,<id>"' }, 400)
    const out = await c.env.DB.prepare(
      `SELECT id, author_id, author_pubkey, kind, payload, sig, origin_node, created_at, received_at, expires_at
       FROM GossipEnvelopes
       WHERE (received_at, id) > (?, ?)
       ORDER BY received_at ASC, id ASC
       LIMIT ?`,
    ).bind(ts, cid, limit).all<any>().catch(() => null)
    rows = out?.results || []
  } else {
    const out = await c.env.DB.prepare(
      `SELECT id, author_id, author_pubkey, kind, payload, sig, origin_node, created_at, received_at, expires_at
       FROM GossipEnvelopes
       ORDER BY received_at ASC, id ASC
       LIMIT ?`,
    ).bind(limit).all<any>().catch(() => null)
    rows = out?.results || []
  }
  const envelopes = rows.map((r) => {
    let payload: unknown = null
    try { payload = JSON.parse(r.payload) } catch { payload = null }
    return {
      kind: r.kind,
      id: r.id,
      author_id: r.author_id,
      payload,
      sig: r.sig,
      origin_node: r.origin_node || undefined,
      created_at: r.created_at,
      received_at: r.received_at,
      expires_at: r.expires_at,
    }
  })
  const last = rows[rows.length - 1]
  return c.json({
    envelopes,
    nextCursor: last ? `${last.received_at},${last.id}` : cursor || null,
  })
})
