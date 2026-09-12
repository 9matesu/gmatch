import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { resolveImage } from '../services/imageCache'

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
export default function CachedImg({ src, fallbackSrc, onError, ...rest }: CachedImgProps) {
  const isLocal = /^(gmcache|idle-file|blob|data):/i.test(src)
  const [display, setDisplay] = useState<string>(isLocal ? src : '')
  const [resolved, setResolved] = useState<boolean>(isLocal)

  useEffect(() => {
    let live = true
    if (/^(gmcache|idle-file|blob|data):/i.test(src)) {
      setDisplay(src)
      setResolved(true)
      return
    }
    setResolved(false)
    resolveImage(src)
      .then((local) => {
        if (live) {
          setDisplay(local || src)
          setResolved(true)
        }
      })
      .catch(() => {
        if (live) {
          setDisplay(src)
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
