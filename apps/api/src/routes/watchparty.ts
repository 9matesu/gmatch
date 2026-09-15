import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { proxyAndStoreExternal, classifyAndResolve, isPrivateTarget } from '../proxy'
import { broadcastToRoom } from '../ws-bus'
import { createParty, getParty, listParties, setPartyMedia, queueOps, type Party } from '../watchparty'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const watchparty = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

const PARSE_ERROR = 'Could not find a playable video at that link.'
// Relay cap: bigger than the store cap, small enough that a party of 8
// streaming through one bun process stays sane.
const RELAY_MAX_BYTES = 500 * 1024 * 1024

/**
 * The one media pipeline: try store-first (private Object, Range-streamed via
 * the isPartyMediaObject door), fall back to a party-bound relay for files
 * above the 50MB store cap. Returns the playable URL (+ relay binding) or
 * null when nothing playable was found.
 */
async function resolveMedia(env: Bindings, orbitId: string, rawUrl: string): Promise<{ url: string; relay?: { upstream: string; referer: string }; stored?: boolean } | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || rawUrl.length > 2048) return null

  const objectId = crypto.randomUUID()
  const proxied = await proxyAndStoreExternal(rawUrl, env.BUCKET, 'objects', objectId)
  if (proxied?.isVideo) {
    // Audit A4: watch media is ephemeral (rooms die at 4h idle). Without an
    // expiry the encrypted Object + blob stayed forever, contradicting the
    // "nothing persists" promise. 24h covers any real overnight run; past
    // that the room is gone anyway and the user re-adds.
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_proxied, proxied_mime, expires_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, datetime('now', '+1 day'))"
    ).bind(objectId, orbitId, proxied.bytesStored, proxied.mimeType, proxied.storedUrl, proxied.proxiedMime).run()
    return { url: `/api/objects/${objectId}`, stored: true }
  }

  // Too big to store (pmvhaven ships 80MB+ mp4s): resolve + probe, the party
  // binds THIS upstream and streams it through /stream. Not an open proxy:
  // the URL can only enter via this authenticated create path.
  const resolved = await classifyAndResolve(rawUrl)
  if (!resolved) return null
  let up: URL
  try {
    up = new URL(resolved)
  } catch {
    return null
  }
  if (await isPrivateTarget(up)) return null
  try {
    const probe = await fetch(up.toString(), { method: 'GET', headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0', Referer: `${parsed.protocol}//${parsed.host}/` }, signal: AbortSignal.timeout(8000) })
    const ct = probe.headers.get('content-type') || ''
    const len = Number(probe.headers.get('content-length') || (probe.headers.get('content-range') || '').split('/')[1] || 0)
    if (!probe.ok && probe.status !== 206) return null
    if (!ct.startsWith('video/')) return null
    if (len > RELAY_MAX_BYTES) return null
  } catch {
    return null
  }
  return { url: '', relay: { upstream: up.toString(), referer: `${parsed.protocol}//${parsed.host}/` } }
}

// Audit A5: each resolveMedia costs an upstream fetch + up to 50MB of R2
// storage. Per-user sliding budget: 30 parsed URLs/minute across create +
// video routes (a human pastes a 10-line playlist once, not twice a minute).
const parseBudget = new Map<string, { ts: number[] }>()
function takeParseBudget(userId: string, n: number): boolean {
  const now = Date.now()
  const rec = parseBudget.get(userId) || { ts: [] }
  rec.ts = rec.ts.filter((t) => now - t < 60_000)
  if (rec.ts.length + n > 30) {
    parseBudget.set(userId, rec)
    return false
  }
  for (let i = 0; i < n; i++) rec.ts.push(now)
  parseBudget.set(userId, rec)
  return true
}
// ponytail: in-memory bucket dies with the isolate; fine for a 50-room app.

watchparty.post('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  if (!takeParseBudget(orbitId, 1)) return c.json({ error: 'Too many video parses. Wait a minute.' }, 429)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : ''
  if (!url) return c.json({ error: PARSE_ERROR }, 422)

  const media = await resolveMedia(c.env, orbitId, url)
  if (!media) return c.json({ error: PARSE_ERROR }, 422)

  const party = createParty(name || 'Party', media.url, media.url, media.relay, orbitId)
  if (media.relay) {
    setPartyMedia(party, `/api/watchparty/${party.id}/stream`)
    party.queue.push({ id: crypto.randomUUID().slice(0, 8), name: party.name, url: party.mediaUrl, relay: media.relay })
    party.current = party.queue[0].id
  }
  return c.json({ party: { id: party.id, name: party.name, url: party.mediaUrl } }, 201)
})

