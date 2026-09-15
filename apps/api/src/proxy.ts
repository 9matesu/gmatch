// Server-side proxy for external media URLs. Eliminates the privacy leak where
// clients would otherwise fetch remote hosts directly (catalog/IP exposure).
// Flow: classify URL → extract direct media URL via per-source resolver → SSRF
// guard → fetch with timeout → magic-bytes validate → EXIF strip →
// AES-GCM encrypt (Objects) OR plain (LobbyImages) → store to BUCKET → return
// pointer to /api/objects/<id> or /api/lobby/images/<id>/content so the client
// never sees the upstream host.

import { encryptBlob } from './crypto'
import { lookup } from 'node:dns/promises'

const PROXY_TIMEOUT_MS = 8000
const PROXY_MAX_BYTES = 50 * 1024 * 1024
const INLINE_THRESHOLD = 128 * 1024

import { isValidMediaMagicBytes, detectMediaMime } from './routes/objects'
import { stripImageMetadata } from './metadata-strip'

export type ProxyOutcome = {
  /** /api/lobby/images/<id>/content or /api/objects/<id> path. */
  storedUrl: string
  mimeType: string
  isVideo: boolean
  bytesStored: number
  /** 1 when we successfully proxied+stored; 0 when we kept the URL logical-only. */
  isProxied: 1 | 0
  proxiedMime: string | null
}

type BlobStoreLike = {
  put: (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => Promise<void>
}

/** Same SSRF guard used by objects.ts isPrivateTarget — kept local so lobby.ts can import. */
export async function isPrivateTarget(url: URL): Promise<boolean> {
  if (!['http:', 'https:'].includes(url.protocol)) return true
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '0.0.0.0') return true
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true
  // CGNAT 100.64.0.0/10 + Docker default 172.17-31
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  if (/^\[?f[cd][0-9a-f]{2}:/.test(hostname)) return true // fc00::/7 ULA
  try {
    const { address } = await lookup(hostname)
    const addr = address.replace(/^::ffff:/, '')
    if (/^127\./.test(addr) || /^10\./.test(addr) || /^192\.168\./.test(addr) || /^169\.254\./.test(addr)) return true
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return true
    if (addr.startsWith('::1') || /^f[cd][0-9a-f]{2}/.test(addr)) return true
  } catch {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// URL source resolvers. Each returns a direct playable media URL or null.
// ---------------------------------------------------------------------------

async function resolveTwitter(url: URL): Promise<string | null> {
  const host = url.hostname.toLowerCase()
  if (!['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'vxtwitter.com', 'fxtwitter.com', 'fixupx.com'].includes(host)) return null
  try {
    const vxUrl = `https://api.vxtwitter.com${url.pathname}`
    const res = await fetch(vxUrl, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json() as any
    const vid = data.media_extended?.find((m: any) => m.type === 'video' || m.type === 'gif')
    if (vid?.url) return vid.url
    if (Array.isArray(data.mediaURLs) && data.mediaURLs.length > 0) return data.mediaURLs[0]
  } catch {}
  return null
}

async function resolveDiscord(url: URL): Promise<string | null> {
  // cdn.discordapp.com/attachments/<channel>/<file>/<filename>?ex=&is=&hm=
  // media.discordapp.net/attachments/...
  const host = url.hostname.toLowerCase()
  if (host !== 'cdn.discordapp.com' && host !== 'media.discordapp.net') return null
  if (!url.pathname.startsWith('/attachments/')) return url.toString()
  // Direct CDN URLs are already playable media — return as-is.
  return url.toString()
}

async function resolveReddit(url: URL): Promise<string | null> {
  const host = url.hostname.toLowerCase()
  if (host === 'i.redd.it' || host === 'i.reddituploads.com' || host === 'preview.redd.it' || host === 'external-preview.redd.it') return url.toString()
  if (host === 'reddit.com' || host === 'www.reddit.com' || host === 'old.reddit.com') {
    // galleries / posts — try OG meta.
    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) return null
      const html = await res.text()
      const m = html.match(/<meta\s+property="og:image[^"]*"\s+content="([^"]+)"/i) ||
                html.match(/<meta\s+content="([^"]+)"\s+property="og:image[^"]*"/i)
      return m?.[1] ?? null
    } catch { return null }
  }
  return null
}

async function resolveInstagram(url: URL): Promise<string | null> {
  if (!url.hostname.toLowerCase().endsWith('instagram.com')) return null
  // The legacy media gateway — /p/<id>/media/?size=l works without a session.
  const m = url.pathname.match(/^\/(p|reel|tv)\/([^/]+)\/?/)
  if (!m) return null
  return `https://www.instagram.com/${m[1]}/${m[2]}/media/?size=l`
}

async function resolveTenor(url: URL): Promise<string | null> {
  if (!url.hostname.toLowerCase().endsWith('tenor.com')) return null
  // tenor.com/view/<slug>-<id>.htm — page embeds the mp4 URL in a meta.
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/<meta\s+itemprop="contentURL"\s+content="([^"]+\.mp4[^"]*)"/i) ||
              html.match(/"mp4"\s*:\s*"([^"]+)"/i) ||
              html.match(/<meta\s+property="og:video[^"]*"\s+content="([^"]+)"/i)
    return m?.[1] ?? null
  } catch { return null }
}

async function resolveGiphy(url: URL): Promise<string | null> {
  const host = url.hostname.toLowerCase()
  if (host !== 'giphy.com' && host !== 'www.giphy.com' && host !== 'media.giphy.com') return null
  if (host === 'media.giphy.com') return url.toString()
  // giphy.com/gifs/<slug>-<id> → media.giphy.com/media/<id>/giphy.gif|mp4
  const m = url.pathname.match(/-([a-z0-9]+)$/i)
  if (!m) return null
  return `https://media.giphy.com/media/${m[1]}/giphy.mp4`
}

function extractOgMedia(html: string): string | null {
  const patterns = [
    /<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:video:secure_url"/i,
    /<meta\s+property="og:video(?::url)?"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:video(?::url)?"/i,
    /<meta\s+property="og:image:secure_url"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:image:secure_url"/i,
    /<meta\s+property="og:image(?::url)?"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:image(?::url)?"/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1].replace(/&amp;/g, '&')
  }
  return null
}

async function resolveRedgifs(url: URL): Promise<string | null> {
  // redgifs.com/watch/<slug> and /ifr/<id> are JS-app pages, not media
  // bytes — but they serve OG meta for embeds. No API token needed.
  if (!url.hostname.toLowerCase().includes('redgifs.com')) return null
  if (url.hostname.toLowerCase().startsWith('media.')) return url.toString()
  if (!/\/(watch|ifr)\//i.test(url.pathname)) return null
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36' },
    })
    if (!res.ok) return null
    return extractOgMedia(await res.text())
  } catch { return null }
}

