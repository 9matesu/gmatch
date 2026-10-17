/**
 * Shared Watch Party source taxonomy.
 *
 * Pure, dependency-free classification shared conceptually by the desktop
 * client (immediate input feedback) and the API (authoritative resolution).
 * Static signals only: scheme, host, extension, MIME/name hints. The server
 * upgrades a static hint to stored/relay/resolved after probing; the client
 * never treats a static hint as proof of playability.
 */

export type WatchSourceKind =
  | 'direct-video'
  | 'stored-video'
  | 'relay-video'
  | 'provider-resolved'
  | 'provider-unresolved'
  | 'local-file'
  | 'invalid'

export type WatchSyncCapability = 'full' | 'partial' | 'none'

export interface WatchSourceResolution {
  kind: WatchSourceKind
  provider?: string
  title?: string
  playableUrl?: string
  reason?: string
  sync: WatchSyncCapability
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv', 'ogg', 'mkv'])
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'oga'])

const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'blob:', 'file:', 'vbscript:'])
const UNSUPPORTED_SCHEMES = new Set(['ipfs:', 'ftp:', 'magnet:'])

function extOf(path: string): string {
  const base = path.split('/').filter(Boolean).pop() || ''
  const clean = base.split('?')[0].split('#')[0]
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return ''
  return clean.slice(dot + 1).toLowerCase()
}

/** Canonical provider label for a hostname. Unknown hosts are 'page'. */
export function providerForHost(host: string): string {
  const h = host.toLowerCase()
  if (h === 'twitter.com' || h.endsWith('.twitter.com') || h === 'x.com' || h.endsWith('.x.com')) return 'x'
  if (h.includes('redgifs.com')) return 'redgifs'
  if (h.includes('pmvhaven.com')) return 'pmvhaven'
  if (h.includes('reddit.com') || h.includes('redd.it')) return 'reddit'
  if (h.includes('instagram.com')) return 'instagram'
  if (h.includes('tenor.com')) return 'tenor'
  if (h.includes('giphy.com')) return 'giphy'
  if (h.includes('discordapp.com') || h.includes('discord.com')) return 'discord'
  if (
    h.includes('booru') || h.includes('gelbooru') || h.includes('danbooru') ||
    h.includes('safebooru') || h.includes('rule34') || h.includes('realbooru') ||
    h.includes('xbooru') || h.includes('tbib') || h.includes('paheal') ||
    h.includes('goonchan')
  ) return 'booru'
  return 'page'
}

/** Reject schemes that are dangerous or unresolvable by the media pipeline. */
export function rejectScheme(scheme: string): string | null {
  const s = scheme.toLowerCase()
  if (DANGEROUS_SCHEMES.has(s)) return 'That link uses a scheme the player will not open.'
  if (UNSUPPORTED_SCHEMES.has(s)) return 'That link scheme is not supported by the media pipeline.'
  if (s !== 'http:' && s !== 'https:') return 'Enter an HTTP or HTTPS link.'
  return null
}

export interface StaticUrlHint {
  ok: boolean
  scheme?: string
  host?: string
  provider?: string
  ext?: string
  reason?: string
}

/** Static pre-check only. Never proof of playability. */
export function classifyStaticUrl(raw: string): StaticUrlHint {
  const value = String(raw || '').trim()
  if (!value) return { ok: false, reason: 'Enter a URL first.' }
  if (value.length > 2048) return { ok: false, reason: 'That URL is too long to process.' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }
  const schemeProblem = rejectScheme(url.protocol)
  if (schemeProblem) return { ok: false, reason: schemeProblem }
  const host = url.hostname.toLowerCase()
  const ext = extOf(url.pathname)
  if (VIDEO_EXT.has(ext)) return { ok: true, scheme: url.protocol, host, provider: providerForHost(host), ext }
  if (IMAGE_EXT.has(ext)) return { ok: false, scheme: url.protocol, host, provider: providerForHost(host), ext, reason: 'That link is an image, not a playable video.' }
  if (AUDIO_EXT.has(ext)) return { ok: false, scheme: url.protocol, host, provider: providerForHost(host), ext, reason: 'That link is audio, not a playable video.' }
  return { ok: true, scheme: url.protocol, host, provider: providerForHost(host), ext }
}

export interface LocalFileHint {
  ok: boolean
  kind: 'video' | 'image' | 'other'
  reason?: string
}

/** Static file hint from name/MIME only. Bytes are verified later by hash. */
export function classifyLocalFile(input: { name?: string; type?: string; sizeBytes?: number }): LocalFileHint {
  const name = String(input?.name || '')
  const type = String(input?.type || '').toLowerCase()
  if (type.startsWith('video/')) return { ok: true, kind: 'video' }
  if (type.startsWith('image/')) return { ok: false, kind: 'image', reason: 'That file is an image, not a playable video.' }
  if (type.startsWith('audio/')) return { ok: false, kind: 'other', reason: 'That file is audio, not a playable video.' }
  const ext = extOf(name.toLowerCase())
  if (VIDEO_EXT.has(ext)) return { ok: true, kind: 'video' }
  if (IMAGE_EXT.has(ext)) return { ok: false, kind: 'image', reason: 'That file is an image, not a playable video.' }
  return { ok: false, kind: 'other', reason: 'That file type is not a playable video.' }
}

/** Normalize a URL for queue deduplication. Returns '' when unusable. */
export function normalizeWatchUrl(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}
