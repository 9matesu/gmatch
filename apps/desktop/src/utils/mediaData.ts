// Pure helpers for turning stored media payloads into browser-renderable
// blobs/URLs. Extracted verbatim from App.tsx (behavior-preserving move).

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(',')
  const mime = (head?.match(/data:(.*?);/) || [])[1] || 'image/jpeg'
  const bin = atob(base64 || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
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
    return cached
  }
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
          try { URL.revokeObjectURL(victim) } catch { /* already gone */ }
        }
      }
      return url
    } catch { }
  }
  return ''
}
