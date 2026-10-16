import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { proxyAndStoreExternal, classifyAndResolve, isPrivateTarget, pageTitleFor } from '../proxy'
import { broadcastToRoom } from '../ws-bus'
import { createParty, getParty, listParties, setPartyMedia, queueOps, mintInvite, revokeInvite, redeemInvite, type Party } from '../watchparty'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const watchparty = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

const PARSE_ERROR = 'Could not find a playable video at that link.'
// pmvhaven playlist (alpha): /playlists/<24hex> expands to its video pages,
// in playlist order, capped at the parse budget. The authless
// /api/playlists/<id> carries data.videos; the site's watched-video-ids
// endpoint needs an API key we don't ask for.
const PLAYLIST_MAX = 50

export interface PlaylistItem {
  url: string
  title?: string
  playlistTitle?: string
}

export async function expandPmvhavenPlaylists(urlList: string[]): Promise<PlaylistItem[]> {
  const out: PlaylistItem[] = []
  for (const u of urlList) {
    const m = u.match(/(?:https?:\/\/)?(?:www\.)?pmvhaven\.com\/playlists?\/([0-9a-fA-F]{24}|[a-zA-Z0-9_-]{12,32})/i)
    if (!m) { out.push({ url: u }); continue }
    let items: PlaylistItem[] = []
    try {
      const res = await fetch(`https://pmvhaven.com/api/playlists/${m[1]}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const j: any = await res.json().catch(() => null)
        const playlistName = typeof j?.data?.name === 'string' ? j.data.name.trim().slice(0, 60) : undefined
        const vids = Array.isArray(j?.data?.videos) ? j.data.videos : []
        items = vids
          .map((v: unknown) => {
            if (typeof v === 'string') {
              return /^[0-9a-f]{24}$/.test(v) ? { url: `https://pmvhaven.com/video/${v}`, playlistTitle: playlistName } : null
            }
            const id = String((v as any)?._id || (v as any)?.id || '')
            const rawTitle = typeof (v as any)?.title === 'string' ? (v as any).title : (typeof (v as any)?.name === 'string' ? (v as any).name : '')
            const title = rawTitle ? rawTitle.trim().slice(0, 60) : undefined
            return /^[0-9a-f]{24}$/.test(id) ? { url: `https://pmvhaven.com/video/${id}`, title, playlistTitle: playlistName } : null
          })
          .filter((it: PlaylistItem | null): it is PlaylistItem => Boolean(it))
          .slice(0, PLAYLIST_MAX)
      }
    } catch { /* fall through: keep raw url */ }
    if (items.length === 0) out.push({ url: u })
    else for (const it of items) out.push(it)
  }
  return out
}
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

  // pmvhaven videos are known large mp4s (>80MB) that exceed the 50MB store cap.
  // Avoid attempting a 50MB buffer download that will be discarded.
  const isPmvVideo = /pmvhaven\.com\/video\//i.test(rawUrl)
  if (!isPmvVideo && env.BUCKET) {
    const objectId = crypto.randomUUID()
    const proxied = await proxyAndStoreExternal(rawUrl, env.BUCKET, 'objects', objectId)
    if (proxied?.isVideo) {
      await env.DB.prepare(
        "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_proxied, proxied_mime, expires_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, datetime('now', '+1 day'))"
      ).bind(objectId, orbitId, proxied.bytesStored, proxied.mimeType, proxied.storedUrl, proxied.proxiedMime).run()
      return { url: `/api/objects/${objectId}`, stored: true }
    }
  }

  // Resolve direct upstream media URL
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
    const probe = await fetch(up.toString(), {
      method: 'GET',
      headers: { Range: 'bytes=0-1', 'User-Agent': 'Mozilla/5.0', Referer: `${parsed.protocol}//${parsed.host}/` },
      signal: AbortSignal.timeout(8000),
    })
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
// storage. Per-user sliding budget: 60 parsed URLs/minute across create +
// video routes (raised to 60 so one full pmvhaven playlist — capped at the
// 50-entry queue max — imports in a single add; a human doesn't do that
// twice a minute).
const PARSE_BUDGET_PER_MIN = 60
const parseBudget = new Map<string, { ts: number[] }>()
function takeParseBudget(userId: string, n: number): boolean {
  const now = Date.now()
  const rec = parseBudget.get(userId) || { ts: [] }
  rec.ts = rec.ts.filter((t) => now - t < 60_000)
  if (rec.ts.length + n > PARSE_BUDGET_PER_MIN) {
    parseBudget.set(userId, rec)
    return false
  }
  for (let i = 0; i < n; i++) rec.ts.push(now)
  parseBudget.set(userId, rec)
  return true
}
// ponytail: in-memory bucket dies with the isolate; fine for a 50-room app.

function fallbackNameFromUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const base = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    return decodeURIComponent(base.replace(/\.(mp4|webm|m4v|mov)$/i, '').replace(/[-_]+/g, ' ')).trim().slice(0, 60)
  } catch {
    return ''
  }
}

watchparty.post('/expand', orbitAuth, async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const raw = typeof body?.url === 'string' ? body.url.trim() : ''
  const urls: string[] = Array.isArray(body?.urls)
    ? body.urls.map((u: unknown) => String(u).trim()).filter(Boolean)
    : (raw ? raw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean) : [])
  if (urls.length === 0) return c.json({ error: 'No URL provided' }, 400)

  const expanded = await expandPmvhavenPlaylists(urls)
  const isPlaylist = expanded.length > 1 || Boolean(expanded[0]?.playlistTitle)
  const playlistTitle = expanded.find((e) => e.playlistTitle)?.playlistTitle

  return c.json({
    ok: true,
    isPlaylist,
    count: expanded.length,
    playlistTitle,
    items: expanded.map((it) => ({ url: it.url, title: it.title, playlistTitle: it.playlistTitle })),
  })
})

watchparty.post('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  if (!takeParseBudget(orbitId, 1)) return c.json({ error: 'Too many video parses. Wait a minute.' }, 429)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : ''
  if (!rawUrl) return c.json({ error: PARSE_ERROR }, 422)

  // Expand playlist if rawUrl contains a playlist link or multiple lines
  const lines = rawUrl.split(/\n+/).map((l: string) => l.trim()).filter(Boolean)
  const expanded = await expandPmvhavenPlaylists(lines)

  // Find 1st valid video to launch the party
  let firstMedia = null
  let firstItem: PlaylistItem | null = null
  let firstIndex = -1

  for (let i = 0; i < expanded.length; i++) {
    const it = expanded[i]
    const media = await resolveMedia(c.env, orbitId, it.url)
    if (media) {
      firstMedia = media
      firstItem = it
      firstIndex = i
      break
    }
  }

  if (!firstMedia || !firstItem) return c.json({ error: PARSE_ERROR }, 422)

  const firstTitle = (firstItem.title || pageTitleFor(firstItem.url) || fallbackNameFromUrl(firstItem.url)).slice(0, 60)
  const party = createParty(name || firstTitle || 'Party', firstMedia.url, firstMedia.url, firstMedia.relay, orbitId)
  party.mediaName = firstTitle || name

  const firstEntryId = crypto.randomUUID().slice(0, 8)
  let firstEntryUrl = firstMedia.url
  if (firstMedia.relay && !firstEntryUrl) {
    firstEntryUrl = `/api/watchparty/${party.id}/stream?item=${firstEntryId}`
  }
  setPartyMedia(party, firstEntryUrl)
  party.queue.push({ id: firstEntryId, name: party.mediaName, url: firstEntryUrl, relay: firstMedia.relay })
  party.current = firstEntryId

  // Progressively enqueue remaining items in the background if any
  const remaining = expanded.slice(firstIndex + 1, firstIndex + 50)
  if (remaining.length > 0) {
    takeParseBudget(orbitId, remaining.length)
    void (async () => {
      for (let i = 0; i < remaining.length; i += 5) {
        const chunk = remaining.slice(i, i + 5)
        const resolved = await Promise.all(
          chunk.map(async (it) => {
            try {
              const media = await resolveMedia(c.env, orbitId, it.url)
              return { it, media }
            } catch {
              return { it, media: null }
            }
          })
        )
        let anyAdded = false
        for (const { it, media } of resolved) {
          if (!media) continue
          const entryId = crypto.randomUUID().slice(0, 8)
          let entryUrl = media.url
          if (media.relay && !entryUrl) entryUrl = `/api/watchparty/${party.id}/stream?item=${entryId}`
          const itemTitle = (it.title || pageTitleFor(it.url) || fallbackNameFromUrl(it.url)).slice(0, 60)
          const added = queueOps(orbitId, {
            id: entryId,
            party: party.id,
            op: 'add',
            name: itemTitle,
            url: entryUrl,
            relay: media.relay,
          })
          if (added) anyAdded = true
        }
        if (anyAdded) {
          broadcastToRoom(`watch:${party.id}`, {
            type: 'watch.queue',
            party: party.id,
            queue: party.queue,
            current: party.current,
            frame: party.frame,
            queueRev: party.queueRev,
          })
        }
      }
    })()
  }

  return c.json({
    party: { id: party.id, name: party.name, url: party.mediaUrl, queue: party.queue },
    truncated: expanded.length > 50,
  }, 201)
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

  // Bulk shape: items[] with per-item idempotency IDs (preferred), legacy
  // urls[] (1..10, or up to 30 pmvhaven playlists), or single url split by newline.
  const rawItems: Array<{ url: string; name?: string; cmdId?: string }> = Array.isArray(body?.items)
    ? (body.items as unknown[]).map((it: unknown): { url: string; name?: string; cmdId?: string } => {
        if (typeof it === 'string') return { url: it.trim() }
        const o = it as { url?: unknown; name?: unknown; cmdId?: unknown }
        return {
          url: String(o?.url || '').trim(),
          name: typeof o?.name === 'string' ? o.name : undefined,
          cmdId: typeof o?.cmdId === 'string' ? o.cmdId : undefined,
        }
      }).filter((it: { url: string; name?: string; cmdId?: string }) => Boolean(it.url))
    : []
  const rawUrls: string[] = rawItems.length > 0
    ? rawItems.map((it) => it.url)
    : (Array.isArray(body?.urls)
      ? body.urls.map((u: unknown) => String(u).trim()).filter(Boolean)
      : (url ? url.split(/\n+/).map((l: string) => l.trim()).filter(Boolean) : []))

  const isPl = (u: string) => /pmvhaven\.com\/playlists\//i.test(u)
  if (rawUrls.length > 30 || (rawUrls.length > 10 && !rawUrls.every(isPl))) {
    return c.json({ error: 'Add up to 10 videos at a time (pmvhaven playlists: up to 30).' }, 400)
  }
  if (rawUrls.length === 0) return c.json({ error: PARSE_ERROR }, 422)

  const expanded = await expandPmvhavenPlaylists(rawUrls)
  if (expanded.length > 100) return c.json({ error: 'That playlist is too big. Add 100 videos at a time.' }, 400)

  const remainingCapacity = Math.max(0, 50 - party.queue.length)
  if (remainingCapacity === 0) {
    return c.json({ error: 'Queue is full (maximum 50 videos).' }, 400)
  }

  const itemsToProcess = expanded.slice(0, remainingCapacity).map((it: PlaylistItem, index: number) => {
    // Idempotency survives playlist expansion: one parent cmdId fans out to
    // deterministic child IDs, so retrying the same add cannot duplicate items.
    const parent = rawItems.length === 1 ? rawItems[0] : rawItems.find((r) => r.url === it.url)
    const parentCmd = parent?.cmdId || (typeof body?.cmdId === 'string' ? body.cmdId : undefined)
    return { ...it, cmdId: parentCmd ? `${parentCmd}#${index}` : undefined }
  })
  takeParseBudget(orbitId, itemsToProcess.length)

  const added: Array<{ id: string; name: string; url: string }> = []
  const failed: string[] = []

  for (let i = 0; i < itemsToProcess.length; i += 5) {
    const chunk = itemsToProcess.slice(i, i + 5)
    const resolved = await Promise.all(
      chunk.map(async (it) => {
        try {
          const media = await resolveMedia(c.env, orbitId, it.url)
          return { it, media }
        } catch {
          return { it, media: null }
        }
      })
    )
    let chunkAdded = false
    for (const { it, media } of resolved) {
      if (!media) { failed.push(it.url); continue }

      const entryId = crypto.randomUUID().slice(0, 8)
      let entryUrl = media.url
      if (media.relay && !entryUrl) entryUrl = `/api/watchparty/${party.id}/stream?item=${entryId}`

      const videoName = it.title || (rawUrls.length === 1 && !isPl(rawUrls[0]) && title ? title : (pageTitleFor(it.url) || fallbackNameFromUrl(it.url)))

      const add = queueOps(orbitId, {
        id: entryId,
        party: party.id,
        op: 'add',
        name: videoName,
        url: entryUrl,
        relay: media.relay,
        cmdId: (it as any).cmdId,
      })
      if (!add) { failed.push(it.url); continue }

      const newEntry = party.queue[party.queue.length - 1]
      added.push({ ...newEntry })
      chunkAdded = true
    }

    if (chunkAdded) {
      // Broadcast progressive update so clients see videos appear in real time
      broadcastToRoom(`watch:${party.id}`, {
        type: 'watch.queue',
        party: party.id,
        queue: party.queue,
        current: party.current,
        frame: party.frame,
        queueRev: party.queueRev,
      })
    }
  }

  if (added.length === 0) return c.json({ error: PARSE_ERROR, failed }, 422)

  if (!queueOnly && added.length > 0) {
    queueOps(orbitId, { party: party.id, op: 'play', id: added[0].id })
    broadcastToRoom(`watch:${party.id}`, {
      type: 'watch.queue',
      party: party.id,
      queue: party.queue,
      current: party.current,
      frame: party.frame,
      queueRev: party.queueRev,
    })
  }

  const truncated = expanded.length > remainingCapacity
  return c.json({
    ok: true,
    added,
    failed,
    truncated,
    totalRequested: expanded.length,
  })
})

