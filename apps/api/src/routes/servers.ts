import { Hono } from 'hono'
import { bytesToHex } from '../hexio'
import { sha256 } from '@noble/hashes/sha256'
import { orbitAuth } from '../middleware/auth'
import { adminAuth } from '../middleware/admin'
import { logAdminAction } from '../admin-audit'
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

const NODE_NAME_KEY = 'server_name'
const NODE_DESC_KEY = 'server_description'
const NODE_DIRECTORY_KEY = 'server_directory_id'

async function getMeta(db: D1Turso, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(key).first<{ value: string | null }>()
  return row?.value ?? null
}

async function setMeta(db: D1Turso, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO SystemMeta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run()
}

async function clearMeta(db: D1Turso, key: string): Promise<void> {
  await db.prepare('DELETE FROM SystemMeta WHERE key = ?').bind(key).run()
}

async function isNodeAdmin(db: D1Turso, orbitId: string): Promise<boolean> {
  const row = await db.prepare('SELECT is_admin, (SELECT COUNT(*) FROM Users) as n FROM Users WHERE id = ?').bind(orbitId).first<{ is_admin: number; n: number }>()
  return Boolean(row && (row.is_admin === 1 || (row.n ?? 0) <= 1))
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
    `SELECT id, name, description, owner_id, password_required, endpoint_hint, user_count, online_count, created_at, last_seen
     FROM ServerDirectory
     WHERE last_seen >= datetime('now', ?)
       AND COALESCE(hidden, 0) = 0 AND COALESCE(blocked, 0) = 0
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
  let userCount: number | null = null
  let onlineCount: number | null = null
  try {
    const body = await c.req.json()
    if (typeof body?.name === 'string') name = body.name.trim().slice(0, MAX_NAME)
    if (typeof body?.description === 'string') description = body.description.trim().slice(0, MAX_DESC)
    if (typeof body?.endpoint_hint === 'string') endpointHint = body.endpoint_hint.trim().slice(0, MAX_HINT)
    if (body?.password_required === true) passwordRequired = 1
    // Optional host-reported metadata (game-browser style counts). Clamped,
    // non-negative integers; absent stays NULL — never a fabricated zero.
    const clamp = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1_000_000) : null
    userCount = clamp(body?.user_count)
    onlineCount = clamp(body?.online_count)
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
    INSERT INTO ServerDirectory (id, name, description, owner_id, owner_pubkey, endpoint_hint, password_required, user_count, online_count, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET description = excluded.description, endpoint_hint = excluded.endpoint_hint,
      password_required = excluded.password_required,
      user_count = COALESCE(excluded.user_count, ServerDirectory.user_count),
      online_count = COALESCE(excluded.online_count, ServerDirectory.online_count),
      last_seen = datetime('now')
  `).bind(id, name, description, orbitId, ownerPub, endpointHint, passwordRequired, userCount, onlineCount).run()

  const row = await c.env.DB.prepare('SELECT id, name, description, owner_id, password_required, created_at FROM ServerDirectory WHERE id = ?').bind(id).first()
  return c.json({ server: row }, 201)
})

// ---- node-local identity (Servers suite) -------------------------------------
// This is the name/details of the node answering the request, independent of
// any central directory row. Host admins can change it from the Servers tab.
servers.get('/node', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const name = (await getMeta(c.env.DB, NODE_NAME_KEY)) || 'gmatch'
  const description = (await getMeta(c.env.DB, NODE_DESC_KEY)) || ''
  const directoryId = await getMeta(c.env.DB, NODE_DIRECTORY_KEY)
  return c.json({
    name,
    description,
    directoryId,
    isAdmin: await isNodeAdmin(c.env.DB, orbitId),
  })
})

