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
const localObjectUrlCache = new Map<string, string>()
export function localObjectBlobUrl(id: string, data: ArrayBuffer | undefined, mime: string | undefined): string {
  const cached = localObjectUrlCache.get(id)
  if (cached) return cached
  if (data && data.byteLength > 0) {
    try {
      const url = URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }))
      localObjectUrlCache.set(id, url)
      return url
    } catch { }
  }
  return ''
}