watchparty.get('/:id', orbitAuth, async (c) => {
  const party = getParty(c.req.param('id') || '')
  if (!party) return c.json({ error: 'Party not found' }, 404)
  const orbitId = c.get('orbitId')
  // Private rooms do not leak snapshots by ID. Members read state; everyone
  // else gets the same 404 as a missing room, with or without an invite.
  if (party.isPrivate && !party.members.has(orbitId)) return c.json({ error: 'Party not found' }, 404)
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
    queueRev: party.queueRev,
    settingsRev: party.settingsRev,
    chat: party.chat,
    members: [...party.members.entries()].map(([id, m]) => ({ id, name: m.name, muted: m.muted })),
  })
})

watchparty.post('/:id/invite', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const token = mintInvite(orbitId, c.req.param('id') || '')
  if (!token) return c.json({ error: 'Only the host can mint invites.' }, 403)
  return c.json({ ok: true, invite: token })
})

watchparty.delete('/:id/invite', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  if (!revokeInvite(orbitId, c.req.param('id') || '')) return c.json({ error: 'Only the host can revoke invites.' }, 403)
  return c.json({ ok: true })
})

watchparty.post('/:id/join', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json().catch(() => null) as any
  if (!redeemInvite(orbitId, c.req.param('id') || '', body?.invite)) {
    return c.json({ error: 'Party not found' }, 404)
  }
  return c.json({ ok: true })
})

