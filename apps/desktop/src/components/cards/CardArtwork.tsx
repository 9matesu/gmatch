"use client";

import type { ReactNode } from 'react'
import { HoloCard } from 'react-holo-card-effect/dist/index.js'
import { Loader2 } from 'lucide-react'
import { useObjectImage } from '../../hooks/useObjectImage'
import { isMediaVideo } from '../../utils/media'
import { classes, COLOR, GAP, ICON, MONO, PADDING_X, TYPE } from '../../ui/tokens'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

/**
 * The ONE premium card surface, shared by the tile, the detail view, the
 * market, the duel and the spectator arena. HoloCard paints its image as a CSS
 * `background-image`, so a bare id (signed bytes) has to be resolved to a URL
 * first. While that fetch is in flight — or when the bytes are a video a CSS
 * background cannot paint — handing it `url=""` makes the card render as a
 * blank blue rectangle. Keep the Pokemon HoloCard (tilt + foil) for every card,
 * but give it a real placeholder URL and paint the honest state as a child
 * over the background.
 *
 * `src` is the second leg of the media ladder: a server-resolved snapshot URL
 * (bot / match-local cards, direct keepsake links). Signed bytes resolved from
 * `objectId` always win; a descriptor that yields no bytes falls back to `src`
 * instead of fabricating media.
 */
const PLACEHOLDER_ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="340"><rect width="300" height="340" fill="#211799"/></svg>'
)

export function CardArtwork({
  objectId,
  src,
  identity,
  width,
  height,
  isVideo = false,
  className = '',
  children,
}: {
  objectId: string | null
  /** Direct, already-resolvable media URL. Never a bare object id. */
  src?: string | null
  identity?: IdentityLike | null
  width: number
  height: number
  isVideo?: boolean
  className?: string
  /** Card chrome (rarity chip, footer, stamp) painted over the art. */
  children?: ReactNode
}) {
  const img = useObjectImage(objectId ?? null, identity ?? null)
  const url = img.url ?? src ?? null
  const video = Boolean(url && (img.isVideo || isVideo || isMediaVideo(url)))

  return (
    <div className={className} data-card-art="">
      <HoloCard
        url={url && !video ? url : PLACEHOLDER_ART}
        height={height}
        width={width}
        showSparkles={false}
      >
        {video ? (
          <video
            src={url || undefined}
            className="absolute inset-0 z-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label="Card video"
          />
        ) : !url ? (
          <div
            role="status"
            className={classes(
              'absolute inset-0 z-0 flex flex-col items-center justify-center',
              GAP[2], PADDING_X[3], 'text-center',
              TYPE.caption, MONO, COLOR.muted,
              // Card-art placeholder colour: game semantics, not shell chrome.
              'bg-[#211799]',
            )}
          >
            <Loader2 className={classes(ICON.md, 'animate-spin')} aria-label="Loading card art" />
            <span>{img.failed ? 'No preview' : 'Loading card art…'}</span>
          </div>
        ) : null}
        {children}
      </HoloCard>
    </div>
  )
}
