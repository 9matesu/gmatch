/**
 * Pure cache policy helpers (SPEC §6 caching).
 *
 * These are the SHARED naming/eviction rules, not the live budgets. Audited
 * 2026-10 against the running implementation, because the numbers here had
 * drifted from every backend:
 *
 *  - MEDIA BYTES live on ENCRYPTED DISK in Electron main
 *    (electron/diskImageCache.cjs: AES-256-GCM, 500 MB LRU, served over
 *    gmcache:// with Range support). This is NOT RAM-only, and the previous
 *    "nothing persists to disk" note was wrong.
 *  - The renderer session Map is DISABLED (imageCache.ts SESSION_CAP = 0); a
 *    picture reaches the renderer through the main-process disk cache.
 *  - Feed-result memoization lives in Electron main (imageCache.cjs):
 *    FEED_TTL_MS 10 min, FEED_MAX_QUERIES 40 — mirrored below.
 *
 * The constants here are what the renderer and the tests reason about. When a
 * backend budget changes, change it in the backend and update these together;
 * do not "fix" the doc and leave the two disagreeing again.
 */

/** Feed memo TTL. Mirrors FEED_TTL_MS in electron/imageCache.cjs. */
export const FEED_CACHE_TTL_MS = 10 * 60 * 1000
/** Feed memo slot count. Mirrors FEED_MAX_QUERIES in electron/imageCache.cjs
 *  (was documented as 100 here; the implementation has always been 40). */
export const FEED_CACHE_MAX_QUERIES = 40

/** Single-file guard — a "picture" bigger than this is never cached.
 *  Mirrors the per-file cap in electron/imageCache.cjs. */
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024

/** Total media budget. Mirrors MAX_DEFAULT in electron/diskImageCache.cjs.
 *  There is no live per-FILE count: the disk cache is byte-bounded only. */
export const IMAGE_CACHE_MAX_BYTES = 500 * 1024 * 1024
export const IMAGE_CACHE_MAX_FILES = 0 // 0 = no file-count cap; bytes govern

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

/** Normalize a feed query so identical tags share one cache slot.
 * Underscores and spaces name the same tag (skylar_vox == skylar vox) —
 * mirrors electron/imageCache.cjs normalizeQuery, keep in sync. */
export function normalizeFeedQuery(query: string): string {
  return query.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase()
}
