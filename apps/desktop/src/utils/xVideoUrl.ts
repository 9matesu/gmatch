/**
 * Read-only resolver for X/Twitter status links used as feed queries.
 *
 * A status page is not media: the clicker needs the direct mp4 behind it. The
 * one-path resolver normalises the whole family of page URLs (including the
 * `/video/1` suffix that made `https://x.com/.../status/<id>/video/1` fail)
 * to the vxtwitter metadata API, then returns ONLY a direct http(s) media URL
 * that was actually present in the response. Nothing is uploaded, no poster
 * is invented, and a failed lookup says why instead of pretending success.
 */

export type XMediaKind = 'video' | 'image'

export type XMediaResolution =
  | {
      ok: true
      /** Direct, playable media URL from the response — never the status page. */
      url: string
      kind: XMediaKind
      /** The status link that was asked for. */
      sourceUrl: string
      /** Stable id for the post, for the feed row. */
      id: string
      tags: string[]
    }
  | {
      ok: false
      /** Explicit, human-readable reason: not-x-status | offline | http-N | no-media. */
      reason: string
      sourceUrl: string
    }

export interface XResolveDeps {
  /** Injectable so the resolver is testable without a network. */
  fetch?: typeof fetch
  timeoutMs?: number
}

const X_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'vxtwitter.com', 'www.vxtwitter.com', 'fxtwitter.com', 'fixupx.com',
])

const MEDIA_RE = /\.(mp4|webm|m4v|mov|jpg|jpeg|png|gif|webp)(?:[?#]|$)/i
const VIDEO_RE = /\.(mp4|webm|m4v|mov)(?:[?#]|$)/i

/**
 * The vxtwitter metadata URL for a status link, or null for anything else.
 * `/video/<n>` and query/fragment are PAGE navigation, not part of the API
 * path — keeping them is exactly why the `/video/1` link answered nothing.
 */
export function xStatusApiUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!X_HOSTS.has(u.hostname.toLowerCase())) return null
    const m = /^\/([^/]+)\/status\/(\d+)(?:\/.*)?$/.exec(u.pathname)
    if (!m) return null
    return `https://api.vxtwitter.com/${m[1]}/status/${m[2]}`
  } catch {
    return null
  }
}

/** Only a direct media file is playable; a page link never is. */
function playableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate) || !MEDIA_RE.test(candidate)) return null
  return candidate
}

interface ExtendedMedia {
  type?: string
  url?: string
  variants?: Array<{ content_type?: string; bitrate?: number; url?: string }>
}

/** Best direct URL in one media entry. Video picks the highest-bitrate mp4. */
function mediaEntryUrl(m: ExtendedMedia): string | null {
  if ((m.type === 'video' || m.type === 'gif') && Array.isArray(m.variants)) {
    const best = m.variants
      .filter((v) => v && /video\/mp4/i.test(String(v.content_type || '')))
      .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
      .map((v) => playableUrl(v.url))
      .find(Boolean)
    if (best) return best
  }
  return playableUrl(m.url)
}

function tagsFrom(data: Record<string, unknown>): string[] {
  if (Array.isArray(data.tags)) {
    return data.tags.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 20)
  }
  const text = typeof data.text === 'string' ? data.text : ''
  return [...new Set([...text.matchAll(/#([A-Za-z0-9_]{2,40})/g)].map((m) => m[1].toLowerCase()))].slice(0, 20)
}

/**
 * Resolve one status link to direct media. Returns an explicit failure with a
 * reason on every non-success path — no fabricated poster, no page URL passed
 * off as playable media.
 *
 * shortcut: one read-only public metadata endpoint (api.vxtwitter.com); when
 * it is blocked the result fails honestly instead of adding a second provider.
 */
export async function resolveXStatusMedia(
  raw: string,
  deps: XResolveDeps = {},
): Promise<XMediaResolution> {
  const sourceUrl = String(raw || '').trim()
  const apiUrl = xStatusApiUrl(sourceUrl)
  if (!apiUrl) return { ok: false, reason: 'not-x-status', sourceUrl }
  const doFetch = deps.fetch ?? globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, reason: 'offline', sourceUrl }
  let data: Record<string, unknown>
  try {
    const res = await doFetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 6000),
    })
    if (!res.ok) return { ok: false, reason: `http-${res.status}`, sourceUrl }
    data = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'offline', sourceUrl }
  }

  const extended = Array.isArray(data.media_extended) ? data.media_extended : []
  const urls: Array<{ url: string; kind: XMediaKind }> = []
  for (const entry of extended) {
    if (!entry || typeof entry !== 'object') continue
    const m = entry as ExtendedMedia
    const url = mediaEntryUrl(m)
    if (!url) continue
    const kind: XMediaKind = VIDEO_RE.test(url) || m.type === 'video' || m.type === 'gif' ? 'video' : 'image'
    urls.push({ url, kind })
  }
  if (urls.length === 0 && Array.isArray(data.mediaURLs)) {
    for (const value of data.mediaURLs) {
      const url = playableUrl(value)
      if (url) urls.push({ url, kind: VIDEO_RE.test(url) ? 'video' : 'image' })
    }
  }
  if (urls.length === 0) return { ok: false, reason: 'no-media', sourceUrl }

  // A video wins: a tweet that carries both a clip and a still is a video
  // post, and the still is the clip's poster — not a separate image to show.
  const picked = urls.find((u) => u.kind === 'video') ?? urls[0]
  const idMatch = /\/status\/(\d+)/.exec(new URL(sourceUrl).pathname)
  return {
    ok: true,
    url: picked.url,
    kind: picked.kind,
    sourceUrl,
    id: idMatch ? idMatch[1] : picked.url,
    tags: tagsFrom(data),
  }
}
