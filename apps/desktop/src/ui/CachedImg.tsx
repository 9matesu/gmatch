import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { resolveImage } from '../services/imageCache'

interface CachedImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** Shown when the (cached or remote) source fails to load. */
  fallbackSrc?: string
}

/**
 * <img> that serves the picture from the local cache when available
 * (Electron main-process RAM cache — gooncache://, never disk; session Map
 * in browser dev mode) and falls back to the remote URL otherwise.
 */
export default function CachedImg({ src, fallbackSrc, onError, ...rest }: CachedImgProps) {
  const [display, setDisplay] = useState(src)

  useEffect(() => {
    let live = true
    setDisplay(src)
    resolveImage(src)
      .then((local) => {
        if (live && local !== src) setDisplay(local)
      })
      .catch(() => {
        /* remote src already set */
      })
    return () => {
      live = false
    }
  }, [src])

  return (
    <img
      src={display}
      {...rest}
      onError={(e) => {
        if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
          e.currentTarget.src = fallbackSrc
          return
        }
        onError?.(e)
      }}
    />
  )
}
