import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Download, HardDrive } from '@phosphor-icons/react'
import { listCachedPictures } from '../../services/imageCache'
import { useGame } from '../../game/store'
import { thumbUrl } from '../../utils/thumb'
import type { CachedPicture } from '../../types/gmatch-bridge'

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** How many cached pictures the viewer mounts at once. */
const CACHE_WINDOW = 60

/**
 * The clicker's picture cache, newest first.
 *
 * The cache is the encrypted disk LRU the main process fills while you play
 * (gmcache://). It used to be invisible AND empty in practice: every picture
 * was evicted the moment you moved on, so there was nothing to look at and
 * nothing to keep. Now the pictures stay, the BACK arrow serves them from
 * disk, and this viewer lets you save one straight to the gallery.
 *
 * Read-only apart from the save: a tile renders from the local bytes, and
 * clicking it captures those bytes durably (the same route a drained foe
 * takes).
 */
export function ClickerCacheView({
  toast,
}: {
  toast?: (m: string, t?: 'success' | 'error' | 'info') => void
}) {
  const [items, setItems] = useState<CachedPicture[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  // The cache can hold hundreds of pictures. Rendering them ALL mounts
  // hundreds of <img> elements at once — the "load everything in a heap"
  // behaviour. The viewer shows a bounded window and grows it on demand.
  const [windowSize, setWindowSize] = useState(CACHE_WINDOW)
  const addGalleryImage = useGame((s) => s.addGalleryImage)

  const load = useCallback(async () => {
    setLoading(true)
    // The main process dedupes by content hash (and by local file for legacy
    // rows) before crossing IPC; a second pass here would only hide real rows.
    setItems(await listCachedPictures())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const total = items.reduce((n, p) => n + (p.bytes || 0), 0)

  const save = (p: CachedPicture) => {
    if (addGalleryImage(p.url)) {
      setSaved((prev) => ({ ...prev, [p.url]: true }))
      toast?.('Saved to your gallery', 'success')
    } else {
      toast?.('Already in your gallery', 'info')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-retro-fg">
          <HardDrive className="h-4 w-4" />
          Temporary picture cache ({items.length})
          {total > 0 && <span className="font-normal text-retro-muted">· {fmtBytes(total)}</span>}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          title="Refresh"
          aria-label="Refresh cache list"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-edge bg-glass-w5 text-retro-muted transition hover:bg-glass-w10 hover:text-retro-fg cursor-pointer"
        >
          <ArrowClockwise size={13} weight="bold" />
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-retro-muted">Reading cache…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-retro-muted">
          Nothing in the temporary picture cache. Play a few rounds — the pictures you see are
          kept here. Keepsakes you saved are in the Gallery, where they are permanent.
        </p>
      ) : (
        <>
          <p className="text-2xs text-retro-muted">
            This cache is temporary and may be cleared. Gallery keepsakes are saved permanently.
            Click a picture to save it to your gallery.
          </p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {items.slice(0, windowSize).map((p) => (
              <button
                key={p.url}
                type="button"
                onClick={() => save(p)}
                title={saved[p.url] ? 'Already saved to your gallery' : 'Save to gallery'}
                aria-label={`Save to gallery: ${p.url}`}
                className="group relative aspect-square overflow-hidden rounded-md border border-edge bg-retro-bg transition hover:border-retro-accent/60 cursor-pointer"
              >
                {p.mime.startsWith('video/') ? (
                  <video
                    src={p.local}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    // Thumbnail, not the original: the cache viewer can hold
                    // hundreds of full-size pictures, and decoding them all
                    // cost ~1 GB of bitmaps. The main process generates the
                    // small copy on demand.
                    src={thumbUrl(p.local) ?? p.local}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
                  {saved[p.url] ? (
                    <span className="text-2xs font-bold text-white">Saved</span>
                  ) : (
                    <Download className="h-4 w-4 text-white" />
                  )}
                </span>
                {saved[p.url] && (
                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-2xs font-bold text-white">
                    Saved
                  </span>
                )}
              </button>
            ))}
          </div>
          {items.length > windowSize && (
            <button
              type="button"
              onClick={() => setWindowSize((n) => n + CACHE_WINDOW)}
              className="w-full rounded-md border border-edge bg-glass-w5 py-1.5 text-2xs font-semibold text-retro-fg transition hover:bg-glass-w10 cursor-pointer"
            >
              Show more ({items.length - windowSize} left)
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default ClickerCacheView
