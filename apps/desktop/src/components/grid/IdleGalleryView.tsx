import { useState } from 'react'
import { useGame } from '../../game/store'
import { IconWallpaper, IconX, IconRefresh, IconChevronL, IconChevronR } from '../../ui/icons'
import { DND_KEEPSAKE } from '../DropZone'
import { offlineSvg } from '../../services/offlineSvg'
import { redgifsPlayable } from '../../services/redgifs'
import CachedImg from '../../ui/CachedImg'
import { EmptyState } from '../EmptyState'
import { BTN, BTN_SMALL, MONO, MUTED, RARITY } from '../../ui/styles'

/** Tag filter input — shell glass tokens (was .custom-tag-input). */
const TAG_INPUT =
  'min-w-0 flex-1 rounded-lg border border-border-glass bg-retro-bg px-2.5 py-1.5 text-[13px] text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent [@media(pointer:coarse)]:text-[16px]'

const HOVER_BTN =
  'glass-button absolute flex cursor-pointer items-center justify-center rounded-lg p-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'

/**
 * Idle keepsakes gallery: compact thumbnails, click to view, hover actions
 * (re-feature, backdrop, create card). Mounted inside the shell's Gallery
 * (Cards), restyled to Tailwind utilities.
 */
export default function IdleGalleryView({
  onCreateCard,
  onSetWallpaper,
}: {
  onCreateCard?: (media: { url: string; tags: string[]; name: string }) => void
  /** Sets the real app/desktop wallpaper (settings-backed). */
  onSetWallpaper?: (url: string) => void
}) {
  const gallery = useGame((s) => s.gallery)
  const backgroundUrl = useGame((s) => s.backgroundUrl)
  const featureImage = useGame((s) => s.featureImage)
  const setBackground = useGame((s) => s.setBackground)
  const [filter, setFilter] = useState('')
  const [viewerId, setViewerId] = useState<string | null>(null)
  if (gallery.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <EmptyState
          icon="🖼️"
          title="No keepsakes yet"
          description="Drain feed images to keep them — featured foes land here with their rarity."
        />
      </div>
    )
  }
  const q = filter.trim().toLowerCase()
  const shown = q
    ? gallery.filter((img) => img.tags.some((t) => t.toLowerCase().includes(q)))
    : gallery
  const viewerIdx = viewerId ? shown.findIndex((g) => g.id === viewerId) : -1
  const viewer = viewerIdx >= 0 ? shown[viewerIdx] : null
  const stepViewer = (dir: 1 | -1) => {
    if (shown.length === 0) return
    const next = ((viewerIdx < 0 ? 0 : viewerIdx) + dir + shown.length) % shown.length
    setViewerId(shown[next].id)
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
      <div className="mb-2.5 flex items-center gap-2.5">
        <input
          className={TAG_INPUT}
          value={filter}
          placeholder="Filter gallery by tag…"
          aria-label="Filter gallery by tag"
          onChange={(e) => setFilter(e.target.value)}
        />
        {q && (
          <button type="button" className={`${BTN} ${BTN_SMALL} flex-none`} onClick={() => setFilter('')}>
            Clear
          </button>
        )}
      </div>
      {q && (
        <div className={`${MUTED} -mt-1 mb-2.5`}>
          {shown.length} of {gallery.length} match “{filter.trim()}”
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No keepsakes match that tag"
          description={`Nothing in the gallery carries “${filter.trim()}”. Try a shorter tag.`}
          action={
            <button type="button" className={`${BTN} ${BTN_SMALL}`} onClick={() => setFilter('')}>
              Clear filter
            </button>
          }
        />
      ) : null}
      {backgroundUrl && (
        <div className="mb-2.5 flex items-center justify-between gap-2.5 rounded-[10px] border border-retro-accent/40 bg-retro-bg px-3 py-2">
          <span className={MUTED}>Backdrop live</span>
          <button
            type="button"
            className={`${BTN} ${BTN_SMALL} flex-none`}
            onClick={() => setBackground(null)}
            title="Remove the app backdrop"
          >
            <IconX size={12} /> Clear
          </button>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
        {shown.map((img) => {
          const isBackdrop = backgroundUrl === img.url
          const isMotion = img.kind === 'video'
          return (
            <div
              key={img.id}
              draggable
              title="Drag into the Card Forge DropZone (or use Card) to make a card"
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_KEEPSAKE, JSON.stringify({ url: img.url, tags: img.tags, name: img.tags.slice(0, 3).join(' ') || 'Keepsake' }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className={`group relative aspect-square overflow-hidden rounded-[10px] border bg-black shadow-[0_4px_10px_rgba(0,0,0,0.5)] cursor-grab active:cursor-grabbing ${
                isBackdrop ? 'border-retro-accent' : 'border-border-glass'
              }`}
            >
              <button
                type="button"
                className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
                title="View keepsake"
                aria-label={`View ${img.tags.slice(0, 2).join(' ') || 'keepsake'}`}
                onClick={() => setViewerId(img.id)}
              >
                {isMotion ? (
                  <video className="block h-full w-full object-cover [content-visibility:auto]" src={img.url} poster={img.preview || undefined} muted preload="metadata" playsInline />
                ) : (
                  <CachedImg
                    className="block h-full w-full object-cover [content-visibility:auto]"
                    src={img.url || offlineSvg(img.tags)}
                    fallbackSrc={offlineSvg(img.tags)}
                    alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </button>
              <span
                className={`${MONO} absolute bottom-1 left-1 rounded-full border border-white/[0.08] bg-[rgba(5,7,10,0.85)] px-[7px] py-0.5 text-[9px] font-bold uppercase tracking-[1px] whitespace-nowrap ${RARITY[img.rarity.toLowerCase()] ?? ''}`}
              >
                {img.rarity}
              </span>
              <div className="absolute right-1 top-1 flex flex-col gap-1">
                <button
                  type="button"
                  className={`${HOVER_BTN} relative right-auto top-auto h-[26px] w-[26px]`}
                  title="Re-feature in the Goon Panel"
                  aria-label={`Re-feature ${img.tags.slice(0, 2).join(' ') || 'keepsake'}`}
                  onClick={() => featureImage(img.id)}
                >
                  <IconRefresh size={13} />
                </button>
                <button
                  type="button"
                  className={`${HOVER_BTN} relative right-auto top-auto h-[26px] w-[26px] disabled:cursor-default disabled:opacity-100 disabled:text-retro-accent`}
                  title={isBackdrop ? 'This is the app backdrop' : 'Set as app backdrop'}
                  aria-label={isBackdrop ? 'Current app backdrop' : `Set ${img.tags.slice(0, 2).join(' ') || 'image'} as app backdrop`}
                  disabled={isBackdrop}
                  onClick={() => { setBackground(img.url); onSetWallpaper?.(img.url) }}
                >
                  <IconWallpaper size={13} />
                </button>
                {onCreateCard && (
                  <button
                    type="button"
                    className={`${HOVER_BTN} relative right-auto top-auto h-[26px] px-1.5 text-[9px] font-bold uppercase tracking-wide`}
                    title="Turn into a card"
                    aria-label={`Turn ${img.tags.slice(0, 2).join(' ') || 'keepsake'} into a card`}
                    onClick={() =>
                      onCreateCard({
                        url: isMotion && img.url.includes('redgifs') ? redgifsPlayable(img.url) : img.url,
                        tags: img.tags.slice(0, 8),
                        name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
                      })
                    }
                  >
                    Card
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keepsake viewer"
          onClick={() => setViewerId(null)}
        >
          <button
            type="button"
            aria-label="Close viewer"
            className="glass-button absolute right-3 top-3 rounded-lg p-2 cursor-pointer"
            onClick={() => setViewerId(null)}
          >
            <IconX size={16} />
          </button>
          {shown.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous keepsake"
                className="glass-button absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-2 cursor-pointer sm:left-4"
                onClick={(e) => {
                  e.stopPropagation()
                  stepViewer(-1)
                }}
              >
                <IconChevronL size={20} />
              </button>
              <button
                type="button"
                aria-label="Next keepsake"
                className="glass-button absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 cursor-pointer sm:right-4"
                onClick={(e) => {
                  e.stopPropagation()
                  stepViewer(1)
                }}
              >
                <IconChevronR size={20} />
              </button>
            </>
          )}
          <figure className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {viewer.kind === 'video' ? (
              <video src={viewer.url} poster={viewer.preview || undefined} className="max-h-[80vh] max-w-full rounded-lg object-contain" controls autoPlay muted loop playsInline />
            ) : (
              <img src={viewer.url || offlineSvg(viewer.tags)} alt={viewer.tags.slice(0, 3).join(' ') || 'keepsake'} className="max-h-[80vh] max-w-full rounded-lg object-contain" referrerPolicy="no-referrer" />
            )}
            <figcaption className={`${MUTED} mt-2 text-center`}>
              {viewer.tags.slice(0, 5).join(' ') || 'keepsake'} · {viewer.rarity}
              {shown.length > 1 ? ` · ${viewerIdx + 1}/${shown.length}` : ''}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}
