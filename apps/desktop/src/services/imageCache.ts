/**
 * Renderer-side picture cache.
 *
 * Resolution order per URL:
 *   1. Electron bridge -> gmcache:// served by the MAIN process. Bytes live in
 *      an ENCRYPTED disk LRU (`<userData>/imgcache/*.enc`, AES-256-GCM, 500MB
 *      budget, see electron/diskImageCache.cjs) with a RAM index. The old
 *      "RAM-only" note was stale: the F1 concern is met by encryption + the
 *      feed index staying RAM-only, not by avoiding disk. Do NOT delete the
 *      cached .enc files as part of that investigation.
 *   2. This module's in-memory Map (browser/dev): blobs live for the session.
 *   3. Remote URL (fetch-through; caller's <img> onError still applies).
 *
 * The legacy IndexedDB store ('goongrid-img', blobs in the OS user folder)
 * is DESTROYED on first module use — installs upgrading from <1.1 must not
 * keep adult imagery in browser storage. Never throws — worst case returns
 * the remote URL untouched.
 */


import type { CachedPicture } from '../types/gmatch-bridge'

export interface ImageCacheStats {
  files: number
  bytes: number
  backend: 'disk' | 'memory' | 'none'
}

interface Bridge {
  cacheImage?: (url: string) => Promise<{ local: string | null }>
  cacheStats?: () => Promise<{ files: number; bytes: number }>
  cacheList?: () => Promise<{ items: CachedPicture[] }>
  clearCache?: () => Promise<{ files: number; bytes: number }>
  clearFeedCache?: () => Promise<void>
  evictImage?: (url: string) => Promise<{ ok: boolean }>
}

function bridge(): Bridge | null {
  try {
    const g = (typeof window !== 'undefined' ? window.gmatch : undefined) as Bridge | undefined
    return g ?? null
  } catch {
    return null
  }
}

// Destroy the legacy IndexedDB store once per session (fire-and-forget).
let idbCleanupStarted = false
function destroyLegacyIdb(): void {
  if (idbCleanupStarted) return
  idbCleanupStarted = true
  try {
    if (typeof indexedDB !== 'undefined') {
      const req = indexedDB.deleteDatabase('goongrid-img')
      req.onsuccess = () => { /* gone */ }
      req.onerror = () => { /* never existed / blocked: fine */ }
      req.onblocked = () => { /* another tab open: retried on next launch */ }
    }
  } catch {
    /* non-browser env */
  }
}

// Same-origin dev URL for fetching a remote picture's bytes: vite dev serves
// known hosts through local proxies (no CORS block, no console spam). The host
// table lives in shared/sources.json — this was the fourth hand-copied copy.
// Pure (exported for tests).
export { devFetchable } from './booruSources'

// Background (speculative) byte fetches are limited so browser sockets — and
// the IPC channel to the main-process cache — are never starved by a prefetch
// sweep. This only ever gates PREFETCH: the on-demand path (resolveImageNow)
// deliberately bypasses it, because the player is waiting on that one.
const BG_FETCH_LIMIT = 2
let activeBgFetches = 0
const bgFetchQueue: Array<() => void> = []
const inFlightUrls = new Set<string>()

/**
 * Resolved cache URLs (gmcache://, blob:, data:), keyed by the REMOTE url.
 *
 * This is the map that makes "instant" real: without it every <img> starts on
 * the remote URL and only swaps to the local bytes in an effect, so a picture
 * that is already on disk still paints late. With it the render hands the
 * cached URL to the element on the FIRST paint.
 *
 * Bounded (see CACHE_URL_CAP) and deliberately NOT persisted: it holds
 * session-local blob: URLs that die with the process.
 */
const resolvedCache = new Map<string, string>()
const CACHE_URL_CAP = 512

/** Session-only lookup. Read by render paths — never throws. */
export function cachedImageFor(url: string): string | undefined {
  return resolvedCache.get(url)
}

function rememberResolved(url: string, local: string): void {
  if (!url || !local || local === url) return
  // Insertion-ordered LRU: a hit refreshes recency.
  resolvedCache.delete(url)
  resolvedCache.set(url, local)
  while (resolvedCache.size > CACHE_URL_CAP) {
    const oldest = resolvedCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    resolvedCache.delete(oldest)
  }
}

/**
 * Decode a cached picture AHEAD of the moment it is shown.
 *
 * `cacheImage` puts the bytes on disk; it does not decode them. The decode is
 * what the browser does when the <img> mounts, and it is the last thing
 * standing between a warm cache and a picture the player can click — the
 * clicker scores nothing until its own stage reports `load`. Doing it here,
 * while the previous foe is still on screen, is what makes the next one
 * instant.
 *
 * Best-effort by contract: no Image, no decode, no bridge = a silent no-op.
 */
function decodeAhead(local: string): void {
  try {
    if (typeof Image === 'undefined') return
    const img = new Image()
    img.decoding = 'async'
    img.src = local
    if (typeof img.decode === 'function') void img.decode().catch(() => {})
  } catch {
    /* best effort — the <img> still decodes when it mounts */
  }
}

