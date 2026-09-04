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

/**
 * Run every per-source resolver and return the first direct playable URL.
 * If no resolver matches, returns the original URL (caller validates SSRF).
 */
export async function classifyAndResolve(rawUrl: string): Promise<string | null> {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(parsed.protocol) || rawUrl.length > 2048) return null
  for (const r of [resolveTwitter, resolveDiscord, resolveReddit, resolveInstagram, resolveTenor, resolveGiphy]) {
    try {
      const out = await r(parsed)
      if (out) return out
    } catch { /* try next */ }
  }
  // Direct image/video URL — let the proxy+SSRF step have it as-is.
  return parsed.toString()
}

// ---------------------------------------------------------------------------
// EXIF stripping (pure JS — no WASM dependency kept around).
// JPEG: drop APP1 (0xFFE1) segments that begin with "Exif\0".
// PNG: drop eXIf chunks.
// Minimal byte-level parsers — preserve the rest of the image.
// ---------------------------------------------------------------------------

function stripJpegExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes
  const out: number[] = []
  out.push(bytes[0], bytes[1])
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) { out.push(bytes[i]); i += 1; continue }
    // standalone markers
    const marker = bytes[i + 1]
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { out.push(bytes[i], bytes[i + 1]); i += 2; continue }
    if (i + 3 >= bytes.length) return bytes // corrupt — bail
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    if (segLen < 2 || i + 2 + segLen > bytes.length) return bytes
    // APP1 (0xFFE1) AND starts with "Exif\0" — drop it. Keep APP0/JFIF, APP2 ICC, etc.
    if (marker === 0xE1 && segLen >= 6 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      // skip only
    } else {
      for (let k = 0; k < 2 + segLen; k += 1) out.push(bytes[i + k])
    }
    i += 2 + segLen
    // After SOS (0xFFDA), the rest is entropy-coded — stop scanning segments.
    if (marker === 0xDA) {
      while (i < bytes.length) { out.push(bytes[i]); i += 1 }
      break
    }
  }
  return new Uint8Array(out)
}

function stripPngExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return bytes
  // PNG: 8-byte signature, then chunks TYPE/LEN/CRC. Drop eXIf chunk type.
  const out: number[] = []
  for (let k = 0; k < 8; k += 1) out.push(bytes[k])
  let i = 8
  while (i + 8 <= bytes.length) {
    const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    if (type === 'eXIf') {
      i += 8 + len + 4
      continue
    }
    const end = i + 8 + len + 4
    if (end > bytes.length) return bytes
    for (let k = i; k < end; k += 1) out.push(bytes[k])
    i = end
    if (type === 'IEND') break
  }
  return new Uint8Array(out)
}

function stripExif(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === 'image/jpeg') return stripJpegExif(bytes)
  if (mime === 'image/png') return stripPngExif(bytes)
  return bytes
}

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
    res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,video/*,*/*;q=0.8' },
    })
  } catch { return null }
  if (!res.ok) return null
  const contentLength = Number(res.headers.get('content-length') || 0)
  if (contentLength && contentLength > PROXY_MAX_BYTES) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length === 0 || buf.length > PROXY_MAX_BYTES) return null
  if (!isValidMediaMagicBytes(buf)) return null

  const mimeType = detectMediaMime(buf, parsed.pathname)
  const stripped = stripExif(buf, mimeType)
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
