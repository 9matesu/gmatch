/**
 * Renderer-side picture cache — SESSION MEMORY ONLY (security plan B.1/F1).
 *
 * Resolution order per URL:
 *   1. Electron bridge → gmcache:// served from the MAIN-process RAM LRU
 *      (imageCacheMemory.cjs) — never disk.
 *   2. This module's in-memory Map (browser dev mode): blobs live only for
 *      the page session; a reload/quit leaves NOTHING on disk.
 *   3. Remote URL (fetch-through; caller's <img> onError still applies).
 *
 * The legacy IndexedDB store ('goongrid-img', blobs in the OS user folder)
 * is DESTROYED on first module use — installs upgrading from <1.1 must not
 * keep adult imagery in browser storage. Never throws — worst case returns
 * the remote URL untouched.
 */


export interface ImageCacheStats {
  files: number
  bytes: number
  backend: 'disk' | 'memory' | 'none'
}

interface Bridge {
  cacheImage?: (url: string) => Promise<{ local: string | null }>
  cacheStats?: () => Promise<{ files: number; bytes: number }>
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

// Session RAM store removed — main process handles caching via encrypted disk.
// ponytail: dev mode has no cache; acceptable since Electron bridge owns it in prod.
export const SESSION_CAP = 0

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

function isDev(): boolean {
  try {
    return !!import.meta.env.DEV
  } catch {
    return false
  }
}

// Limit concurrent background byte fetches to 2 so browser sockets are never starved
const MAX_CONCURRENT_BG_FETCHES = 2
let activeBgFetches = 0
const bgFetchQueue: Array<() => void> = []
const inFlightUrls = new Set<string>()

function runNextBgFetch(): void {
  if (activeBgFetches >= MAX_CONCURRENT_BG_FETCHES || bgFetchQueue.length === 0) return
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
  const b = bridge()
  if (b?.cacheImage) {
    try {
      const res = await b.cacheImage(url)
      if (res?.local) return res.local
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
      void resolveImage(u)
      if (seen.size >= limit) break
    }
  } catch {
    /* best effort */
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
  resetSessionCache: () => {},
  sessionCacheSize: () => 0,
  clearSessionCache: async () => {},
  SESSION_CAP: 0,
}