watchparty.get('/', orbitAuth, async (c) => {
  return c.json({ parties: listParties() })
})

/** Member check for the video endpoints mirrors the WS gates (the WS path
 * itself re-validates per frame; this route needs it because queueOps'
 * membership check reads party.members). */
function memberParty(c: { get: (k: string) => string }, id: string): { party: Party | null; orbitId: string } {
  const orbitId = c.get('orbitId')
  return { party: getParty(id), orbitId }
}

// Queue add / video change over HTTP (runs the media pipeline, then relays
// the queue frame to the room exactly like the WS ops would).
watchparty.post('/:id/video', orbitAuth, async (c) => {
  const { party, orbitId } = memberParty(c, c.req.param('id') || '')
  if (!party || !party.members.has(orbitId)) return c.json({ error: 'Party not found' }, 404)
  if (party.lockVideo && party.hostId !== orbitId) return c.json({ error: 'Only the host can load videos in this room.' }, 403)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const title = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
  const queueOnly = body?.queueOnly === true

  // Bulk shape: urls[] (1..10) or the legacy single url.
  const urlList: string[] = Array.isArray(body?.urls)
    ? body.urls.map((u: unknown) => String(u).trim()).filter(Boolean).slice(0, 11)
    : (url ? [url] : [])
  if (urlList.length > 10) return c.json({ error: 'Add up to 10 videos at a time.' }, 400)
  if (urlList.length === 0) return c.json({ error: PARSE_ERROR }, 422)
  if (!takeParseBudget(orbitId, urlList.length)) return c.json({ error: 'Too many video parses. Wait a minute.' }, 429)

  const added: Array<{ id: string; name: string; url: string }> = []
  const failed: string[] = []
  // Sequential on purpose: one burst of upstream fetches per click trips
  // more hotlink WAFs than a short queue of requests.
  for (const u of urlList) {
    const media = await resolveMedia(c.env, orbitId, u)
    if (!media) { failed.push(u); continue }
    let entryUrl = media.url
    if (media.relay && !entryUrl) entryUrl = `/api/watchparty/${party.id}/stream`
    const add = queueOps(orbitId, { party: party.id, op: 'add', name: title, url: entryUrl, relay: media.relay })
    if (!add) { failed.push(u); continue }
    added.push({ ...party.queue[party.queue.length - 1] })
  }
  if (added.length === 0) return c.json({ error: PARSE_ERROR, failed }, 422)
  if (!queueOnly) {
    queueOps(orbitId, { party: party.id, op: 'play', id: added[0].id })
  }
  const payload = {
    type: 'watch.queue',
    party: party.id,
    queue: party.queue,
    current: party.current,
    frame: party.frame,
  }
  broadcastToRoom(`watch:${party.id}`, payload)
  return c.json({ ok: true, added, failed })
})

watchparty.get('/:id', orbitAuth, async (c) => {
  const party = getParty(c.req.param('id') || '')
  if (!party) return c.json({ error: 'Party not found' }, 404)
  return c.json({
    id: party.id,
    name: party.name,
    url: party.mediaUrl,
    frame: party.frame,
    host: party.hostId,
    isPrivate: party.isPrivate,
    lockVideo: party.lockVideo,
    mediaName: party.mediaName,
    queue: party.queue,
    current: party.current,
    chat: party.chat,
    members: [...party.members.entries()].map(([id, m]) => ({ id, name: m.name, muted: m.muted })),
  })
})

// Range-passthrough relay for bound (too-big-to-store) party videos.
watchparty.get('/:id/stream', async (c) => {
  const party = getParty(c.req.param('id') || '')
  if (!party?.relay) return c.json({ error: 'Party not found' }, 404)
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Referer: party.relay.referer }
  const range = c.req.header('Range')
  if (range && /^bytes=[\d-]+$/.test(range)) headers.Range = range
  let up: Response
  try {
    up = await fetch(party.relay.upstream, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) })
  } catch {
    return c.json({ error: 'Upstream unreachable' }, 502)
  }
  if (!up.ok) return c.json({ error: 'Upstream refused' }, 502)
  const out = new Headers()
  const ct = up.headers.get('content-type')
  if (ct) out.set('Content-Type', ct)
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h)
    if (v) out.set(h, v)
  }
  out.set('Cache-Control', 'private, no-store')
  out.set('Access-Control-Allow-Origin', '*')
  return new Response(up.body, { status: up.status, headers: out })
})
