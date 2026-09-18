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

/**
 * Same-origin dev URL for fetching a remote picture's bytes: vite dev serves
 * known hosts through local proxies (no CORS block, no console spam).
 * Null = no dev proxy for this host — skip the background fetch in DEV.
 * Pure (exported for tests).
 */
export function devFetchable(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const path = `${u.pathname}${u.search}`
    if (u.hostname === 'media.redgifs.com') return `/rg-media${path}`
    if (u.hostname === 'tbib.org') return `/booru/tbib${path}`
    if (u.hostname === 'xbooru.com') return `/booru/xbooru${path}`
    if (u.hostname === 'rule34.paheal.net') return `/booru/paheal${path}`
    if (u.hostname === 'konachan.com') return `/booru/kona${path}`
    if (u.hostname === 'yande.re' || u.hostname === 'files.yande.re') {
      // yande.re 302s image bytes to files.yande.re; vite proxy passes the
      // 302 through and the browser then dies on CORS. /px fetches
      // server-side (follows redirect) and streams bytes same-origin.
      return `/px?u=${encodeURIComponent(url)}`
    }
    if (u.hostname === 'imhentai.xxx' || u.hostname.endsWith('.imhentai.xxx')) {
      return `/px?u=${encodeURIComponent(url)}`
    }
    if (u.hostname === 'video.twimg.com' || u.hostname === 'pbs.twimg.com') {
      // X/Twitter direct media: raw cross-origin fetch dies on CORS in dev.
      return `/px?u=${encodeURIComponent(url)}`
    }
    if (u.hostname === 'babesource.com' || u.hostname === 'media.babesource.com') {
      return `/px?u=${encodeURIComponent(url)}`
    }
    if (u.hostname === 'realbooru.com' || u.hostname.endsWith('.booru.org')) {
      return `/px?u=${encodeURIComponent(url)}`
    }
    return null
  } catch {
    return null
  }
}

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

export const _test = {
  resetSessionCache: () => {},
  sessionCacheSize: () => 0,
  clearSessionCache: async () => {},
  SESSION_CAP: 0,
}