function runNextBgFetch(): void {
  if (activeBgFetches >= BG_FETCH_LIMIT || bgFetchQueue.length === 0) return
  const next = bgFetchQueue.shift()
  if (next) {
    activeBgFetches++
    try {
      next()
    } catch {
      activeBgFetches = Math.max(0, activeBgFetches - 1)
      runNextBgFetch()
    }
  }
}

function queueBgFetch(url: string, task: () => Promise<void>): void {
  if (inFlightUrls.has(url)) return
  inFlightUrls.add(url)
  bgFetchQueue.push(async () => {
    try {
      await task()
    } finally {
      inFlightUrls.delete(url)
      activeBgFetches = Math.max(0, activeBgFetches - 1)
      runNextBgFetch()
    }
  })
  runNextBgFetch()
}

/**
 * Resolve a remote picture URL to its cached form.
 * Electron → gmcache:// (main-process encrypted disk cache via IPC bridge).
 * Browser dev mode → no caching, return URL directly.
 * ponytail: dev mode skips cache entirely; acceptable since dev reloads often.
 */
export async function resolveImage(url: string): Promise<string> {
  if (!url) return url
  destroyLegacyIdb()
  const known = resolvedCache.get(url)
  if (known) return known
  const b = bridge()
  if (b?.cacheImage) {
    try {
      const res = await b.cacheImage(url)
      if (res?.local) {
        rememberResolved(url, res.local)
        return res.local
      }
    } catch {
      /* fall through to remote */
    }
  }
  return url
}

export function prefetchImages(urls: string[], limit = 11): void {
  try {
    const seen = new Set<string>()
    for (const u of urls) {
      if (!u || seen.has(u)) continue
      seen.add(u)
      // Through the bounded queue, not straight to IPC. A queue update can
      // produce 27 of these at once, and firing 27 concurrent cacheImage
      // invokes has the requests competing with the one the player is actually
      // waiting on. resolveImage() (the on-demand path) stays immediate, so
      // prefetch can never delay it.
      queueBgFetch(u, async () => {
        await resolveImage(u)
        // The bytes are on disk now; decode them before the player advances,
        // so the next picture is paintable the instant its <img> mounts.
        const local = resolvedCache.get(u)
        if (local) decodeAhead(local)
      })
      if (seen.size >= limit) break
    }
  } catch {
    /* best effort */
  }
}

/**
 * Resolve a URL ahead of any queued prefetch, bypassing the background
 * concurrency limit. This is the current picture / an avatar: the player is
 * looking at it, so it must not sit behind 27 speculative fetches.
 */
export async function resolveImageNow(url: string): Promise<string> {
  return resolveImage(url)
}

/**
 * What the device holds, newest first.
 *
 * The cache viewer's data source. The list is the MAIN process's persisted
 * index, so it survives a relaunch — the bytes live in the encrypted disk LRU
 * and each row carries the local (gmcache://) url that serves them.
 */
export async function listCachedPictures(): Promise<CachedPicture[]> {
  const b = bridge()
  if (!b?.cacheList) return []
  try {
    const res = await b.cacheList()
    return Array.isArray(res?.items) ? res.items : []
  } catch {
    return []
  }
}

export async function imageCacheStats(): Promise<ImageCacheStats> {
  const b = bridge()
  if (b?.cacheStats) {
    try {
      const s = await b.cacheStats()
      return { files: s.files, bytes: s.bytes, backend: 'disk' }
    } catch {
      /* fall through */
    }
  }
  return { files: 0, bytes: 0, backend: 'none' }
}

export async function clearImageCache(): Promise<ImageCacheStats> {
  const b = bridge()
  if (b?.clearCache) {
    try {
      await b.clearCache()
    } catch {
      /* ignore */
    }
  }
  destroyLegacyIdb()
  return { files: 0, bytes: 0, backend: 'disk' }
}

export async function evictImage(url: string): Promise<void> {
  if (!url) return
  const b = bridge()
  if (b?.evictImage) {
    try {
      await b.evictImage(url)
    } catch {
      /* ignore */
    }
  }
}

/** Drop memoized feed lists after a tag-intent change (solo/remove/
 * deselect). Bytes untouched — the gallery keeps serving gmcache:// URLs.
 * No bridge (browser dev) = no memo = no-op. */
export async function clearFeedCache(): Promise<void> {
  const b = bridge()
  if (b?.clearFeedCache) {
    try {
      await b.clearFeedCache()
    } catch {
      /* ignore */
    }
  }
}

export const _test = {
  resetSessionCache: () => {
    // Drain the speculative-fetch queue and its bookkeeping. Without this a
    // queued prefetch leaks into the next test, which then sees cacheImage
    // calls it never made.
    bgFetchQueue.length = 0
    inFlightUrls.clear()
    activeBgFetches = 0
    resolvedCache.clear()
  },
  sessionCacheSize: () => resolvedCache.size,
  clearSessionCache: async () => { resolvedCache.clear() },
  SESSION_CAP: CACHE_URL_CAP,
  inFlightCount: () => inFlightUrls.size,
}