async function resolveOpenGraph(url: URL): Promise<string | null> {
  // Last-resort generic fallback for video/article pages we have no
  // dedicated resolver for: og:video (player pages) beats og:image, which
  // beats any .mp4 embedded in the page body (pmvhaven-style: video URL
  // lives in escaped JSON, no og:video tag). Works for ANY site that ships
  // the file URL in its HTML; hosts needing auth/signatures get a new
  // dedicated resolver above this one.
  if (/\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|ogg|m4v)([?#]|$)/i.test(url.pathname)) return null
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*;q=0.8' },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (ct && !ct.includes('html')) return null
    const html = await res.text()
    const title = extractPageTitle(html)
    if (title) {
      pageTitles.set(url.toString(), title)
      if (pageTitles.size > 200) pageTitles.delete(pageTitles.keys().next().value as string)
    }
    // An embedded playable file is a stronger video signal than og:image
    // (pmvhaven ships only a thumbnail as og:image).
    return extractEmbeddedVideo(html) || extractOgMedia(html)
  } catch { return null }
}

/**
 * Site-agnostic module: find a direct playable file in page HTML
 * (mp4/webm/m4v/mov, optional query), including \u002F-escaped JSON payloads
 * and <video>/<source> tags. m3u8 stays out (not playable in <video>
 * without hls.js; sites ship the direct file for playback anyway).
 */
export function extractEmbeddedVideo(html: string): string | null {
  const unescaped = html.replace(/\\u002[fF]/g, '/')
  const m = unescaped.match(/https?:\/\/[^"'\\\s<>]+?\.(?:mp4|webm|m4v|mov)(?:\?[^"'\\\s<>]*)?/i)
  if (m) return m[0]
  const tag = unescaped.match(/<(?:video|source)[^>]*?src="([^"]+?\.(?:mp4|webm|m4v|mov)(?:\?[^"]*)?)"[^>]*>/i)
  if (tag) return tag[1]
  return null
}

/** Page title for parsed-media naming (og:title wins, then <title>). */
export function extractPageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{1,120})"/i)
    || html.match(/<meta[^>]+content="([^"]{1,120})"[^>]+property="og:title"/i)
  const t = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)
  const raw = og?.[1] || t?.[1] || null
  if (!raw) return null
  return raw
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .trim() || null
}

