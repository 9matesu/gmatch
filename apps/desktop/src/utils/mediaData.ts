// Pure helpers for turning stored media payloads into browser-renderable
// blobs/URLs. Extracted verbatim from App.tsx (behavior-preserving move).

import { countMetric } from './metrics'

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(',')
  const mime = (head?.match(/data:(.*?);/) || [])[1] || 'image/jpeg'
  const bin = atob(base64 || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * A `data:` URL pasted by the user, as a File ready for an upload form.
 *
 * Six call sites (attachment modal, babecock panel, card forge, crop) each
 * inlined this same `split(',')` + `atob` + byte-loop decode. It lives here
 * beside `dataUrlToBlob` so the decode rule is one rule; the caller keeps its
 * own filename convention.
 *
 * Returns null for a non-data URL or an undecodable payload — the caller falls
 * back to treating the input as a plain link.
 */
export function dataUrlToFile(dataUrl: string, fallbackName = `upload-${Date.now()}.jpg`): File | null {
  if (!dataUrl.startsWith('data:')) return null
  try {
    const blob = dataUrlToBlob(dataUrl)
    return new File([blob], fallbackName, { type: blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}

// Local (IndexedDB) object blobs are turned into stable, reusable object URLs so
// they render directly instead of being decoded to garbage text (which produced
// broken `file://`/relative requests on the front page). One URL per object id.
//
// Bounded LRU (plan B1): the cache used to grow for the life of the process,
// keeping every object's Blob bytes in RAM forever. A hit refreshes recency —
// the gallery rebuild re-mints every row it still holds, so live rows stay
// fresh — and eviction revokes the URL, freeing the Blob. A durable row evicted
// by mistake is re-minted with its bytes on the next rebuild; nothing durable
// is affected (the bytes live in IndexedDB).
const LOCAL_URL_CAP = 512
const localObjectUrlCache = new Map<string, string>()
export function localObjectBlobUrl(id: string, data: ArrayBuffer | undefined, mime: string | undefined): string {
  const cached = localObjectUrlCache.get(id)
  if (cached) {
    // Move-to-back: Map iteration order is insertion order, so a delete+set
    // marks this entry as the most recently used.
    localObjectUrlCache.delete(id)
    localObjectUrlCache.set(id, cached)
    countMetric('media.hit', `localUrl:${id}`)
    return cached
  }
  countMetric('media.miss', `localUrl:${id}`)
  if (data && data.byteLength > 0) {
    try {
      const url = URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }))
      localObjectUrlCache.set(id, url)
      while (localObjectUrlCache.size > LOCAL_URL_CAP) {
        const oldest = localObjectUrlCache.keys().next().value
        if (oldest === undefined) break
        const victim = localObjectUrlCache.get(oldest)
        localObjectUrlCache.delete(oldest)
        if (victim) {
          countMetric('media.evict', `localUrl:${oldest}`)
          try { URL.revokeObjectURL(victim) } catch { /* already gone */ }
        }
      }
      return url
    } catch { }
  }
  return ''
}
