/**
 * gmatch courier on Cloudflare Pages Functions.
 *
 * This is the replacement for the Render courier (gmatch-wcz1.onrender.com)
 * and the Fly full node (gmatch.fly.dev): one origin, `gmatch.pages.dev`,
 * serving the release page AND the blind courier.
 *
 * It is deliberately small. A courier moves opaque envelopes, keeps the
 * public server directory, and answers health/identity. It stores NO posts,
 * NO media, NO profiles, NO presence — every other /api route is a 404, the
 * same blind-courier law the Bun node enforces with SITE_SERVICES=mail.
 *
 * Mail lives in D1 (the Bun courier keeps it in memory; a Worker isolate has
 * no shared memory, so it needs the binding). Rows are dropped when the
 * recipient ACKs (proof of key ownership) or when the TTL expires.
 *
 * Contract kept byte-for-byte from apps/api:
 *   GET  /api/health
 *   GET  /api/identity         -> sealed_available:false (no node key here)
 *   GET  /api/servers          (public list; addresses only to signed callers)
 *   POST /api/servers          (orbitAuth: Ed25519 signed request)
 *   POST /api/servers/:id/ping
 *   DELETE /api/servers/:id
 *   PUT  /api/mail/:token      { env }
 *   GET  /api/mail/:token      -> { envelopes }
 *   POST /api/mail/:token/ack  { ids, pubkey, sig, epoch? }
 *   GET  /api/mail/stats/size  -> { size }
 *
 * WebSockets are not offered here: a Pages isolate cannot notify a socket
 * held by another isolate without a Durable Object. The client polls the
 * courier while it is the API base (see mail-client.ts).
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake3 } from '@noble/hashes/blake3'
import { sha256 } from '@noble/hashes/sha256'

interface Env {
  DB: D1Database
}

type PagesContext = {
  request: Request
  env: Env
}

// ---- encoding / crypto -----------------------------------------------------

const HEX_RE = /^[0-9a-f]+$/i

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function hexToBytes(hex: string): Uint8Array {
  if (!HEX_RE.test(hex) || hex.length % 2 !== 0) throw new Error('bad hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** blake3(pubkey) — the mailbox address (packages/protocol deliveryToken). */
function deliveryToken(pubKeyHex: string): string {
  return bytesToHex(blake3(hexToBytes(pubKeyHex)))
}

/** blake3(pubkey || epoch) — rotating session box (wave 2 C2). */
function sessionDeliveryToken(pubKeyHex: string, epochHex: string): string {
  const pub = hexToBytes(pubKeyHex)
  const epoch = hexToBytes(epochHex)
  const buf = new Uint8Array(pub.length + epoch.length)
  buf.set(pub, 0)
  buf.set(epoch, pub.length)
  return bytesToHex(blake3(buf))
}

