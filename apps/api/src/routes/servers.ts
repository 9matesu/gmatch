import { Hono } from 'hono'
import { sha256 } from '@noble/hashes/sha256'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

/**
 * Public SERVER DIRECTORY (plan T3) — lives ONLY on the central node.
 * It stores metadata about self-hosted gMatch servers so players can discover
 * and join them. It NEVER sees or stores server content: every server is a
 * separate full node with its own SQLite on its owner's machine.
 *
 * Privacy notes:
 *  - endpoint_hint (the host address) is only revealed to AUTHENTICATED
 *    callers — anonymous listing visitors get name/description only, no IPs.
 *  - server id is a content hash (owner pubkey|name) — no coordinates.
 */
type Bindings = { DB: D1Turso }

export const servers = new Hono<{ Bindings: Bindings, Variables: { orbitId: string; publicKeyHex: string } }>()

/** Soft auth: run full orbitAuth only when signed headers are present. */
async function softAuth(c: any, next: () => Promise<void>) {
  if (c.req.header('X-Orbit-Id')) return orbitAuth(c, next)
  return next()
}

const MAX_NAME = 60
const MAX_DESC = 200
const MAX_HINT = 120
const MAX_PER_OWNER = 5
const STALE_MS = 24 * 60 * 60 * 1000

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function serverId(ownerPubHex: string, name: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${ownerPubHex}|${name}`)))
}

/** endpoint_hint: host:port or absolute http(s) URL — no paths, no schemes beyond http(s). */
function validHint(hint: string): boolean {
  if (!hint) return true
  if (/^https?:\/\//i.test(hint)) {
    try {
      const u = new URL(hint)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }
  return /^[A-Za-z0-9._-]{1,120}(:\d{1,5})?$/.test(hint)
}

servers.get('/', softAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description, owner_id, password_required, endpoint_hint, created_at, last_seen
     FROM ServerDirectory
     WHERE last_seen >= datetime('now', ?)
     ORDER BY last_seen DESC LIMIT 100`,
  ).bind(`-${STALE_MS / 1000} seconds`).all<Record<string, unknown>>()
  // Host addresses go to signed-in callers only (anti-scraper, anti-mapping):
  // anonymous directory browsers see name/description, never coordinates.
  const authed = !!c.get('orbitId')
  return c.json({ servers: (results || []).map((r) => (authed ? r : { ...r, endpoint_hint: undefined })) })
})

servers.post('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const ownerPub = c.get('publicKeyHex')
  let name = ''
  let description = ''
  let endpointHint = ''
  let passwordRequired = 0
  try {
    const body = await c.req.json()
    if (typeof body?.name === 'string') name = body.name.trim().slice(0, MAX_NAME)
    if (typeof body?.description === 'string') description = body.description.trim().slice(0, MAX_DESC)
    if (typeof body?.endpoint_hint === 'string') endpointHint = body.endpoint_hint.trim().slice(0, MAX_HINT)
    if (body?.password_required === true) passwordRequired = 1
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (!name) return c.json({ error: 'name is required' }, 400)
  if (!validHint(endpointHint)) return c.json({ error: 'endpoint_hint must be host:port or an http(s) origin' }, 400)

  const existing = await c.env.DB.prepare('SELECT COUNT(*) as n FROM ServerDirectory WHERE owner_id = ?').bind(orbitId).first<{ n: number }>()
  const id = serverId(ownerPub, name)
  const mine = await c.env.DB.prepare('SELECT id FROM ServerDirectory WHERE id = ? AND owner_id = ?').bind(id, orbitId).first<{ id: string }>()
  if (!mine && (existing?.n ?? 0) >= MAX_PER_OWNER) return c.json({ error: `max ${MAX_PER_OWNER} servers per owner` }, 429)

  await c.env.DB.prepare(`
    INSERT INTO ServerDirectory (id, name, description, owner_id, owner_pubkey, endpoint_hint, password_required, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET description = excluded.description, endpoint_hint = excluded.endpoint_hint,
      password_required = excluded.password_required, last_seen = datetime('now')
  `).bind(id, name, description, orbitId, ownerPub, endpointHint, passwordRequired).run()

  const row = await c.env.DB.prepare('SELECT id, name, description, owner_id, password_required, created_at FROM ServerDirectory WHERE id = ?').bind(id).first()
  return c.json({ server: row }, 201)
})

servers.post('/:id/ping', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare(`UPDATE ServerDirectory SET last_seen = datetime('now') WHERE id = ? AND owner_id = ?`).bind(id, orbitId).run()

  const still = await c.env.DB.prepare('SELECT id FROM ServerDirectory WHERE id = ? AND owner_id = ?').bind(id, orbitId).first()
  if (!still) return c.json({ error: 'not found or not yours' }, 404)
  return c.json({ ok: true })
})

// ---- per-node dashboard (plan T4) --------------------------------------------
// Serves the node's OWN stats — runs identically on the central and on any
// full node the user is connected to (the client fetches it from that node's
// base URL). Privacy: truncated ids, public display names only, and a boolean
// online flag on the same 60s window the hack gate uses. No IPs, no emails
// (they don't exist), no last_seen timestamps leaking activity patterns.
servers.get('/dashboard', softAuth, async (c) => {
  const users = await c.env.DB.prepare(
    `SELECT id, display_name, CASE WHEN last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-60 seconds') THEN 1 ELSE 0 END as online
     FROM Users WHERE is_admin = 0 OR is_admin IS NULL
     ORDER BY online DESC, display_name ASC LIMIT 100`,
  ).all<{ id: string; display_name: string | null; online: number }>()
  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM Objects WHERE is_public = 1 AND created_at >= datetime('now', '-1 day')) as posts_24h,
       (SELECT COUNT(*) FROM Users) as members_total`,
  ).first<{ posts_24h: number; members_total: number }>()
  const authed = !!c.get('orbitId')
  return c.json({
    name: 'gMatch server',
    // userlist for signed-in members of any server; counts for anonymous
    users: authed
      ? (users.results || []).map((u) => ({
          id: u.id.slice(0, 8),
          display_name: u.display_name?.trim() || undefined,
          online: u.online === 1,
        }))
      : [],
    posts_24h: counts?.posts_24h ?? 0,
    members_total: counts?.members_total ?? 0,
  })
})

servers.delete('/:id', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT owner_id FROM ServerDirectory WHERE id = ?').bind(id).first<{ owner_id: string }>()
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.owner_id !== orbitId) return c.json({ error: 'only the owner can unregister' }, 403)
  await c.env.DB.prepare('DELETE FROM ServerDirectory WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})
