/**
 * gmatch rendezvous — a free, blind meeting point for sealed mail, signed
 * presence/social-op envelopes and the public server directory.
 *
 * It holds ONLY opaque base64 bytes and bounded, self-declared metadata: no
 * message bodies, no media, no profiles. The wire is the SAME one the node's
 * courier speaks (utils/mail-client.ts): PUT/GET/DELETE /api/mail/:token and
 * GET/POST /api/servers.
 *
 * Storage is ONE Durable Object (free tier, SQLite-backed) — NOT Cloudflare
 * KV, whose free write/list budget a 60s presence heartbeat exhausts. All
 * tokens share the single DO; it keeps bounded in-memory maps and persists the
 * whole state on each mutation. There is deliberately NO WebSocket: MailClient
 * already falls back to 20s polling, and the free DO stays HTTP-only.
 */

import { DurableObject } from 'cloudflare:workers'

type Env = { RENDEZVOUS_DO: DurableObjectNamespace }

const TOKEN_RE = /^[0-9a-f]{32,64}$/i
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const HEX64_RE = /^[0-9a-f]{64}$/i
const SLUG_RE = /^[a-z0-9-]{1,24}$/

const MAIL_TTL_S = 120
const SERVER_TTL_S = 24 * 60 * 60
const MAX_SEALED = 64 * 1024
const MAX_MAIL_PER_TOKEN = 256
const MAX_SERVERS = 100

type MailEnvelope = {
  v: 2
  kind: string
  to: string
  id: string
  sealed: string
  fromEph?: string
  exp?: number
}

type ServerRow = {
  id: string
  name: string
  description: string
  owner_id: string
  password_required: 0 | 1
  endpoint_hint: string
  user_count: number | null
  online_count: number | null
  is_private: 0 | 1
  tags: string[]
  created_at: string
  last_seen: string
}

type StoredMail = { env: MailEnvelope; storedAt: number }
type Persisted = {
  mail: Record<string, StoredMail[]>
  servers: Record<string, ServerRow & { storedAt: number }>
}

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  })
}

/** SHAPE only. The sealed bytes are never opened or interpreted. */
function validEnvelope(raw: unknown, token: string): raw is MailEnvelope {
  if (!raw || typeof raw !== 'object') return false
  const e = raw as Record<string, unknown>
  return e.v === 2 &&
    typeof e.kind === 'string' && e.kind.length > 0 && e.kind.length <= 16 &&
    typeof e.to === 'string' && e.to === token && TOKEN_RE.test(e.to) &&
    typeof e.id === 'string' && ID_RE.test(e.id) &&
    typeof e.sealed === 'string' && e.sealed.length > 0 && e.sealed.length <= MAX_SEALED &&
    (e.fromEph === undefined || (typeof e.fromEph === 'string' && HEX64_RE.test(e.fromEph))) &&
    (e.exp === undefined || (typeof e.exp === 'number' && Number.isFinite(e.exp) && e.exp > 0))
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json()
    return v && typeof v === 'object' ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

function mailKey(token: string, id: string): string {
  return `${token}:${id}`
}

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

function clampCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1_000_000) : null
}

function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().toLowerCase()
    if (!SLUG_RE.test(tag) || seen.has(tag)) continue
    seen.add(tag)
    if (seen.size >= 10) break
  }
  return [...seen]
}