servers.patch('/node', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  if (!(await isNodeAdmin(c.env.DB, orbitId))) return c.json({ error: 'only the node host can rename this server' }, 403)
  let body: Record<string, unknown> = {}
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'invalid json' }, 400) }
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, MAX_NAME)
    if (!name) return c.json({ error: 'name is required' }, 400)
    await setMeta(c.env.DB, NODE_NAME_KEY, name)
  }
  if (typeof body.description === 'string') {
    await setMeta(c.env.DB, NODE_DESC_KEY, body.description.trim().slice(0, MAX_DESC))
  }
  // Directory row this node is listed as (set by the create-server flow so
  // /node can report the linkage without leaning on the owner's localStorage).
  if (typeof body.directory_id === 'string') {
    const did = body.directory_id.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(did)) return c.json({ error: 'directory_id must be a directory server id' }, 400)
    await setMeta(c.env.DB, NODE_DIRECTORY_KEY, did)
  }
  const name = (await getMeta(c.env.DB, NODE_NAME_KEY)) || 'gmatch'
  const description = (await getMeta(c.env.DB, NODE_DESC_KEY)) || ''
  const directoryId = await getMeta(c.env.DB, NODE_DIRECTORY_KEY)
  return c.json({ server: { name, description, directoryId, isAdmin: true } })
})

servers.post('/:id/ping', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  await c.env.DB.prepare(`UPDATE ServerDirectory SET last_seen = datetime('now') WHERE id = ? AND owner_id = ?`).bind(id, orbitId).run()

  const still = await c.env.DB.prepare('SELECT id FROM ServerDirectory WHERE id = ? AND owner_id = ?').bind(id, orbitId).first()
  if (!still) return c.json({ error: 'not found or not yours' }, 404)
  return c.json({ ok: true })
})

servers.patch('/:id', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT owner_id FROM ServerDirectory WHERE id = ?').bind(id).first<{ owner_id: string }>()
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.owner_id !== orbitId) return c.json({ error: 'only the owner can update this server' }, 403)

  let body: Record<string, unknown> = {}
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'invalid json' }, 400) }

  const current = await c.env.DB.prepare(
    'SELECT name, description, endpoint_hint, password_required FROM ServerDirectory WHERE id = ?',
  ).bind(id).first<{ name: string; description: string; endpoint_hint: string; password_required: number }>()
  if (!current) return c.json({ error: 'not found' }, 404)

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : current.name
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESC) : current.description
  const endpointHint = typeof body.endpoint_hint === 'string' ? body.endpoint_hint.trim().slice(0, MAX_HINT) : current.endpoint_hint
  const passwordRequired = typeof body.password_required === 'boolean' ? (body.password_required ? 1 : 0) : current.password_required
  if (!name) return c.json({ error: 'name is required' }, 400)
  if (!validHint(endpointHint)) return c.json({ error: 'endpoint_hint must be host:port or an http(s) origin' }, 400)

  await c.env.DB.prepare(`
    UPDATE ServerDirectory
    SET name = ?, description = ?, endpoint_hint = ?, password_required = ?, updated_at = datetime('now'), last_seen = datetime('now')
    WHERE id = ? AND owner_id = ?
  `).bind(name, description, endpointHint, passwordRequired, id, orbitId).run()

  const updated = await c.env.DB.prepare(
    'SELECT id, name, description, owner_id, password_required, endpoint_hint, created_at, last_seen, updated_at FROM ServerDirectory WHERE id = ?',
  ).bind(id).first()
  return c.json({ server: updated })
})

