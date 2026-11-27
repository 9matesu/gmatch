'use client'

// Quick-launch chips for links the player used recently. A thumbnail is
// attempted only when the link itself can be decoded as an image; a video or
// provider page gets the neutral film glyph instead of a broken picture.

import { useState } from 'react'
import { Film, Play } from 'lucide-react'
import {
  CHROME, COLOR, GAP, ICON, MOTION, PADDING_X, PADDING_Y, RADIUS, TRACKING, TYPE, WEIGHT, cx,
} from '../../ui/tokens'

function UrlThumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={cx(
      'size-6 shrink-0 flex items-center justify-center overflow-hidden',
      RADIUS.chip, COLOR.canvas, 'border', COLOR.edge,
    )}>
      {failed ? (
        <Film className={cx(ICON.sm, COLOR.muted)} aria-hidden />
      ) : (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      )}
    </span>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function WatchRecentUrls({ urls, onPick, disabled = false }: {
  urls: string[]
  onPick: (url: string) => void
  disabled?: boolean
}) {
  if (urls.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className={cx(TYPE.caption, WEIGHT.semibold, COLOR.muted, 'uppercase', TRACKING.wider)}>Quick launch</p>
      <div className={cx('flex flex-wrap', GAP[1.5])}>
        {urls.map((url) => (
          <button
            key={url}
            type="button"
            disabled={disabled}
            onClick={() => onPick(url)}
            aria-label={`Quick launch ${url}`}
            title={url}
            className={cx(
              CHROME.badge, COLOR.hoverW12, COLOR.hoverFg, MOTION.transition.micro,
              'cursor-pointer active:scale-(--scale-press)',
              'flex items-center', GAP[1.5], PADDING_X[1.5], PADDING_Y[1],
            )}
          >
            <UrlThumb url={url} />
            <span className={cx('min-w-0 max-w-24 truncate', TYPE.caption, COLOR.body)}>{hostOf(url)}</span>
            <Play className={cx(ICON.sm, COLOR.accent)} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}
