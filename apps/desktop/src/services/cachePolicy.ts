/**
 * Pure cache policy helpers (SPEC §6 caching).
 * Shared naming/eviction rules used by the renderer blob cache
 * (src/services/imageCache.ts) and the Electron disk cache
 * (electron/imageCache.cjs, which mirrors cacheFileName — keep in sync).
 */

/** Disk/blob cache caps: 400 files / 400 MB, LRU-evicted. */
export const IMAGE_CACHE_MAX_FILES = 400
export const IMAGE_CACHE_MAX_BYTES = 400 * 1024 * 1024
/** Single-file guard — a "picture" bigger than this is never cached. */
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** API-response cache: same tag query reuses parsed posts for 10 minutes. */
export const FEED_CACHE_TTL_MS = 10 * 60 * 1000
export const FEED_CACHE_MAX_QUERIES = 100

const EXT_RE = /\.(jpe?g|png|gif|webp|mp4|webm)(?:[?#]|$)/i

/** FNV-1a 32-bit hash → 8 hex chars. Deterministic, dependency-free. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Stable cache file name for a URL: `<fnv1a(url)>.<ext>`. */
export function cacheFileName(url: string): string {
  const m = EXT_RE.exec(url)
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img'
  return `${fnv1a(url)}.${ext}`
}

export interface CacheEntry {
  key: string
  bytes: number
  lastUsed: number
}

/**
 * LRU eviction picks: oldest-lastUsed first, until the remaining set fits
 * BOTH the file-count and byte caps. Returns the keys to delete.
 */
export function pickEvictions(
  entries: CacheEntry[],
  maxFiles: number = IMAGE_CACHE_MAX_FILES,
  maxBytes: number = IMAGE_CACHE_MAX_BYTES,
): string[] {
  const sorted = [...entries].sort((a, b) => a.lastUsed - b.lastUsed)
  let files = sorted.length
  let bytes = sorted.reduce((n, e) => n + e.bytes, 0)
  const evict: string[] = []
  for (const e of sorted) {
    if (files <= maxFiles && bytes <= maxBytes) break
    evict.push(e.key)
    files -= 1
    bytes -= e.bytes
  }
  return evict
}

/** True when a cached feed response is still fresh. */
export function isFeedCacheFresh(
  cachedAt: number,
  now: number = Date.now(),
  ttlMs: number = FEED_CACHE_TTL_MS,
): boolean {
  return cachedAt > 0 && now - cachedAt < ttlMs
}

/** Normalize a feed query so identical tags share one cache slot. */
export function normalizeFeedQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}