// ---- per-node dashboard (plan T4) --------------------------------------------
// Serves the node's OWN stats — runs identically on the central and on any
// full node the user is connected to (the client fetches it from that node's
// base URL). Privacy: truncated ids, public display names only, and a boolean
// online flag on the same 60s window the hack gate uses. No IPs, no emails
// (they don't exist), no last_seen timestamps leaking activity patterns.
servers.get('/dashboard', softAuth, async (c) => {
  const users = await c.env.DB.prepare(
    `SELECT id, display_name, pfp_url, last_seen,
       CASE WHEN last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-60 seconds') THEN 1 ELSE 0 END as online,
       CASE WHEN last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END as active_24h
     FROM Users WHERE (is_admin = 0 OR is_admin IS NULL)
       AND (last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-24 hours'))
     ORDER BY online DESC, last_seen DESC, display_name ASC LIMIT 100`,
  ).all<{ id: string; display_name: string | null; pfp_url: string | null; last_seen: string | null; online: number }>()
  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM Objects WHERE is_public = 1 AND created_at >= datetime('now', '-1 day')) as posts_24h,
       (SELECT COUNT(*) FROM Users) as members_total`,
  ).first<{ posts_24h: number; members_total: number }>()
  const authed = !!c.get('orbitId')
  const serverName = (await getMeta(c.env.DB, NODE_NAME_KEY)) || 'gmatch'
  return c.json({
    name: serverName,
    // userlist for signed-in members of any server; counts for anonymous
    users: authed
      ? (users.results || []).map((u) => ({
          id: u.id.slice(0, 8),
          display_name: u.display_name?.trim() || undefined,
          pfp_url: u.pfp_url || undefined,
          last_seen: u.last_seen,
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

// ---- central-node master admin (plan §5) ----------------------------------
// Only meaningful on the central node (the one that runs this directory). The
// central master is the ADMIN_PIN holder who verified via /api/admin/verify-pin
// and therefore carries Users.is_admin — so this reuses adminAuth (is_admin).
const adminServers = new Hono<{ Bindings: Bindings, Variables: { orbitId: string; publicKeyHex: string } }>()
adminServers.use('*', orbitAuth, adminAuth)

const MAX_NOTE = 500

// Overview: totals + online/stale + hidden/blocked + recent registrations.
adminServers.get('/dashboard', async (c) => {
  const stale = `-${STALE_MS / 1000} seconds`
  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN datetime(last_seen) >= datetime('now', ?) THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN datetime(last_seen) <  datetime('now', ?) THEN 1 ELSE 0 END) AS stale,
      SUM(COALESCE(hidden, 0)) AS hidden,
      SUM(COALESCE(blocked, 0)) AS blocked
    FROM ServerDirectory`,
  ).bind(stale, stale).first<Record<string, number | null>>()
  const recent = await c.env.DB.prepare(
    `SELECT id, name, owner_id, endpoint_hint, created_at, last_seen
     FROM ServerDirectory ORDER BY created_at DESC LIMIT 10`,
  ).all<Record<string, unknown>>()
  return c.json({
    totals: {
      total: totals?.total ?? 0,
      online: totals?.online ?? 0,
      stale: totals?.stale ?? 0,
      hidden: totals?.hidden ?? 0,
      blocked: totals?.blocked ?? 0,
    },
    recent: recent.results || [],
  })
})

// Full directory including stale/hidden/blocked + endpoint hints (admin only).
adminServers.get('/directory', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description, owner_id, endpoint_hint, password_required,
            COALESCE(hidden, 0) AS hidden, COALESCE(blocked, 0) AS blocked, master_note,
            created_at, last_seen, updated_at
     FROM ServerDirectory ORDER BY last_seen DESC LIMIT 500`,
  ).all<Record<string, unknown>>()
  return c.json({ servers: results || [] })
})

// Patch moderation flags / note on one entry.
adminServers.patch('/directory/:id', async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')
  let body: Record<string, unknown> = {}
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'invalid json' }, 400) }
  const sets: string[] = []
  const args: (number | string)[] = []
  if (typeof body.hidden === 'boolean') { sets.push('hidden = ?'); args.push(body.hidden ? 1 : 0) }
  if (typeof body.blocked === 'boolean') { sets.push('blocked = ?'); args.push(body.blocked ? 1 : 0) }
  if (typeof body.master_note === 'string') { sets.push('master_note = ?'); args.push(body.master_note.slice(0, MAX_NOTE)) }
  if (sets.length === 0) return c.json({ error: 'no fields to update' }, 400)
  sets.push("updated_at = datetime('now')")
  args.push(id)
  await c.env.DB.prepare(`UPDATE ServerDirectory SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run()
  const row = await c.env.DB.prepare(
    `SELECT id, name, COALESCE(hidden, 0) AS hidden, COALESCE(blocked, 0) AS blocked, master_note, updated_at
     FROM ServerDirectory WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>()
  if (!row) return c.json({ error: 'not found' }, 404)
  await logAdminAction(c.env.DB, orbitId, 'servers_admin_patch', { id, type: 'server_directory' }, JSON.stringify(body))
  return c.json({ server: row })
})

// Force-unregister any entry from the directory.
adminServers.delete('/directory/:id', async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')
  const row = await c.env.DB.prepare('SELECT id, owner_id FROM ServerDirectory WHERE id = ?').bind(id).first<{ id: string; owner_id: string }>()
  if (!row) return c.json({ error: 'not found' }, 404)
  await c.env.DB.prepare('DELETE FROM ServerDirectory WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, orbitId, 'servers_admin_delete', { id, type: 'server_directory' }, JSON.stringify({ owner_id: row.owner_id }))
  return c.json({ ok: true })
})

servers.route('/admin', adminServers)
