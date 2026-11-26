import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { cachedImageFor, resolveImage } from '../services/imageCache'
import { resolveMediaUrl } from '../utils/media'
import { thumbUrl } from '../utils/thumb'

interface CachedImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** Shown when the (cached or remote) source fails to load. */
  fallbackSrc?: string
  /** Fired true when the img starts loading, false once it has loaded/failed. */
  onLoadingChange?: (loading: boolean) => void
  /**
   * Render the SMALL cached copy (`gmcache://thumb/…`) instead of the
   * full-size original. Dense grids (cache viewer, tag browser, gallery)
   * should ask for this: a full-size booru is several MB of decoded bitmap
   * per tile, and a screen of tiles is what made the GPU process eat 878 MB.
   */
  thumb?: boolean
}

/**
 * <img> that serves the picture from the local cache when available
 * (Electron main-process encrypted disk cache — gmcache://)
 * Viewport-gated via native IntersectionObserver to prevent 50+ concurrent
 * decodes/fetches when rendering long feeds.
 */
export default function CachedImg({ src: rawSrc, fallbackSrc, onError, onLoadingChange, onLoad, thumb, ...rest }: CachedImgProps) {
  // Normalize first: relative paths and bare object ids against the API base
  // (a raw uuid would fire a file:// request -> ERR_FILE_NOT_FOUND).
  const src = resolveMediaUrl(rawSrc)
  const isLocal = /^(gmcache|idle-file|vault|blob|data):/i.test(src)
  // The session map answers BEFORE the first paint: a picture whose bytes are
  // already cached mounts straight on gmcache:// instead of flashing the
  // remote URL and swapping a frame later (the "instant image" path).
  const warm = isLocal ? src : cachedImageFor(src)
  const local = warm ?? (isLocal ? src : '')
  const [display, setDisplay] = useState<string>(thumb ? thumbUrl(local) ?? '' : local)
  const [inView, setInView] = useState<boolean>(!!warm || rest.loading === 'eager')
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Consumers (the story ring avatars) need to know "still decoding" vs
  // "painted" — without this a caller literally cannot tell an empty box from
  // a loaded picture.
  const notifyRef = useRef(onLoadingChange)
  notifyRef.current = onLoadingChange
  useEffect(() => {
    if (!display) return
    notifyRef.current?.(true)
  }, [display])

  // Viewport gate: a long feed mounts 50+ of these, and decoding them all up
  // front is the exact CPU/RAM spike the cache exists to avoid. Only resolve
  // once the element is near the viewport (or the caller asked for eager).
  useEffect(() => {
    if (inView) return
    const el = imgRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView])

  useEffect(() => {
    if (!inView) return
    let live = true
    if (/^(gmcache|idle-file|vault|blob|data):/i.test(src)) {
      setDisplay(thumb ? thumbUrl(src) ?? src : src)
      return
    }
    setDisplay(src)
    resolveImage(src)
      .then((local) => {
        if (!live || !local) return
        // The local copy is what can be thumbnailed; until it lands the remote
        // url is the only thing there is.
        setDisplay(thumb ? thumbUrl(local) ?? local : local)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [src, inView, thumb])

  return (
    <img
      ref={imgRef}
      src={display || undefined}
      decoding="async"
      {...rest}
      onLoad={(e) => {
        notifyRef.current?.(false)
        onLoad?.(e)
      }}
      onError={(e) => {
        notifyRef.current?.(false)
        if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
          e.currentTarget.src = fallbackSrc
          return
        }
        onError?.(e)
      }}
    />
  )
}
