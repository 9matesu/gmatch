import { useState } from 'react'
import { useGame } from '../../game/store'
import { IconWallpaper, IconX } from '../../ui/icons'
import { offlineSvg } from '../../services/offlineSvg'
import { redgifsPlayable } from '../../services/redgifs'
import CachedImg from '../../ui/CachedImg'
import { EmptyState } from '../EmptyState'
import { BTN, BTN_SMALL, MONO, MUTED, RARITY } from '../../ui/styles'

/** Tag filter input — shell glass tokens (was .custom-tag-input). */
const TAG_INPUT =
  'min-w-0 flex-1 rounded-lg border border-border-glass bg-retro-bg px-2.5 py-1.5 text-[13px] text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent [@media(pointer:coarse)]:text-[16px]'

/**
 * Idle keepsakes grid (was ShopPanel's Gallery tab): tag filter, backdrop
 * picker, re-feature button and rarity badges over the zustand gallery.
 *
 * Mounted inside the shell's GalleryView (Cards), restyled to Tailwind
 * utilities — no legacy gmatch stylesheet needed.
 */
export default function IdleGalleryView() {
  const gallery = useGame((s) => s.gallery)
  const backgroundUrl = useGame((s) => s.backgroundUrl)
  const featureImage = useGame((s) => s.featureImage)
  const setBackground = useGame((s) => s.setBackground)
  const [filter, setFilter] = useState('')
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
      <div className="grid grid-cols-3 gap-2">
        {shown.map((img) => {
          const isBackdrop = backgroundUrl === img.url
          const isMotion = img.kind === 'video'
          return (
            <div
              key={img.id}
              className={`group relative aspect-square overflow-hidden rounded-[10px] border bg-black shadow-[0_4px_10px_rgba(0,0,0,0.5)] ${
                isBackdrop ? 'border-retro-accent' : 'border-border-glass'
              }`}
            >
              <button
                type="button"
                className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
                title="Re-feature in the Goon Panel"
                onClick={() => featureImage(img.id)}
              >
                {isMotion ? (
                  <video className="block h-full w-full object-cover [content-visibility:auto]" src={redgifsPlayable(img.url)} poster={img.preview ? redgifsPlayable(img.preview) : undefined} muted preload="metadata" playsInline />
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
              <button
                type="button"
                className="glass-button absolute right-1 top-1 flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-lg p-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-100 disabled:text-retro-accent [@media(hover:none)]:opacity-100"
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
  )
}
