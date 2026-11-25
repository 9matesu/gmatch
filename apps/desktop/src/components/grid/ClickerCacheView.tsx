import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Download, HardDrive } from '@phosphor-icons/react'
import { listCachedPictures } from '../../services/imageCache'
import { useGame } from '../../game/store'
import type { CachedPicture } from '../../types/gmatch-bridge'

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

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
  const addGalleryImage = useGame((s) => s.addGalleryImage)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await listCachedPictures()
    setItems(rows)
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
          Picture cache ({items.length})
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
          Nothing cached yet. Play a few rounds — the pictures you see are kept here.
        </p>
      ) : (
        <>
          <p className="text-2xs text-retro-muted">Click a picture to save it to your gallery.</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {items.map((p) => (
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
                    src={p.local}
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
        </>
      )}
    </div>
  )
}

export default ClickerCacheView