function verifySignature(signature: Uint8Array, message: Uint8Array, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(signature, message, hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}

// ---- HTTP helpers ----------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Orbit-Id, X-Orbit-Timestamp, X-Orbit-Signature, X-Orbit-PubKey, X-Orbit-PubKey-Enc, X-Orbit-Nonce, X-Orbit-Sealed, Idempotency-Key, X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

function notFound(origin: string | null): Response {
  return json({ error: 'Not Found' }, 404, origin)
}

// ---- request auth (mirrors apps/api/src/middleware/auth.ts) ----------------

interface Authed {
  orbitId: string
  publicKeyHex: string
}

type AuthResult = { ok: true; auth: Authed } | { ok: false; response: Response }

async function verifyRequest(request: Request, origin: string | null): Promise<AuthResult> {
  const orbitId = request.headers.get('X-Orbit-Id')
  const timestamp = request.headers.get('X-Orbit-Timestamp')
  const signatureHex = request.headers.get('X-Orbit-Signature')
  const publicKeyHex = request.headers.get('X-Orbit-PubKey')
  const nonce = request.headers.get('X-Orbit-Nonce') || ''
  if (!orbitId || !timestamp || !signatureHex || !publicKeyHex) {
    return { ok: false, response: json({ error: 'Missing authentication headers' }, 401, origin) }
  }
  const ts = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) return { ok: false, response: json({ error: 'Invalid timestamp' }, 400, origin) }
  const maxAge = request.method === 'GET' ? 120_000 : 30_000
  if (Math.abs(Date.now() - ts) > maxAge) {
    return { ok: false, response: json({ error: 'Request expired' }, 401, origin) }
  }
  let bodyText = ''
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    bodyText = await request.clone().text()
  }
  const pathname = new URL(request.url).pathname
  const payload = nonce
    ? `${request.method}|${pathname}|${timestamp}|${nonce}|${bodyText}`
    : `${request.method}|${pathname}|${timestamp}|${bodyText}`
  let sig: Uint8Array
  try {
    sig = hexToBytes(signatureHex)
  } catch {
    return { ok: false, response: json({ error: 'Invalid signature encoding' }, 400, origin) }
  }
  if (!verifySignature(sig, new TextEncoder().encode(payload), publicKeyHex)) {
    return { ok: false, response: json({ error: 'Invalid signature' }, 401, origin) }
  }
  const computedId = bytesToHex(sha256(hexToBytes(publicKeyHex)))
  if (computedId !== orbitId) {
    return { ok: false, response: json({ error: 'Public key does not match Orbit ID' }, 401, origin) }
  }
  return { ok: true, auth: { orbitId, publicKeyHex } }
}

/** Directory routes accept anonymous reads; anything signed is verified. */
async function softAuth(request: Request, origin: string | null): Promise<{ auth: Authed | null; response?: Response }> {
  if (!request.headers.get('X-Orbit-Id')) return { auth: null }
  const result = await verifyRequest(request, origin)
  if (!result.ok) return { auth: null, response: result.response }
  return { auth: result.auth }
}

// ---- mail (D1) -------------------------------------------------------------

const MAIL_TTL_MS = 7 * 24 * 3600_000
const MAIL_MAX_PER_TOKEN = 256
const MAIL_MAX_SEALED = 64 * 1024
const TOKEN_RE = /^[0-9a-f]{32,64}$/i
const PUBKEY_RE = /^[0-9a-f]{64}$/
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

interface MailEnvelope {
  v: 2
  kind: string
  to: string
  id: string
  sealed: string
  fromEph?: string
  exp?: number
}

function wellFormed(env: MailEnvelope): boolean {
  return (
    env.v === 2 &&
    typeof env.kind === 'string' && env.kind.length > 0 && env.kind.length <= 16 &&
    typeof env.to === 'string' && TOKEN_RE.test(env.to) &&
    typeof env.id === 'string' && ID_RE.test(env.id) &&
    typeof env.sealed === 'string' && env.sealed.length > 0 && env.sealed.length <= MAIL_MAX_SEALED &&
    (env.fromEph === undefined || PUBKEY_RE.test(env.fromEph)) &&
    (env.exp === undefined || (typeof env.exp === 'number' && env.exp > 0))
  )
}

async function sweepToken(db: D1Database, token: string, now: number): Promise<void> {
  await db.prepare('DELETE FROM Mail WHERE token = ? AND expires_at <= ?').bind(token, now).run()
}

