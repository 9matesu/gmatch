/**
 * Fetch a media URL's BYTES before a card is forged from it. A card whose
 * source is a live URL breaks the moment the host rotates tokens or blocks
 * hotlinks — the rule is: what enters the gallery/cards is cached bytes.
 *
 * Electron: `cacheImage` populates main-process RAM and returns a
 * `gmcache://` URL, which is fetchable + CORS-enabled (privileged scheme).
 * Vite dev: cross-origin byte fetches die on CORS — `devFetchable` maps the
 * URL onto a same-origin proxy path (/px, /booru/*, /rg-media).
 * Anything else (same-origin /api/objects, data:, blob:) is fetched directly.
 */
import { devFetchable } from '../services/imageCache'

interface CacheBridge { cacheImage?: (url: string) => Promise<{ local?: string } | null> }
const bridge = (): CacheBridge | null =>
  (typeof window !== 'undefined' ? (window as unknown as { gmatch?: CacheBridge }).gmatch ?? null : null)

export async function mediaUrlToCachedFile(url: string): Promise<File> {
  let source = url.trim()
  const b = bridge()
  if (b?.cacheImage && /^https?:/i.test(source)) {
    try {
      const res = await b.cacheImage(source)
      if (res?.local) source = String(res.local)
    } catch {
      /* fall back to dev proxy / direct fetch below */
    }
  } else if (isDev() && /^https?:/i.test(source)) {
    const proxied = devFetchable(source)
    if (proxied) source = proxied
  }
  try {
    const res = await fetch(source, { referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(`source responded ${res.status}`)
    const blob = await res.blob()
    let mime = blob.type || ''
    if (!mime || mime === 'application/octet-stream') {
      const extMatch = source.match(/\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm)(\?|#|$)/i)
      if (extMatch) {
        const ext = extMatch[1].toLowerCase()
        mime = ext === 'mp4' || ext === 'webm' ? `video/${ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      } else {
        mime = 'image/jpeg'
      }
    }
    if (blob.size === 0 || (!mime.startsWith('image/') && !mime.startsWith('video/'))) {
      throw new Error('not cacheable media')
    }
    const ext = (mime.split('/')[1] || 'jpg').split('+')[0]
    return new File([blob], `media-${Date.now()}.${ext}`, { type: mime })
  } catch {
    throw new Error('Could not cache this URL — the source refused the transfer')
  }
}

function isDev(): boolean {
  try {
    return !!import.meta.env.DEV
  } catch {
    return false
  }
}