// Range-passthrough relay for bound (too-big-to-store) party videos.
watchparty.get('/:id/stream', async (c) => {
  const party = getParty(c.req.param('id') || '')
  if (!party) return c.json({ error: 'Party not found' }, 404)

  const itemId = c.req.query('item')
  const entry = itemId ? party.queue.find((q) => q.id === itemId) : null
  const relay = entry?.relay || party.relay
  if (!relay) return c.json({ error: 'Party not found' }, 404)

  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Referer: relay.referer }
  const range = c.req.header('Range')
  if (range && /^bytes=[\d-]+$/.test(range)) headers.Range = range
  // The timer guards ONLY the header phase: AbortSignal.timeout would keep
  // owning the response body and kill every long stream 15 s in (the
  // "randomly pauses mid-video" report). Release it once headers are here.
  const ctl = new AbortController()
  const headerTimer = setTimeout(() => ctl.abort(), 15_000)
  let up: Response
  try {
    up = await fetch(relay.upstream, { headers, redirect: 'follow', signal: ctl.signal })
  } catch {
    clearTimeout(headerTimer)
    return c.json({ error: 'Upstream unreachable' }, 502)
  }
  clearTimeout(headerTimer)
  if (!up.ok) return c.json({ error: 'Upstream refused' }, 502)
  const out = new Headers()
  const ct = up.headers.get('content-type')
  if (ct) out.set('Content-Type', ct)
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h)
    if (v) out.set(h, v)
  }
  // 60s private cache: seeking re-reads near-ranges locally without
  // re-hitting upstream; the unguessable room id remains the capability.
  out.set('Cache-Control', 'private, max-age=60')
  out.set('Access-Control-Allow-Origin', '*')
  return new Response(up.body, { status: up.status, headers: out })
})