async function handleMail(request: Request, db: D1Database, parts: string[], origin: string | null): Promise<Response> {
  // /api/mail/stats/size
  if (parts.length === 2 && parts[0] === 'stats' && parts[1] === 'size') {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM Mail WHERE expires_at > ?').bind(Date.now()).first<{ n: number }>()
    return json({ size: row?.n ?? 0 }, 200, origin)
  }
  const token = parts[0]
  if (!token || !TOKEN_RE.test(token)) return json({ error: 'invalid token' }, 400, origin)
  const now = Date.now()

  if (parts.length === 1 && request.method === 'GET') {
    await sweepToken(db, token, now)
    const { results } = await db
      .prepare('SELECT env FROM Mail WHERE token = ? AND expires_at > ? ORDER BY stored_at ASC')
      .bind(token, now)
      .all<{ env: string }>()
    const envelopes: MailEnvelope[] = []
    for (const row of results || []) {
      try {
        envelopes.push(JSON.parse(row.env) as MailEnvelope)
      } catch {
        /* unreadable row: ignore, TTL will collect it */
      }
    }
    return json({ envelopes }, 200, origin)
  }

  if (parts.length === 1 && request.method === 'PUT') {
    let body: { env?: MailEnvelope }
    try {
      body = (await request.json()) as { env?: MailEnvelope }
    } catch {
      return json({ error: 'invalid json' }, 400, origin)
    }
    const env = body.env
    if (!env || env.to !== token) return json({ error: 'envelope/token mismatch' }, 400, origin)
    if (!wellFormed(env)) return json({ error: 'malformed envelope' }, 400, origin)
    const expiresAt = Math.min(env.exp ?? now + MAIL_TTL_MS, now + MAIL_TTL_MS)
    await db
      .prepare('INSERT INTO Mail (token, id, env, stored_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, id) DO NOTHING')
      .bind(token, env.id, JSON.stringify(env), now, expiresAt)
      .run()
    // Cap the box: keep the newest MAIL_MAX_PER_TOKEN rows.
    await db
      .prepare(
        `DELETE FROM Mail WHERE token = ? AND id NOT IN (
           SELECT id FROM Mail WHERE token = ? ORDER BY stored_at DESC, rowid DESC LIMIT ${MAIL_MAX_PER_TOKEN}
         )`,
      )
      .bind(token, token)
      .run()
    return json({ ok: true }, 202, origin)
  }

  if (parts.length === 2 && parts[1] === 'ack' && request.method === 'POST') {
    let body: { ids?: string[]; pubkey?: string; sig?: string; epoch?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'invalid json' }, 400, origin)
    }
    if (!Array.isArray(body.ids) || typeof body.pubkey !== 'string' || typeof body.sig !== 'string') {
      return json({ error: 'ids, pubkey and sig are required' }, 400, origin)
    }
    if (body.ids.length === 0 || body.ids.length > MAIL_MAX_PER_TOKEN) return json({ error: 'ack rejected' }, 403, origin)
    if (!PUBKEY_RE.test(body.pubkey)) return json({ error: 'ack rejected' }, 403, origin)
    let derived = false
    try {
      derived = deliveryToken(body.pubkey) === token ||
        (typeof body.epoch === 'string' && /^[0-9a-f]{32}$/i.test(body.epoch) &&
          sessionDeliveryToken(body.pubkey, body.epoch) === token)
    } catch {
      derived = false
    }
    if (!derived) return json({ error: 'ack rejected' }, 403, origin)
    let sig: Uint8Array
    try {
      sig = hexToBytes(body.sig)
    } catch {
      return json({ error: 'ack rejected' }, 403, origin)
    }
    const message = new TextEncoder().encode(`${token}|${body.ids.join(',')}`)
    if (!verifySignature(sig, message, body.pubkey)) return json({ error: 'ack rejected' }, 403, origin)
    for (const id of body.ids) {
      if (!ID_RE.test(id)) continue
      try {
        await db.prepare('DELETE FROM Mail WHERE token = ? AND id = ?').bind(token, id).run()
      } catch {
        /* best-effort drain; TTL still applies */
      }
    }
    return json({ ok: true }, 200, origin)
  }

  return notFound(origin)
}

// ---- server directory (D1) -------------------------------------------------

const MAX_NAME = 60
const MAX_DESC = 200
const MAX_HINT = 120
const MAX_PER_OWNER = 5
const MAX_TAGS = 10
const MAX_TAG_LEN = 24
const STALE_SECONDS = 24 * 60 * 60

function parseServerTags(raw: unknown): string[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) throw new Error('tags must be an array')
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const tag = value.trim().toLowerCase()
    if (!new RegExp(`^[a-z0-9-]{1,${MAX_TAG_LEN}}$`).test(tag) || seen.has(tag)) continue
    seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

function storedTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function serverId(ownerPubHex: string, name: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${ownerPubHex}|${name}`)))
}

function validHint(hint: string): boolean {
  if (!hint) return true
  if (/^https?:\/\//i.test(hint)) {
    try {
      const url = new URL(hint)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }
  return /^[A-Za-z0-9._-]{1,120}(:\d{1,5})?$/.test(hint)
}

async function handleServers(request: Request, db: D1Database, parts: string[], origin: string | null): Promise<Response> {
  const path = parts.join('/')

  if (path === '' && request.method === 'GET') {
    const { auth, response } = await softAuth(request, origin)
    if (response) return response
    const viewer = auth?.orbitId ?? ''
    const stale = `-${STALE_SECONDS} seconds`
    const { results } = await db
      .prepare(
        `SELECT id, name, description, owner_id, password_required, endpoint_hint, user_count, online_count, is_private, tags, created_at, last_seen
         FROM ServerDirectory
         WHERE last_seen >= datetime('now', ?)
           AND COALESCE(hidden, 0) = 0 AND COALESCE(blocked, 0) = 0
           AND (COALESCE(is_private, 0) = 0 OR owner_id = ?)
         ORDER BY last_seen DESC LIMIT 100`,
      )
      .bind(stale, viewer)
      .all<Record<string, unknown>>()
    return json(
      {
        servers: (results || []).map((row) => {
          const out = { ...row, tags: storedTags(row.tags) }
          // Addresses go to signed-in callers only (anti-scraper).
          return auth ? out : { ...out, endpoint_hint: undefined }
        }),
      },
      200,
      origin,
    )
  }

  if (path === '' && request.method === 'POST') {
    const result = await verifyRequest(request, origin)
    if (!result.ok) return result.response
    const { orbitId, publicKeyHex } = result.auth
    let name = ''
    let description = ''
    let endpointHint = ''
    let passwordRequired = 0
    let userCount: number | null = null
    let onlineCount: number | null = null
    let ownerName = ''
    let tags: string[] = []
    let tagsProvided = false
    let priv: 0 | 1 | null = null
    try {
      const body = (await request.json()) as Record<string, unknown>
      if (typeof body?.name === 'string') name = body.name.trim().slice(0, MAX_NAME)
      if (typeof body?.description === 'string') description = body.description.trim().slice(0, MAX_DESC)
      if (typeof body?.endpoint_hint === 'string') endpointHint = body.endpoint_hint.trim().slice(0, MAX_HINT)
      if (body?.password_required === true) passwordRequired = 1
      const clamp = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1_000_000) : null
      userCount = clamp(body?.user_count)
      onlineCount = clamp(body?.online_count)
      if (typeof body?.owner_name === 'string') ownerName = body.owner_name.trim().slice(0, 40)
      if (body?.private === true) priv = 1
      if (body?.private === false) priv = 0
      try {
        const parsed = parseServerTags(body?.tags)
        if (parsed !== null) {
          tags = parsed
          tagsProvided = true
        }
      } catch {
        return json({ error: 'tags must be an array of slugs' }, 400, origin)
      }
    } catch {
      return json({ error: 'invalid json' }, 400, origin)
    }
    if (!name) return json({ error: 'name is required' }, 400, origin)
    if (!validHint(endpointHint)) return json({ error: 'endpoint_hint must be host:port or an http(s) origin' }, 400, origin)

    const id = serverId(publicKeyHex, name)
    const existing = await db
      .prepare('SELECT COUNT(*) AS n FROM ServerDirectory WHERE owner_id = ?')
      .bind(orbitId)
      .first<{ n: number }>()
    const mine = await db
      .prepare('SELECT id FROM ServerDirectory WHERE id = ? AND owner_id = ?')
      .bind(id, orbitId)
      .first<{ id: string }>()
    if (!mine && (existing?.n ?? 0) >= MAX_PER_OWNER) {
      return json({ error: `max ${MAX_PER_OWNER} servers per owner` }, 429, origin)
    }

    await db
      .prepare(
        `INSERT INTO ServerDirectory
           (id, name, description, owner_id, owner_pubkey, owner_name, endpoint_hint, password_required, user_count, online_count, tags, is_private, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           description = excluded.description,
           endpoint_hint = excluded.endpoint_hint,
           password_required = excluded.password_required,
           owner_name = COALESCE(excluded.owner_name, ServerDirectory.owner_name),
           user_count = COALESCE(excluded.user_count, ServerDirectory.user_count),
           online_count = COALESCE(excluded.online_count, ServerDirectory.online_count),
           tags = CASE WHEN ? = 1 THEN excluded.tags ELSE ServerDirectory.tags END,
           is_private = COALESCE(?, ServerDirectory.is_private),
           last_seen = datetime('now')`,
      )
      .bind(id, name, description, orbitId, publicKeyHex, ownerName || null, endpointHint, passwordRequired, userCount, onlineCount, JSON.stringify(tags), priv, tagsProvided ? 1 : 0, priv)
      .run()

    const row = await db
      .prepare('SELECT id, name, description, owner_id, owner_name, password_required, is_private, tags, created_at FROM ServerDirectory WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>()
    return json({ server: row ? { ...row, tags: storedTags(row.tags) } : row }, 201, origin)
  }

  // POST /api/servers/:id/ping
  if (parts.length === 2 && parts[1] === 'ping' && request.method === 'POST') {
    const result = await verifyRequest(request, origin)
    if (!result.ok) return result.response
    await db
      .prepare("UPDATE ServerDirectory SET last_seen = datetime('now') WHERE id = ? AND owner_id = ?")
      .bind(parts[0], result.auth.orbitId)
      .run()
    const still = await db
      .prepare('SELECT id FROM ServerDirectory WHERE id = ? AND owner_id = ?')
      .bind(parts[0], result.auth.orbitId)
      .first<{ id: string }>()
    if (!still) return json({ error: 'not registered' }, 404, origin)
    return json({ ok: true }, 200, origin)
  }

  // DELETE /api/servers/:id
  if (parts.length === 1 && request.method === 'DELETE') {
    const result = await verifyRequest(request, origin)
    if (!result.ok) return result.response
    const row = await db
      .prepare('SELECT owner_id FROM ServerDirectory WHERE id = ?')
      .bind(parts[0])
      .first<{ owner_id: string }>()
    if (!row) return json({ ok: true }, 200, origin)
    if (row.owner_id !== result.auth.orbitId) {
      return json({ error: 'only the owner can unregister' }, 403, origin)
    }
    await db.prepare('DELETE FROM ServerDirectory WHERE id = ?').bind(parts[0]).run()
    return json({ ok: true }, 200, origin)
  }

  // Node-local routes have no meaning on a courier.
  return notFound(origin)
}

// ---- entry point -----------------------------------------------------------

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)

  if (!env?.DB) return json({ error: 'courier storage is not configured' }, 503, origin)

  // Health: the client probes this to learn mode + services.
  if (parts.length === 1 && parts[0] === 'health') {
    return json(
      {
        ok: true,
        status: 'ok',
        mode: 'courier',
        services: ['mail', 'directory'],
        server: 'cloudflare-pages',
        time: new Date().toISOString(),
      },
      200,
      origin,
    )
  }

  // Identity: no transport key on a blind courier, so clients use the plain
  // signed path (apps/desktop/src/utils/api.ts honors sealed_available:false).
  if (parts.length === 1 && parts[0] === 'identity') {
    return json({ server_pubkey: null, sealed_available: false, sealed_required: false }, 200, origin)
  }

  if (parts[0] === 'mail') return handleMail(request, env.DB, parts.slice(1), origin)
  if (parts[0] === 'servers') return handleServers(request, env.DB, parts.slice(1), origin)

  // TURN is not provisioned on this deployment: the rendezvous is mail +
  // directory only. Returning 404 keeps the client on STUN/direct paths
  // instead of handing it credentials to a relay that does not exist.
  if (parts[0] === 'turn') return notFound(origin)

  return notFound(origin)
}
