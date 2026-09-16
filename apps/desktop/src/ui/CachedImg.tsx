import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { resolveImage } from '../services/imageCache'
import { resolveMediaUrl } from '../utils/media'

interface CachedImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** Shown when the (cached or remote) source fails to load. */
  fallbackSrc?: string
}

/**
 * <img> that serves the picture from the local cache when available
 * (Electron main-process RAM cache — gmcache://, never disk; session Map
 * in browser dev mode) and falls back to the remote URL otherwise.
 */
export default function CachedImg({ src: rawSrc, fallbackSrc, onError, ...rest }: CachedImgProps) {
  // Normalize first: relative paths and bare object ids against the API base
  // (a raw uuid would fire a file:// request -> ERR_FILE_NOT_FOUND).
  const src = resolveMediaUrl(rawSrc)
  const isLocal = /^(gmcache|idle-file|vault|blob|data):/i.test(src)
  const [display, setDisplay] = useState<string>(src)
  const [resolved, setResolved] = useState<boolean>(isLocal)

  useEffect(() => {
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
  }, [src])

  return (
    <img
      src={display || undefined}
      {...rest}
      onError={(e) => {
        if (!resolved) return
        if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
          e.currentTarget.src = fallbackSrc
          return
        }
        onError?.(e)
      }}
    />
  )
}
