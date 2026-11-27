/**
 * Renderer thumbnails for media the MAIN PROCESS does not own.
 *
 * `gmcache://` pictures already have a server-side thumbnailer
 * (`gmcache://thumb/<key>`, an Electron `nativeImage` resize). Everything else
 * a dense grid renders — a `blob:` URL minted from the vault / IndexedDB / a
 * signed object fetch, a `vault://f/<hash>` reference, a loopback vault URL —
 * used to reach Chromium at FULL resolution. A screen of twelve 4000×3000
 * photos is ~575 megapixels of decoded bitmaps, which is exactly the GPU/RAM
 * cost the clicker's cache viewer already fixed for its own tiles.
 *
 * This module is the other half of that little ladder: decode once, resize to a
 * bounded thumbnail, keep a bounded LRU of the small blobs, revoke on evict.
 * It is deliberately dependency-free and injectable so the bounds can be tested
 * without a browser.
 */

/** Longest edge of a generated thumbnail, in CSS-independent pixels. */
export const THUMB_MAX_PX = 360
/** How many generated thumbnails stay resident. Each is a small webp/jpeg blob. */
export const THUMB_CACHE_MAX = 48
/**
 * A payload this small already decodes to a small bitmap; re-encoding it would
 * spend CPU to save nothing, and would UPSCALE a tiny avatar to 360px.
 */
export const THUMB_SKIP_BYTES = 120_000
/** A failed generation is remembered briefly so a broken source is not retried on every mount. */
export const THUMB_FAIL_TTL_MS = 60_000

/**
 * Whether a source is worth a renderer thumbnail.
 *
 *  - `gmcache://`      NO  — the main process already serves `/thumb/<key>`.
 *  - `data:`           NO  — inline bytes, already in memory, usually tiny.
 *  - `blob:`           YES — the bytes are local and there is no other resizer.
 *  - `vault://`        YES — privileged + CORS-enabled, so `fetch` works.
 *  - loopback http(s)  YES — the vault/image-cache servers answer with CORS.
 *  - remote http(s)    NO  — thumbnailing it would download the bytes twice;
 *                            once the disk cache has it, the url becomes
 *                            `gmcache://` and the native path takes over.
 */
export function isThumbEligible(src: string | null | undefined): boolean {
  if (!src) return false
  const s = src.trim()
  if (!s) return false
  if (s.startsWith('gmcache://') || s.startsWith('data:')) return false
  if (s.startsWith('blob:') || s.startsWith('vault://')) return true
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(s)
}

/**
 * Whether THIS runtime can actually produce a renderer thumbnail.
 *
 * When it cannot, a caller must not wait for one: the gate would fetch bytes it
 * can never turn into a small copy, and on a test/embedded runtime whose
 * `fetch` never answers that means a tile stuck behind an empty `src` forever.
 * A missing thumbnailer degrades to rendering the original, immediately.
 */
export function canGenerateThumbs(): boolean {
  return typeof createImageBitmap === 'function' && typeof document !== 'undefined'
}

export interface MediaThumbDeps {
  /** Fetch the original bytes for `src`. */
  load(src: string): Promise<Blob>
  /** Produce a bounded thumbnail, or `null` when the source is not worth one. */
  render(blob: Blob, maxPx: number): Promise<Blob | null>
  createUrl(blob: Blob): string
  revokeUrl(url: string): void
  now?(): number
}

export interface MediaThumbStore {
  /** The thumbnail for `src`, or `null` when it should render at full size. */
  get(src: string): Promise<string | null>
  /** Synchronous cache hit (lets a tile skip the "pending" frame). */
  peek(src: string): string | null
  /** Hold a mounted tile's thumbnail: eviction never revokes a pinned url. */
  pin(src: string): void
  unpin(src: string): void
  size(): number
  clear(): void
}

export interface MediaThumbOptions {
  max?: number
  maxPx?: number
  failTtlMs?: number
}

/**
 * A bounded, deduped, pin-aware thumbnail store.
 *
 * Eviction is the hard part: revoking a blob URL that a mounted `<img>` still
 * points at blanks the tile. The store therefore never evicts a PINNED entry —
 * the caller pins while its element is mounted and unpins on unmount, exactly
 * like `useObjectImage`'s object cache.
 */