async function hexId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class RendezvousDO extends DurableObject<Env> {
  private mail = new Map<string, StoredMail[]>()
  private servers = new Map<string, ServerRow & { storedAt: number }>()
  private loaded = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<Persisted>('state')
      if (saved) {
        for (const [token, rows] of Object.entries(saved.mail || {})) this.mail.set(token, rows)
        for (const [id, row] of Object.entries(saved.servers || {})) this.servers.set(id, row)
      }
      this.loaded = true
    })
  }

  private async persist(): Promise<void> {
    const data: Persisted = { mail: {}, servers: {} }
    for (const [token, rows] of this.mail) data.mail[token] = rows
    for (const [id, row] of this.servers) data.servers[id] = row
    await this.ctx.storage.put('state', data)
  }

  private purgeExpired(now: number): void {
    for (const [token, rows] of this.mail) {
      const live = rows.filter((r) => (r.env.exp ?? r.storedAt + MAIL_TTL_S * 1000) > now)
      if (live.length) this.mail.set(token, live)
      else this.mail.delete(token)
    }
    for (const [id, row] of this.servers) {
      if (row.storedAt + SERVER_TTL_S * 1000 <= now) this.servers.delete(id)
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.loaded) await this.ctx.blockConcurrencyWhile(async () => {})
    const now = Date.now()
    this.purgeExpired(now)
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/mail/ws') return reply({ error: 'no mailbox socket; MailClient polls every 20s' }, 501)

    const ack = path.match(/^\/api\/mail\/([^/]+)\/ack$/)
    if (ack && request.method === 'POST') {
      const token = ack[1]
      if (!TOKEN_RE.test(token)) return reply({ error: 'invalid token' }, 400)
      const body = await readJson(request)
      if (!body || !Array.isArray(body.ids) || !body.ids.every((id) => typeof id === 'string')) {
        return reply({ error: 'ids must be an array' }, 400)
      }
      const ids = new Set(body.ids as string[])
      const rows = this.mail.get(token) || []
      const kept = rows.filter((r) => !ids.has(r.env.id))
      this.mail.set(token, kept)
      await this.persist()
      return reply({ ok: true, deleted: rows.length - kept.length }, 200)
    }

    const box = path.match(/^\/api\/mail\/([^/]+)$/)
    if (box) {
      const token = box[1]
      if (!TOKEN_RE.test(token)) return reply({ error: 'invalid token' }, 400)
      if (request.method === 'PUT') {
        const body = await readJson(request)
        const e = body?.env
        if (!validEnvelope(e, token)) return reply({ error: 'malformed envelope' }, 400)
        const rows = this.mail.get(token) || []
        const next = rows.filter((r) => r.env.id !== e.id)
        next.push({ env: e, storedAt: now })
        this.mail.set(token, next.slice(-MAX_MAIL_PER_TOKEN))
        await this.persist()
        return reply({ ok: true }, 202)
      }
      if (request.method === 'GET') {
        const rows = this.mail.get(token) || []
        return reply({ envelopes: rows.map((r) => r.env) }, 200)
      }
      if (request.method === 'DELETE') {
        const body = request.body ? await readJson(request) : null
        const ids = Array.isArray(body?.ids) && body.ids.every((id) => typeof id === 'string')
          ? body.ids as string[]
          : undefined
        const rows = this.mail.get(token) || []
        const kept = ids ? rows.filter((r) => !ids.includes(r.env.id)) : []
        this.mail.set(token, kept)
        await this.persist()
        return reply({ ok: true, deleted: rows.length - kept.length }, 200)
      }
      return reply({ error: 'method not allowed' }, 405)
    }

    if (path === '/api/servers') {
      if (request.method === 'GET') {
        const rows = [...this.servers.values()].slice(-MAX_SERVERS)
        return reply({ servers: rows.map(({ storedAt: _storedAt, ...row }) => row) }, 200)
      }
      if (request.method === 'POST') {
        const body = await readJson(request)
        if (!body) return reply({ error: 'invalid json' }, 400)
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
        if (!name) return reply({ error: 'name is required' }, 400)
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : ''
        const endpointHint = typeof body.endpoint_hint === 'string' ? body.endpoint_hint.trim().slice(0, 120) : ''
        if (!validHint(endpointHint)) return reply({ error: 'invalid endpoint_hint' }, 400)
        // owner_name, owner_id, pubkey and every signature header are ignored:
        // this is a blind bulletin board, never an identity authority.
        const row: ServerRow = {
          id: await hexId(`${name}|${endpointHint}`),
          name,
          description,
          owner_id: '',
          password_required: body.password_required === true ? 1 : 0,
          endpoint_hint: endpointHint,
          user_count: clampCount(body.user_count),
          online_count: clampCount(body.online_count),
          is_private: body.private === true ? 1 : 0,
          tags: parseTags(body.tags),
          created_at: new Date(now).toISOString(),
          last_seen: new Date(now).toISOString(),
        }
        this.servers.set(row.id, { ...row, storedAt: now })
        if (this.servers.size > MAX_SERVERS) {
          const oldest = [...this.servers.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0]
          if (oldest) this.servers.delete(oldest[0])
        }
        await this.persist()
        return reply({ server: row }, 201)
      }
      return reply({ error: 'method not allowed' }, 405)
    }

    return reply({ error: 'not found' }, 404)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
          'Access-Control-Max-Age': '86400',
        },
      })
    }
    const id = env.RENDEZVOUS_DO.idFromName('global')
    const stub = env.RENDEZVOUS_DO.get(id)
    return stub.fetch(request)
  },
}