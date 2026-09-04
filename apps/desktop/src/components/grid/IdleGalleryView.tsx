import { useState } from 'react'
import { useGame } from '../../game/store'
import { IconWallpaper, IconX } from '../../ui/icons'
import { offlineSvg } from '../../services/offlineSvg'
import { redgifsPlayable } from '../../services/redgifs'
import CachedImg from '../../ui/CachedImg'
import '../../ui/goongrid.css'

/**
 * Idle keepsakes grid (was ShopPanel's Gallery tab): tag filter, backdrop
 * picker, re-feature button and rarity badges over the zustand gallery.
 *
 * Mounted inside the shell's GalleryView (Cards), which lives OUTSIDE the
 * GridWorkspace's .goongrid-root wrapper, so this component scopes its own
 * legacy stylesheet: the goongrid.css rules are all nested under
 * .goongrid-root, hence the wrapper div + side-effect import here.
 */
export default function IdleGalleryView() {
  const gallery = useGame((s) => s.gallery)
  const backgroundUrl = useGame((s) => s.backgroundUrl)
  const featureImage = useGame((s) => s.featureImage)
  const setBackground = useGame((s) => s.setBackground)
  const [filter, setFilter] = useState('')
  if (gallery.length === 0) {
    return (
      <div className="goongrid-root">
        <div className="tab-body empty">No keepsakes yet. Drain feed images to keep them.</div>
      </div>
    )
  }
  const q = filter.trim().toLowerCase()
  const shown = q
    ? gallery.filter((img) => img.tags.some((t) => t.toLowerCase().includes(q)))
    : gallery
  return (
    <div className="goongrid-root">
      <div className="tab-body">
        <div className="market-head custom-tag-row">
          <input
            className="custom-tag-input"
            value={filter}
            placeholder="Filter gallery by tag…"
            aria-label="Filter gallery by tag"
            onChange={(e) => setFilter(e.target.value)}
          />
          {q && (
            <button type="button" className="btn small" onClick={() => setFilter('')}>
              Clear
            </button>
          )}
        </div>
        {q && (
          <div className="muted custom-tag-note">
            {shown.length} of {gallery.length} match “{filter.trim()}”
          </div>
        )}
        {shown.length === 0 ? (
          <div className="tab-body empty">No keepsakes match that tag.</div>
        ) : null}
        {backgroundUrl && (
          <div className="backdrop-row">
            <span className="muted">Backdrop live</span>
            <button
              type="button"
              className="btn small"
              onClick={() => setBackground(null)}
              title="Remove the app backdrop"
            >
              <IconX size={12} /> Clear
            </button>
          </div>
        )}
        <div className="gallery-grid">
          {shown.map((img) => {
            const isBackdrop = backgroundUrl === img.url
            const isMotion = img.kind === 'video'
            return (
              <div key={img.id} className={`gallery-cell ${isBackdrop ? 'is-backdrop' : ''}`}>
                <button
                  type="button"
                  className="gallery-open"
                  title="Re-feature in the Goon Panel"
                  onClick={() => featureImage(img.id)}
                >
                  {isMotion ? (
                    <video src={redgifsPlayable(img.url)} poster={img.preview ? redgifsPlayable(img.preview) : undefined} muted preload="metadata" playsInline />
                  ) : (
                    <CachedImg
                      src={img.url || offlineSvg(img.tags)}
                      fallbackSrc={offlineSvg(img.tags)}
                      alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  )}
                </button>
                <span className={`rarity-badge sm rarity-${img.rarity.toLowerCase()}`}>
                  {img.rarity}
                </span>
                <button
                  type="button"
                  className="gallery-bg"
                  title={isBackdrop ? 'This is the app backdrop' : 'Set as app backdrop'}
                  aria-label={isBackdrop ? 'Current app backdrop' : `Set ${img.tags.slice(0, 2).join(' ') || 'image'} as app backdrop`}
                  disabled={isBackdrop}
                  onClick={() => setBackground(img.url)}
                >
                  <IconWallpaper size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
