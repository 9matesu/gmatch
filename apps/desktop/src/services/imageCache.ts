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

import { isVideoUrl } from './postFilter'

export interface ImageCacheStats {
  files: number
  bytes: number
  backend: 'memory' | 'none'
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

// --- session RAM store ------------------------------------------------------

export const SESSION_CAP = 250

interface SessionRow {
  blob: Blob
  objectUrl?: string
}
const session = new Map<string, SessionRow>() // insertion order = LRU

function sessionPut(url: string, blob: Blob): void {
  session.delete(url)
  session.set(url, { blob })
  while (session.size > SESSION_CAP) {
    const oldest = session.keys().next().value as string
    revokeUrl(oldest)
    session.delete(oldest)
  }
}

function revokeUrl(url: string): void {
  const row = session.get(url)
  if (row?.objectUrl) {
    try { URL.revokeObjectURL(row.objectUrl) } catch { /* ignore */ }
    row.objectUrl = undefined
  }
}

function revokeAll(): void {
  for (const u of session.keys()) revokeUrl(u)
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
    if (u.hostname === 'yande.re' || u.hostname === 'files.yande.re') return `/booru/yand${path}`
    if (u.hostname === 'imhentai.xxx' || u.hostname.endsWith('.imhentai.xxx')) {
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

/**
 * Resolve a remote picture URL to its cached form (RAM only).
 * Electron → gmcache:// (main-process RAM); browser → blob: object URL on
 * session hit, remote URL on miss (the miss is downloaded into RAM in the
 * background and served from cache on the next view THIS session).
 */
export async function resolveImage(url: string): Promise<string> {
  if (!url) return url
  destroyLegacyIdb()
  // mp4/webm stream from source (often huge); only stills cache. Posters of
  // videos cache as normal images.
  if (isVideoUrl(url)) return url
  const b = bridge()
  if (b?.cacheImage) {
    try {
      const res = await b.cacheImage(url)
      if (res?.local) return res.local
    } catch {
      /* fall through to remote */
    }
    return url
  }
  const hit = session.get(url)
  if (hit) {
    session.delete(url)
    session.set(url, hit) // touch: keep LRU order honest
    if (hit.objectUrl) return hit.objectUrl
    try {
      hit.objectUrl = URL.createObjectURL(hit.blob)
      return hit.objectUrl
    } catch {
      return url
    }
  }
  // Miss: store into SESSION RAM in the background, show remote now.
  // In vite dev, cross-origin byte fetches are CORS-blocked (console spam,
  // zero bytes) — only fetch same-origin proxy URLs there.
  const furl = isDev() ? devFetchable(url) : url
  if (!furl) return url
  void (async () => {
    try {
      const res = await fetch(furl, { referrerPolicy: 'no-referrer', cache: 'no-store' })
      if (!res.ok) return
      const blob = await res.blob()
      if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/')) return
      sessionPut(url, blob)
    } catch {
      /* cache is best-effort */
    }
  })()
  return url
}

/**
 * Best-effort prefetch so back/skip arrows and 3x3 grids show instantly.
 * Default cap is 11 for legacy tests; caller can request up to 27 for full 3x3 ahead.
 */
export function prefetchImages(urls: string[], limit = 11): void {
  try {
    for (const u of urls.slice(0, limit)) {
      if (u) void resolveImage(u)
    }
  } catch {
    /* never break gameplay */
  }
}

export async function imageCacheStats(): Promise<ImageCacheStats> {
  const b = bridge()
  if (b?.cacheStats) {
    try {
      const s = await b.cacheStats()
      return { files: s.files, bytes: s.bytes, backend: 'memory' }
    } catch {
      /* fall through */
    }
  }
  let bytes = 0
  for (const row of session.values()) bytes += row.blob.size
  return { files: session.size, bytes, backend: session.size > 0 ? 'memory' : 'none' }
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
  revokeAll()
  session.clear()
  destroyLegacyIdb()
  return { files: 0, bytes: 0, backend: 'memory' }
}

/** Evict a single image from cache and free its memory. */
export async function evictImage(url: string): Promise<void> {
  if (!url) return
  revokeUrl(url)
  session.delete(url)
  const b = bridge()
  if (b?.evictImage) {
    try {
      await b.evictImage(url)
    } catch {
      /* ignore */
    }
  }
}

// --- test seams --------------------------------------------------------------
export const _test = {
  resetSessionCache: () => { revokeAll(); session.clear() },
  sessionCacheSize: () => session.size,
  clearSessionCache: async () => { revokeAll(); session.clear() },
  SESSION_CAP,
}
