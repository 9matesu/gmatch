import { useEffect, useState } from 'react'
import { canGenerateThumbs, isThumbEligible, mediaThumbStore } from '../utils/mediaThumb'

export interface MediaThumbState {
  /** The generated thumbnail url, or null when the source should render full size. */
  url: string | null
  /**
   * True while a thumbnail is still owed for an eligible source. A dense grid
   * must NOT paint the full-size original in the meantime: doing so decodes the
   * very bitmap the thumbnail exists to avoid, and then swaps it a frame later.
   */
  pending: boolean
}

const IDLE: MediaThumbState = { url: null, pending: false }

/**
 * Bounded renderer thumbnail for a media url, pinned while the caller mounts.
 *
 * `enabled: false` (the opened post, the viewer, the single foe) costs nothing:
 * no lookup, no pin, no work — the full-size bytes render as before.
 */
export function useMediaThumb(
  src: string | null | undefined,
  enabled: boolean,
): MediaThumbState {
  const key = enabled && canGenerateThumbs() && isThumbEligible(src) ? (src as string) : null
  const [state, setState] = useState<{ key: string; url: string | null; settled: boolean }>(
    { key: '', url: null, settled: false },
  )

  useEffect(() => {
    if (!key) {
      setState((prev) => (prev.key === '' && prev.settled ? prev : { key: '', url: null, settled: true }))
      return
    }

    const store = mediaThumbStore()
    const cached = store.peek(key)
    let live = true
    store.pin(key)
    setState({ key, url: cached, settled: cached !== null })

    if (cached === null) {
      void store.get(key).then((url) => {
        if (live) setState({ key, url, settled: true })
      })
    }

    return () => {
      live = false
      store.unpin(key)
    }
  }, [key])

  // A different src than the resolved one is "still loading": never show the
  // previous picture's thumbnail under a new picture.
  if (!key) return IDLE
  if (state.key !== key) return { url: null, pending: true }
  return { url: state.url, pending: !state.settled }
}