export function createMediaThumbStore(deps: MediaThumbDeps, opts: MediaThumbOptions = {}): MediaThumbStore {
  const max = opts.max ?? THUMB_CACHE_MAX
  const maxPx = opts.maxPx ?? THUMB_MAX_PX
  const failTtlMs = opts.failTtlMs ?? THUMB_FAIL_TTL_MS
  const now = deps.now ?? (() => Date.now())

  // Insertion order IS recency: a hit is re-inserted at the end.
  const urls = new Map<string, string>()
  const inflight = new Map<string, Promise<string | null>>()
  const pins = new Map<string, number>()
  const failedUntil = new Map<string, number>()

  const touch = (key: string): string | null => {
    const url = urls.get(key)
    if (url === undefined) return null
    urls.delete(key)
    urls.set(key, url)
    return url
  }

  const evictOverflow = (protectedKey: string) => {
    while (urls.size > max) {
      let victim: string | null = null
      for (const key of urls.keys()) {
        // The entry that was just generated is the one being requested right
        // now; evicting it would make `get` return a revoked url.
        if (key === protectedKey) continue
        if (!pins.has(key)) {
          victim = key
          break
        }
      }
      // Everything resident is on screen. Correctness beats the bound: an
      // over-budget cache is recoverable, a blank mounted tile is not.
      if (victim === null) return
      const url = urls.get(victim)
      urls.delete(victim)
      if (url) {
        try {
          deps.revokeUrl(url)
        } catch {
          /* already revoked */
        }
      }
    }
  }

  const get = (src: string): Promise<string | null> => {
    const cached = touch(src)
    if (cached !== null) return Promise.resolve(cached)

    const running = inflight.get(src)
    if (running) return running

    const expiry = failedUntil.get(src)
    if (expiry !== undefined) {
      if (expiry > now()) return Promise.resolve(null)
      failedUntil.delete(src)
    }

    const job = (async (): Promise<string | null> => {
      try {
        const blob = await deps.load(src)
        const thumb = await deps.render(blob, maxPx)
        if (!thumb) {
          // "Not worth a thumbnail" is as stable a verdict as a failure (small
          // image, gif, no decoder). Remember it briefly: a tile re-mounted on
          // a grid refresh must not re-fetch and re-decode the same bytes just
          // to reach the same answer — that is a visible stutter.
          failedUntil.set(src, now() + failTtlMs)
          return null
        }
        const url = deps.createUrl(thumb)
        urls.set(src, url)
        evictOverflow(src)
        return url
      } catch {
        failedUntil.set(src, now() + failTtlMs)
        return null
      } finally {
        inflight.delete(src)
      }
    })()
    inflight.set(src, job)
    return job
  }

  return {
    get,
    peek: (src) => touch(src),
    pin: (src) => {
      pins.set(src, (pins.get(src) ?? 0) + 1)
    },
    unpin: (src) => {
      const n = pins.get(src) ?? 0
      if (n <= 1) pins.delete(src)
      else pins.set(src, n - 1)
    },
    size: () => urls.size,
    clear: () => {
      for (const url of urls.values()) {
        try {
          deps.revokeUrl(url)
        } catch {
          /* already revoked */
        }
      }
      urls.clear()
      inflight.clear()
      pins.clear()
      failedUntil.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// The browser implementation (created lazily: importing this module in node
// must not touch `URL.createObjectURL`).
// ---------------------------------------------------------------------------

async function loadBlob(src: string): Promise<Blob> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`thumbnail fetch failed: ${res.status}`)
  const blob = await res.blob()
  if (!blob.size) throw new Error('thumbnail source is empty')
  const type = (blob.type || '').toLowerCase()
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
    throw new Error(`not an image: ${type}`)
  }
  return blob
}

async function canvasThumb(bitmap: ImageBitmap, type: string, quality: number): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), type, quality)
  })
}

async function renderThumb(blob: Blob, maxPx: number): Promise<Blob | null> {
  const type = (blob.type || '').toLowerCase()
  // An animated gif (or a vector) is not something to freeze into a still.
  if (type === 'image/gif' || type === 'image/svg+xml') return null
  if (blob.size <= THUMB_SKIP_BYTES) return null
  if (!canGenerateThumbs()) return null

  // Bound the LONGEST edge. `createImageBitmap` preserves the aspect ratio when
  // only one dimension is given, so a portrait image is bounded by width first
  // and re-bounded by height when that would still be enormous.
  let bitmap = await createImageBitmap(blob, { resizeWidth: maxPx, resizeQuality: 'medium' })
  if (bitmap.height > maxPx * 2) {
    bitmap.close?.()
    bitmap = await createImageBitmap(blob, { resizeHeight: maxPx, resizeQuality: 'medium' })
  }
  try {
    // webp keeps alpha; jpeg is the fallback for a canvas that refuses webp.
    const webp = await canvasThumb(bitmap, 'image/webp', 0.75)
    if (webp) return webp
    return await canvasThumb(bitmap, 'image/jpeg', 0.72)
  } finally {
    bitmap.close?.()
  }
}

let defaultStore: MediaThumbStore | null = null

/** The one renderer thumbnail store (the app process owns exactly one). */
export function mediaThumbStore(): MediaThumbStore {
  if (!defaultStore) {
    defaultStore = createMediaThumbStore({
      load: loadBlob,
      render: renderThumb,
      // Call through `globalThis` so a test that replaces the URL statics sees
      // the replacement (and so importing this module never touches them).
      createUrl: (blob) => globalThis.URL.createObjectURL(blob),
      revokeUrl: (url) => globalThis.URL.revokeObjectURL(url),
    })
  }
  return defaultStore
}

/** Test-only: drop the singleton so a suite starts from an empty store. */
export function __resetMediaThumbStoreForTests(): void {
  defaultStore?.clear()
  defaultStore = null
}