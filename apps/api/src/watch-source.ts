import { classifyStaticUrl, type WatchSourceResolution } from '@orbit/shared'
import { proxyAndStoreExternal, classifyAndResolve, isPrivateTarget, pageTitleFor } from './proxy'

const PARSE_ERROR = 'Could not find a playable video at that link.'
const RELAY_MAX_BYTES = 500 * 1024 * 1024

export interface WatchSourceResult extends WatchSourceResolution {
  url: string
  relay?: { upstream: string; referer: string }
  stored?: boolean
}

export function fallbackNameFromUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const base = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    return decodeURIComponent(base.replace(/\.(mp4|webm|m4v|mov)$/i, '').replace(/[-_]+/g, ' ')).trim().slice(0, 60)
  } catch {
    return ''
  }
}

/**
 * The one media pipeline: try store-first (private Object, Range-streamed via
 * the isPartyMediaObject door), fall back to a party-bound relay for files
 * above the 50MB store cap. Returns the playable URL (+ relay binding) or
 * null when nothing playable was found.
 */
async function resolveMedia(env: { BUCKET?: unknown; DB: unknown }, orbitId: string, rawUrl: string): Promise<{ url: string; relay?: { upstream: string; referer: string }; stored?: boolean } | null> {
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
  if (!isPmvVideo && (env as any).BUCKET) {
    const objectId = crypto.randomUUID()
    const proxied = await proxyAndStoreExternal(rawUrl, (env as any).BUCKET, 'objects', objectId)
    if (proxied?.isVideo) {
      await (env as any).DB.prepare(
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

/**
 * Authoritative source resolution: static shared signals first, then the
 * media pipeline. Never returns a playable URL without probing.
 */
export async function resolveWatchSource(env: { BUCKET?: unknown; DB: unknown }, orbitId: string, rawUrl: string, titleHint?: string): Promise<WatchSourceResult> {
  const staticHint = classifyStaticUrl(rawUrl)
  const provider = staticHint.provider || 'page'
  if (!staticHint.ok) {
    return { kind: 'invalid', url: '', provider, reason: staticHint.reason || PARSE_ERROR, sync: 'none' }
  }
  const title = (typeof titleHint === 'string' && titleHint.trim()) || pageTitleFor(rawUrl) || fallbackNameFromUrl(rawUrl)
  const media = await resolveMedia(env, orbitId, rawUrl).catch(() => null)
  if (!media) {
    if (staticHint.ext) {
      return { kind: 'invalid', url: '', provider, title, reason: 'No playable video was found at that direct link.', sync: 'none' }
    }
    return {
      kind: 'provider-unresolved',
      url: '',
      provider,
      title,
      reason: `No playable video was found at ${provider}. Open it externally or add a direct video file instead.`,
      sync: 'none',
    }
  }
  if (media.stored) {
    return { kind: staticHint.ext ? 'stored-video' : 'provider-resolved', url: media.url, provider, title, playableUrl: media.url, sync: 'full', stored: true }
  }
  if (media.relay) {
    return { kind: staticHint.ext ? 'relay-video' : 'provider-resolved', url: '', provider, title, sync: 'full', relay: media.relay }
  }
  return { kind: 'invalid', url: '', provider, title, reason: PARSE_ERROR, sync: 'none' }
}
