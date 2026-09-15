import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { proxyAndStoreExternal } from '../proxy'
import { createParty, getParty } from '../watchparty'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const watchparty = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
watchparty.use('*', orbitAuth)

const PARSE_ERROR = 'Could not find a playable video at that link.'

watchparty.post('/', async (c) => {
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

  let mediaUrl: string
  {
    // External http(s) only: a party URL becomes OUR proxied public copy,
    // so we never silently flip a user's private object to public. To watch
    // a local file, post it first and use a public link.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return c.json({ error: PARSE_ERROR }, 422)
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return c.json({ error: PARSE_ERROR }, 422)
    // Pull bytes ONCE into our own storage (SSRF guard + magic-byte validation
    // inside proxyAndStoreExternal); peers then Range-stream from the hub.
    const objectId = crypto.randomUUID()
    const proxied = await proxyAndStoreExternal(url, c.env.BUCKET, 'objects', objectId)
    if (!proxied || !proxied.isVideo) {
      return c.json({ error: PARSE_ERROR }, 422)
    }
    // NOT feed-public: party members stream it via the objects-route
    // capability check (isPartyMediaObject), everyone else 404s.
    await c.env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_proxied, proxied_mime) VALUES (?, ?, ?, ?, ?, 0, 1, ?)'
    ).bind(objectId, orbitId, proxied.bytesStored, proxied.mimeType, proxied.storedUrl, proxied.proxiedMime).run()
    mediaUrl = `/api/objects/${objectId}`
  }

  const party = createParty(name || 'Party', mediaUrl, mediaUrl)
  return c.json({ party: { id: party.id, name: party.name, url: mediaUrl } }, 201)
})

watchparty.get('/:id', async (c) => {
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
