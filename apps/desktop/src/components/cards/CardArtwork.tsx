"use client";

import { HoloCard } from 'react-holo-card-effect/dist/index.js'
import { Loader2 } from 'lucide-react'
import { useObjectImage } from '../../hooks/useObjectImage'
import { classes, COLOR, GAP, MONO, PADDING_X, TYPE } from '../../ui/tokens'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

/**
 * The card art surface shared by the tile and the detail view.
 *
 * HoloCard paints its image as a CSS `background-image`, so a bare id (signed
 * bytes) has to be resolved to a URL first. While that fetch is in flight —
 * or when the bytes are a video a CSS background cannot paint — handing it
 * `url=""` makes the card render as a blank blue rectangle. Keep the Pokemon
 * HoloCard (tilt + foil) for every card, but give it a real placeholder URL
 * and paint the honest state as a child over the background.
 */
const PLACEHOLDER_ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="340"><rect width="300" height="340" fill="#211799"/></svg>'
)

export function CardArtwork({
  objectId,
  identity,
  width,
  height,
  isVideo = false,
  className = '',
}: {
  objectId: string | null
  identity?: IdentityLike | null
  width: number
  height: number
  isVideo?: boolean
  className?: string
}) {
  const img = useObjectImage(objectId ?? null, identity ?? null)
  const video = Boolean(img.url && (img.isVideo || isVideo))

  return (
    <div className={className} data-card-art="">
      <HoloCard
        url={img.url && !video ? img.url : PLACEHOLDER_ART}
        height={height}
        width={width}
        showSparkles={false}
      >
        {video ? (
          <video
            src={img.url || undefined}
            className="absolute inset-0 z-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label="Card video"
          />
        ) : !img.url ? (
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
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading card art" />
            <span>{img.failed ? 'No preview' : 'Loading card art…'}</span>
          </div>
        ) : null}
      </HoloCard>
    </div>
  )
}
