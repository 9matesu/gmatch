import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { resolveImage } from '../services/imageCache'
import { resolveMediaUrl } from '../utils/media'

interface CachedImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** Shown when the (cached or remote) source fails to load. */
  fallbackSrc?: string
  /** Fired true when the img starts loading, false once it has loaded/failed. */
  onLoadingChange?: (loading: boolean) => void
}

/**
 * <img> that serves the picture from the local cache when available
 * (Electron main-process encrypted disk cache — gmcache://)
 * Viewport-gated via native IntersectionObserver to prevent 50+ concurrent
 * decodes/fetches when rendering long feeds.
 */
export default function CachedImg({ src: rawSrc, fallbackSrc, onError, onLoadingChange, onLoad, ...rest }: CachedImgProps) {
  // Normalize first: relative paths and bare object ids against the API base
  // (a raw uuid would fire a file:// request -> ERR_FILE_NOT_FOUND).
  const src = resolveMediaUrl(rawSrc)
  const isLocal = /^(gmcache|idle-file|vault|blob|data):/i.test(src)
  const [display, setDisplay] = useState<string>(isLocal ? src : '')
  const [inView, setInView] = useState<boolean>(isLocal || rest.loading === 'eager')
  const [resolved, setResolved] = useState<boolean>(isLocal)
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
      setDisplay(src)
      setResolved(true)
      return
    }
    setDisplay(src)
    resolveImage(src)
      .then((local) => {
        if (live && local) {
          setDisplay(local)
          setResolved(true)
        }
      })
      .catch(() => {
        if (live) {
          setResolved(true)
        }
      })
    return () => {
      live = false
    }
  }, [src, inView])

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
