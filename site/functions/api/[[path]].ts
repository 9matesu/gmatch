/**
 * gmatch rendezvous (Cloudflare Pages Function).
 *
 * This is NOT a world. It stores no profiles, posts, presence or media — only
 * sealed envelopes and directory metadata, both of which are useless to the
 * host (the envelope body is X25519-sealed; the directory row is a name and an
 * address). Peers meet here, then talk directly over WebRTC; bytes never pass
 * through this function.
 *
 * Routes (the exact surface the desktop client already speaks):
 *   GET  /api/health              → { ok, courier, version }
 *   PUT  /api/mail/:token         → { env }                (seal for a peer)
 *   GET  /api/mail/:token         → { envelopes: [] }      (drain a box)
 *   POST /api/mail/:token/ack     → { ids }                (consume)
 *   GET  /api/servers             → { servers: [] }        (directory)
 *   POST /api/servers             → register / heartbeat
 *   GET  /api/servers/node        → { server: { lanUrls } }
 *
 * No WebSocket: the client falls back to a 20 s poll, which is a few hundred
 * bytes per peer. That is the whole egress budget.
 */

interface Env {
  MAIL: KVNamespace
  /** Static site assets (Pages provides this binding). */
  ASSETS: Fetcher
}

type Envelope = {
  v?: number
  kind?: string
  to?: string
  id?: string
  sealed?: string
  exp?: number
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

const MAIL_TTL_SECONDS = 120
const MAIL_BOX_MAX = 50
const DIRECTORY_MAX = 100
const STALE_MS = 24 * 60 * 60 * 1000
const TOKEN_RE = /^[0-9a-f]{16,128}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

function readBody<T>(req: Request): Promise<T | null> {
  return req.json().then((v) => v as T).catch(() => null)
}

async function readBox(kv: KVNamespace, token: string): Promise<Envelope[]> {
  const raw = await kv.get(`mail:${token}`)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Envelope[]) : []
  } catch {
    return []
  }
}

async function writeBox(kv: KVNamespace, token: string, box: Envelope[]): Promise<void> {
  await kv.put(`mail:${token}`, JSON.stringify(box), { expirationTtl: MAIL_TTL_SECONDS })
}

type DirectoryRow = {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required?: number
  endpoint_hint?: string
  is_private?: number
  tags?: string[]
  user_count?: number | null
  online_count?: number | null
  last_seen?: string
}

async function readDirectory(kv: KVNamespace): Promise<DirectoryRow[]> {
  const raw = await kv.get('servers')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DirectoryRow[]) : []
  } catch {
    return []
  }
}

async function writeDirectory(kv: KVNamespace, rows: DirectoryRow[]): Promise<void> {
  // The directory is infrastructure, not a destination: no row for this host.
  await kv.put('servers', JSON.stringify(rows.slice(0, DIRECTORY_MAX)))
}

function fresh(rows: DirectoryRow[]): DirectoryRow[] {
  const cutoff = Date.now() - STALE_MS
  return rows.filter((r) => !r.last_seen || Date.parse(r.last_seen) >= cutoff)
}

export async function onRequest(context: {
  request: Request
  env: Env
  params: { path?: string[] }
}): Promise<Response> {
  const { request, env, params } = context
  const url = new URL(request.url)
  const seg = params.path ?? []
  const method = request.method

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  if (seg[0] === 'api') {
    // GET /api/health
    if (seg[1] === 'health' && method === 'GET') {
      return json({ ok: true, courier: true, version: 2 })
    }

    // /api/mail/:token  and  /api/mail/:token/ack
    if (seg[1] === 'mail' && seg[2]) {
      const token = seg[2]
      if (!TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400)

      if (method === 'PUT' && seg.length === 3) {
        const body = await readBody<{ env?: Envelope }>(request)
        const env2 = body?.env
        if (!env2 || typeof env2 !== 'object' || typeof env2.sealed !== 'string' || env2.sealed.length === 0) {
          return json({ error: 'env required' }, 400)
        }
        if (typeof env2.id !== 'string' || env2.id.length < 8 || env2.id.length > 64) {
          return json({ error: 'env.id required' }, 400)
        }
        const box = await readBox(env.MAIL, token)
        if (box.length >= MAIL_BOX_MAX) return json({ error: 'mailbox full' }, 429)
        box.push(env2)
        await writeBox(env.MAIL, token, box)
        return json({ ok: true })
      }

      if (method === 'GET' && seg.length === 3) {
        const now = Date.now()
        const live = (await readBox(env.MAIL, token)).filter((e) => !e.exp || e.exp > now)
        return json({ envelopes: live })
      }

      if (method === 'POST' && seg[3] === 'ack') {
        const body = await readBody<{ ids?: unknown }>(request)
        const ids = Array.isArray(body?.ids) ? body!.ids.filter((v): v is string => typeof v === 'string') : []
        if (ids.length > 0) {
          const drop = new Set(ids)
          await writeBox(env.MAIL, token, (await readBox(env.MAIL, token)).filter((e) => !drop.has(e.id ?? '')))
        }
        return json({ ok: true })
      }
    }

    // Directory
    if (seg[1] === 'servers') {
      if (seg.length === 2 && method === 'GET') {
        return json({ servers: fresh(await readDirectory(env.MAIL)) })
      }

      if (seg.length === 2 && method === 'POST') {
        const body = await readBody<DirectoryRow & { private?: boolean }>(request)
        if (!body || typeof body.id !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
          return json({ error: 'id and name required' }, 400)
        }
        const rows = fresh(await readDirectory(env.MAIL))
        const idx = rows.findIndex((r) => r.id === body.id)
        const row: DirectoryRow = {
          id: body.id,
          name: body.name.trim().slice(0, 60),
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 200) : undefined,
          owner_id: typeof body.owner_id === 'string' ? body.owner_id : '',
          password_required: body.password_required ? 1 : 0,
          endpoint_hint: typeof body.endpoint_hint === 'string' ? body.endpoint_hint.slice(0, 200) : undefined,
          is_private: body.private === true || body.is_private === 1 ? 1 : 0,
          tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 8) : undefined,
          user_count: typeof body.user_count === 'number' ? Math.max(0, Math.floor(body.user_count)) : null,
          online_count: typeof body.online_count === 'number' ? Math.max(0, Math.floor(body.online_count)) : null,
          last_seen: new Date().toISOString(),
        }
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row }
        else rows.unshift(row)
        await writeDirectory(env.MAIL, rows)
        return json({ ok: true, id: row.id })
      }

      if (seg.length === 3 && seg[2] === 'node' && method === 'GET') {
        return json({ server: { name: 'gmatch rendezvous', directoryId: null, lanUrls: [] } })
      }
    }
  }

  // The static release page owns every other path: answer 404 JSON for /api/*,
  // and let Pages serve the site otherwise.
  if (seg[0] === 'api') return json({ error: 'not found' }, 404)
  return context.env.ASSETS.fetch(request)
}