// page URL -> title captured during resolution; routes/watchparty consumes
// it to name parsed videos. ponytail: capped in-memory map, per isolate.
const pageTitles = new Map<string, string>()
export function pageTitleFor(pageUrl: string): string | null {
  return pageTitles.get(pageUrl) || null
}

/**
 * Run every per-source resolver and return the first direct playable URL.
 * If no resolver matches, returns the original URL (caller validates SSRF).
 */
export async function classifyAndResolve(rawUrl: string): Promise<string | null> {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(parsed.protocol) || rawUrl.length > 2048) return null
  for (const r of [resolveTwitter, resolveDiscord, resolveReddit, resolveInstagram, resolveTenor, resolveGiphy, resolveRedgifs, resolveOpenGraph]) {
    try {
      const out = await r(parsed)
      if (out) return out
    } catch { /* try next */ }
  }
  // Direct image/video URL — let the proxy+SSRF step have it as-is.
  return parsed.toString()
}

// ---------------------------------------------------------------------------
// EXIF stripping lives in ./metadata-strip.ts (shared with the upload path).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public entry points used by routes/lobby.ts and routes/objects.ts.
// ---------------------------------------------------------------------------

/**
 * Fetch + validate + EXIF-strip + store an external media URL.
 * Returns the canonical URL on our own host plus mime info.
 * @param kind 'lobby' → stored plain; 'objects' → AES-GCM encrypted.
 */
export async function proxyAndStoreExternal(
  rawUrl: string,
  bucket: BlobStoreLike | undefined,
  kind: 'lobby' | 'objects' | 'babecock',
  id: string,
): Promise<ProxyOutcome | null> {
  const directUrl = await classifyAndResolve(rawUrl)
  if (!directUrl) return null
  let parsed: URL
  try { parsed = new URL(directUrl) } catch { return null }
  if (await isPrivateTarget(parsed)) return null

  let res: Response
  try {
    // Hotlink blockers (realbooru, *.booru.org) 302 imageless "hotlink"
    // pages without a same-site Referer — the same map the client /px proxy
    // and electron imageCache.cjs keep. Missing entry = plain fetch.
    const REFERERS: Record<string, string> = {
      'realbooru.com': 'https://realbooru.com/',
      'tbib.org': 'https://tbib.org/',
      'xbooru.com': 'https://xbooru.com/',
      'yande.re': 'https://yande.re/',
      'konachan.com': 'https://konachan.com/',
      'rule34.paheal.net': 'https://rule34.paheal.net/',
      'media.redgifs.com': 'https://www.redgifs.com/',
      'imhentai.xxx': 'https://imhentai.xxx/',
    }
    const host = parsed.hostname.replace(/^www\./, '')
    const referer = REFERERS[host] || (host.endsWith('.booru.org') ? `https://${parsed.hostname}/` : undefined)
    res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,video/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) },
    })
  } catch { return null }
  if (!res.ok) return null
  const contentLength = Number(res.headers.get('content-length') || 0)
  if (contentLength && contentLength > PROXY_MAX_BYTES) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length === 0 || buf.length > PROXY_MAX_BYTES) return null
  if (!isValidMediaMagicBytes(buf)) return null

  const mimeType = detectMediaMime(buf, parsed.pathname)
  const stripped = stripImageMetadata(buf, mimeType)
  const isVideo = mimeType.startsWith('video/')

  let storedUrl: string
  if (bucket && stripped.length > INLINE_THRESHOLD) {
    if (kind === 'objects') {
      const enc = encryptBlob(stripped)
      await bucket.put(`objects/${id}`, enc, { httpMetadata: { contentType: mimeType } })
      storedUrl = `/api/objects/${id}`
    } else if (kind === 'babecock') {
      const enc = encryptBlob(stripped)
      await bucket.put(`babecock/${id}`, enc, { httpMetadata: { contentType: mimeType } })
      storedUrl = `/api/babecock/entries/${id}/content`
    } else {
      await bucket.put(`lobby/${id}`, stripped, { httpMetadata: { contentType: mimeType } })
      storedUrl = `/api/lobby/images/${id}/content`
    }
  } else {
    // Inline data: URL — kept in the DB row. magic-byte validated already.
    storedUrl = `data:${mimeType};base64,${Buffer.from(stripped).toString('base64')}`
  }

  return {
    storedUrl,
    mimeType,
    isVideo,
    bytesStored: stripped.length,
    isProxied: 1,
    proxiedMime: mimeType,
  }
}

export const PROXY_INLINE_THRESHOLD = INLINE_THRESHOLD
