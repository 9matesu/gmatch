/**
 * Renderer-side picture cache (SPEC §6 caching).
 * Resolution order per URL:
 *   1. Electron disk cache (`window.goongrid.cacheImage` → gooncache:// file,
 *      lives in the OS user folder, survives restarts).
 *   2. IndexedDB blob store (browser dev mode — profile also lives in the
 *      user folder, no re-download within/across sessions).
 *   3. Remote URL (fetch-through, caller's <img> onError still applies).
 * Never throws — worst case returns the remote URL untouched.
 */

import { isVideoUrl } from './postFilter'

export interface ImageCacheStats {
  files: number
  bytes: number
  backend: 'disk' | 'browser' | 'none'
}

interface Bridge {
  cacheImage?: (url: string) => Promise<{ local: string | null }>
  cacheStats?: () => Promise<{ files: number; bytes: number }>
  clearCache?: () => Promise<{ files: number; bytes: number }>
}

function bridge(): Bridge | null {
  try {
    const g = (typeof window !== 'undefined' ? window.goongrid : undefined) as Bridge | undefined
    return g ?? null
  } catch {
    return null
  }
}

// --- IndexedDB blob store (browser fallback) -------------------------------

const IDB_NAME = 'goongrid-img'
const IDB_STORE = 'blobs'
const IDB_CAP = 250

interface BlobRow {
  blob: Blob
  ts: number
  bytes: number
}

let idbPromise: Promise<IDBDatabase | null> | null = null

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function openIdb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  if (!idbPromise) {
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1)
        req.onupgradeneeded = () => {
          req.result.createObjectStore(IDB_STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return idbPromise
}

function idbTx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | null {
  try {
    return db.transaction(IDB_STORE, mode).objectStore(IDB_STORE)
  } catch {
    return null
  }
}

function idbGet(db: IDBDatabase, url: string): Promise<BlobRow | null> {
  return new Promise((resolve) => {
    const store = idbTx(db, 'readonly')
    if (!store) return resolve(null)
    try {
      const req = store.get(url)
      req.onsuccess = () => resolve((req.result as BlobRow) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function idbPut(db: IDBDatabase, url: string, row: BlobRow): Promise<void> {
  return new Promise((resolve) => {
    const store = idbTx(db, 'readwrite')
    if (!store) return resolve()
    try {
      const req = store.put(row, url)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      // Best-effort cap: drop the oldest rows past IDB_CAP.
      try {
        const count = store.count()
        count.onsuccess = () => {
          if (count.result > IDB_CAP) {
            const cursor = store.openCursor()
            let over = count.result - IDB_CAP
            cursor.onsuccess = () => {
              const c = cursor.result
              if (c && over > 0) {
                over -= 1
                c.delete()
                c.continue()
              }
            }
          }
        }
      } catch {
        /* cap is best-effort */
      }
    } catch {
      resolve()
    }
  })
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const store = idbTx(db, 'readwrite')
    if (!store) return resolve()
    try {
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

function idbStats(db: IDBDatabase): Promise<{ files: number; bytes: number }> {
  return new Promise((resolve) => {
    const store = idbTx(db, 'readonly')
    if (!store) return resolve({ files: 0, bytes: 0 })
    const out = { files: 0, bytes: 0 }
    try {
      const req = store.openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve(out)
        const row = c.value as BlobRow
        out.files += 1
        out.bytes += row.bytes || 0
        c.continue()
      }
      req.onerror = () => resolve(out)
    } catch {
      resolve(out)
    }
  })
}

// Object URLs for IDB blobs — one per remote URL, revoked on clear.
const objectUrls = new Map<string, string>()

function revokeObjectUrls(): void {
  try {
    for (const u of objectUrls.values()) URL.revokeObjectURL(u)
  } catch {
    /* ignore */
  }
  objectUrls.clear()
}

// --- public API ------------------------------------------------------------

/**
 * Same-origin dev URL for fetching a remote picture's bytes: vite dev serves
 * known hosts through local proxies (no CORS block, no console spam).
 * Null = no dev proxy for this host — skip the background fetch in DEV.
 * Cache rows stay keyed by the ORIGINAL url, so hits work across restarts.
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
    if (u.hostname === 'imhentai.xxx' || u.hostname.endsWith('.imhentai.xxx')) {
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
 * Resolve a remote picture URL to its cached form.
 * Electron → gooncache:// local file; browser → blob object URL on hit,
 * remote URL on miss (the miss is downloaded + stored in the background and
 * served from cache on the next view).
 */
export async function resolveImage(url: string): Promise<string> {
  if (!url) return url
  // Lightweight policy: mp4/webm stream from source (often huge); only
  // stills get cached to disk/IDB. Video posters cache as normal images.
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
  const db = await openIdb()
  if (!db) return url
  const hit = await idbGet(db, url)
  if (hit?.blob) {
    const known = objectUrls.get(url)
    if (known) return known
    try {
      const obj = URL.createObjectURL(hit.blob)
      objectUrls.set(url, obj)
      return obj
    } catch {
      return url
    }
  }
  // Miss: store in the background for next time, show remote now.
  // In vite dev, cross-origin byte fetches are CORS-blocked (console spam,
  // zero bytes) — only fetch same-origin proxy URLs there; the <img> still
  // shows the remote URL directly (no CORS needed for display).
  const furl = isDev() ? devFetchable(url) : url
  if (!furl) return url
  void (async () => {
    try {
      const res = await fetch(furl, { referrerPolicy: 'no-referrer' })
      if (!res.ok) return
      const blob = await res.blob()
      if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/')) return
      await idbPut(db, url, { blob, ts: Date.now(), bytes: blob.size })
    } catch {
      /* cache is best-effort */
    }
  })()
  return url
}

/**
 * Best-effort prefetch so back/skip arrows show instantly.
 * Callers pass the 5-up/5-down window (past 5 + queue 5 + previews);
 * capped at 11 so a long queue can't stampede the network.
 */
export function prefetchImages(urls: string[]): void {
  try {
    for (const u of urls.slice(0, 11)) {
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
      return { files: s.files, bytes: s.bytes, backend: 'disk' }
    } catch {
      /* fall through */
    }
  }
  const db = await openIdb()
  if (!db) return { files: 0, bytes: 0, backend: 'none' }
  const s = await idbStats(db)
  return { ...s, backend: 'browser' }
}

export async function clearImageCache(): Promise<void> {
  const b = bridge()
  if (b?.clearCache) {
    try {
      await b.clearCache()
    } catch {
      /* ignore */
    }
    return
  }
  revokeObjectUrls()
  const db = await openIdb()
  if (db) await idbClear(db)
}

/** Test hook: drop memoized state (object URLs are revoked). */
export function __resetImageCache(): void {
  revokeObjectUrls()
  idbPromise = null
}
