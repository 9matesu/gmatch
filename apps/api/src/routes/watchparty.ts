import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { proxyAndStoreExternal, classifyAndResolve, isPrivateTarget } from '../proxy'
import { createParty, getParty, listParties, setPartyMedia } from '../watchparty'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const watchparty = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

const PARSE_ERROR = 'Could not find a playable video at that link.'
// Relay cap: bigger than the store cap, small enough that a party of 8
// streaming through one bun process stays sane.
const RELAY_MAX_BYTES = 500 * 1024 * 1024

// Auth per-route: the stream endpoint is hit by a raw <video> src that
// cannot carry X-Orbit-* headers. The party id (8 hex) is the capability —
// it only ever travels inside the authenticated party WS room.
watchparty.post('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : ''
  if (!url || url.length > 2048) return c.json({ error: PARSE_ERROR }, 422)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return c.json({ error: PARSE_ERROR }, 422)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return c.json({ error: PARSE_ERROR }, 422)

  // First choice: pull bytes ONCE into our own encrypted storage (SSRF guard
  // + magic-byte validation inside proxyAndStoreExternal); peers then
  // Range-stream the private Object via the isPartyMediaObject door.
  const objectId = crypto.randomUUID()
  const proxied = await proxyAndStoreExternal(url, c.env.BUCKET, 'objects', objectId)
  if (proxied?.isVideo) {
    await c.env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_proxied, proxied_mime) VALUES (?, ?, ?, ?, ?, 0, 1, ?)'
    ).bind(objectId, orbitId, proxied.bytesStored, proxied.mimeType, proxied.storedUrl, proxied.proxiedMime).run()
    const mediaUrl = `/api/objects/${objectId}`
    const party = createParty(name || 'Party', mediaUrl, mediaUrl)
    return c.json({ party: { id: party.id, name: party.name, url: mediaUrl } }, 201)
  }

  // Fallback for videos above the store cap (pmvhaven ships 80MB+ mp4s):
  // resolve the direct URL and bind a relay to the party. The hub then only
  // ever proxies THIS upstream for THIS party — not an open proxy.
  const resolved = await classifyAndResolve(url)
  if (!resolved) return c.json({ error: PARSE_ERROR }, 422)
  let up: URL
  try {
    up = new URL(resolved)
  } catch {
    return c.json({ error: PARSE_ERROR }, 422)
  }
  if (await isPrivateTarget(up)) return c.json({ error: PARSE_ERROR }, 422)
  try {
    const probe = await fetch(up.toString(), { method: 'GET', headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0', Referer: `${parsed.protocol}//${parsed.host}/` }, signal: AbortSignal.timeout(8000) })
    const ct = probe.headers.get('content-type') || ''
    const len = Number(probe.headers.get('content-length') || (probe.headers.get('content-range') || '').split('/')[1] || 0)
    if (!probe.ok && probe.status !== 206) return c.json({ error: PARSE_ERROR }, 422)
    if (!ct.startsWith('video/')) return c.json({ error: PARSE_ERROR }, 422)
    if (len > RELAY_MAX_BYTES) return c.json({ error: PARSE_ERROR }, 422)
  } catch {
    return c.json({ error: PARSE_ERROR }, 422)
  }

  const party = createParty(name || 'Party', '', '', { upstream: up.toString(), referer: `${parsed.protocol}//${parsed.host}/` })
  setPartyMedia(party, `/api/watchparty/${party.id}/stream`)
  return c.json({ party: { id: party.id, name: party.name, url: party.mediaUrl } }, 201)
})

watchparty.get('/', orbitAuth, async (c) => {
  return c.json({ parties: listParties() })
})

watchparty.get('/:id', orbitAuth, async (c) => {
  const party = getParty(c.req.param('id') || '')
  if (!party) return c.json({ error: 'Party not found' }, 404)
  return c.json({
    id: party.id,
    name: party.name,
    url: party.mediaUrl,
    frame: party.frame,
    members: [...party.members.entries()].map(([id, name]) => ({ id, name })),
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
