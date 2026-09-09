import { Hono } from 'hono'
import { createMailStore, type MailStore, type MailEnvelope } from '../mail-store'
import { TOKEN_RE } from '../mail-store'

/**
 * Blind courier — mail routes (plan Phase 2.1).
 *
 * The server forwards ADDRESSES ONLY:
 *  - PUT  /api/mail/:token  {env}   store an opaque envelope for a token
 *  - GET  /api/mail/:token          list pending envelopes (public token)
 *  - POST /api/mail/:token/ack      {ids,pubkey,sig} drain what you proved
 *  - GET  /api/mail/stats           store size (ops)
 *
 * No auth, no identity, no presence: connections never declare who they are,
 * tokens are blake3(pubkey) (public material, unlinkable to orbitId), and
 * sealed bytes are stored verbatim. Push delivery rides the WS upgrade
 * (serve.ts) via the watcher registry below — a watcher subscribes to a
 * token; the courier still cannot tell WHO the watcher is, only that some
 * socket listens for an opaque 64-hex label.
 */

type Bindings = { DB?: unknown; BUCKET?: unknown }

export const mail = new Hono<{ Bindings: Bindings }>()

export const mailStore: MailStore = createMailStore({
  defaultTtlMs: Number(process.env.MAIL_TTL_MS || 7 * 24 * 3600_000),
  maxPerToken: Number(process.env.MAIL_MAX_PER_TOKEN || 256),
  maxTotal: Number(process.env.MAIL_MAX_TOTAL || 50_000),
})

// ---- WS push watchers (token -> sockets listening; identity-agnostic) ----
type Watcher = { send: (data: string) => boolean }
const watchers = new Map<string, Set<Watcher>>()

/** Bun-server sockets that upgraded via /api/mail/ws -> watched tokens. */
export const mailWatchers = new Map<any, Set<string>>()

const TOKEN_WATCH_LIMIT = 64

/**
 * Frames on the anonymous push channel:
 *  {type:'watch', tokens:[...]}   -> start pushing 'mail' notices for tokens
 *  {type:'unwatch', tokens:[...]} -> stop
 *  {type:'pull', token}           -> full envelopes for a token (same as GET)
 * The socket is never asked who it is; it only names opaque tokens.
 */
export function handleMailSocketMessage(ws: any, raw: string): void {
  let msg: { type?: string; tokens?: unknown; token?: unknown }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  const watched = mailWatchers.get(ws)
  if (!watched) return
  if (msg.type === 'watch' && Array.isArray(msg.tokens)) {
    for (const t of msg.tokens) {
      if (typeof t === 'string' && TOKEN_RE.test(t) && watched.size < TOKEN_WATCH_LIMIT) {
        watched.add(t)
        let set = watchers.get(t)
        if (!set) {
          set = new Set()
          watchers.set(t, set)
        }
        set.add(wsWatcher(ws))
      }
    }
    ws.send(JSON.stringify({ type: 'watch_ack', count: watched.size }))
  } else if (msg.type === 'unwatch' && Array.isArray(msg.tokens)) {
    for (const t of msg.tokens) {
      if (typeof t !== 'string') continue
      watched.delete(t)
      watchers.get(t)?.delete(wsWatcher(ws))
      if (watchers.get(t)?.size === 0) watchers.delete(t)
    }
  } else if (msg.type === 'pull' && typeof msg.token === 'string' && TOKEN_RE.test(msg.token)) {
    ws.send(JSON.stringify({ type: 'mail_list', to: msg.token, envelopes: mailStore.list(msg.token, Date.now()) }))
  }
}

// One adapter per socket (WeakMap keeps identity stable for set ops).
const watcherAdapters = new WeakMap<object, Watcher>()
function wsWatcher(ws: { send: (d: string) => void }): Watcher {
  let w = watcherAdapters.get(ws)
  if (!w) {
    w = {
      send: (data: string) => {
        try {
          ws.send(data)
          return true
        } catch {
          return false
        }
      },
    }
    watcherAdapters.set(ws, w)
  }
  return w
}

/** Drop a closed socket from every token watch list (no leaks). */
export function unwatchMailSocket(ws: any): void {
  const watched = mailWatchers.get(ws)
  if (watched) {
    const w = watcherAdapters.get(ws)
    for (const t of watched) {
      const set = watchers.get(t)
      if (set && w) set.delete(w)
      if (set && set.size === 0) watchers.delete(t)
    }
    mailWatchers.delete(ws)
  }
  watcherAdapters.delete(ws)
}

export function watchToken(token: string, conn: Watcher): () => void {
  if (!TOKEN_RE.test(token)) return () => {}
  let set = watchers.get(token)
  if (!set) {
    set = new Set()
    watchers.set(token, set)
  }
  set.add(conn)
  return () => {
    set!.delete(conn)
    if (set!.size === 0) watchers.delete(token)
  }
}

export function unwatchAll(conn: Watcher): void {
  for (const [token, set] of watchers) {
    set.delete(conn)
    if (set.size === 0) watchers.delete(token)
  }
}

function notify(token: string, env: MailEnvelope): void {
  const set = watchers.get(token)
  if (!set) return
  const frame = JSON.stringify({ type: 'mail', to: token, id: env.id })
  for (const w of set) w.send(frame)
}

// ---- routes ----

mail.put('/:token', async (c) => {
  const token = c.req.param('token')
  if (!TOKEN_RE.test(token)) return c.json({ error: 'invalid token' }, 400)
  let body: { env?: MailEnvelope }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const env = body.env
  if (!env || env.to !== token) return c.json({ error: 'envelope/token mismatch' }, 400)
  const ok = mailStore.put(env, Date.now())
  if (!ok) return c.json({ error: 'malformed envelope' }, 400)
  notify(token, env)
  return c.json({ ok: true }, 202)
})

mail.get('/:token', (c) => {
  const token = c.req.param('token')
  if (!TOKEN_RE.test(token)) return c.json({ error: 'invalid token' }, 400)
  return c.json({ envelopes: mailStore.list(token, Date.now()) })
})

mail.post('/:token/ack', async (c) => {
  const token = c.req.param('token')
  if (!TOKEN_RE.test(token)) return c.json({ error: 'invalid token' }, 400)
  let body: { ids?: string[]; pubkey?: string; sig?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (!Array.isArray(body.ids) || typeof body.pubkey !== 'string' || typeof body.sig !== 'string') {
    return c.json({ error: 'ids, pubkey and sig are required' }, 400)
  }
  const ok = mailStore.ack({ token, ids: body.ids, pubkey: body.pubkey, sig: body.sig })
  if (!ok) return c.json({ error: 'ack rejected' }, 403)
  return c.json({ ok: true })
})

mail.get('/stats/size', (c) => c.json({ size: mailStore.size() }))

// Periodic GC of expired mail (the courier forgets on its own).
setInterval(() => {
  try {
    mailStore.sweep(Date.now())
  } catch {
    /* sweep is best-effort */
  }
}, 60_000).unref?.()
