"use client";

const COLORS = [
  '#27272a', '#3f3f46', '#52525b', '#71717a',
  '#a1a1aa', '#d4d4d8', '#e4e4e7', '#18181b',
];

function hashToInt(hex: string, index: number, max: number): number {
  const val = parseInt(hex.substring(index * 2, index * 2 + 4), 16)
  return isNaN(val) ? 0 : val % max
}

import { useState, useEffect } from 'react'
import { resolveMediaUrl } from '../utils/media'
import { resolveImage, devFetchable } from '../services/imageCache'

export function Avatar({ id, size = 40, imageUrl, fill = false }: { id: string; size?: number; imageUrl?: string | null; fill?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [cachedUrl, setCachedUrl] = useState<string | null>(null)

  // Track the URL that failed to load. When the profile pic changes (e.g. just
  const failed = imageUrl ? failedUrl === imageUrl : false

  useEffect(() => {
    if (!imageUrl) {
      setCachedUrl(null)
      return
    }
    const resolved = resolveMediaUrl(imageUrl)
    if (/^(gmcache|idle-file|vault|blob|data):/i.test(resolved)) {
      setCachedUrl(resolved)
      return
    }
    const proxied = devFetchable(resolved)
    if (proxied) {
      setCachedUrl(proxied)
      return
    }
    let live = true
    resolveImage(resolved).then((local) => {
      if (live && local && local !== resolved) setCachedUrl(local)
    }).catch(() => {})
    return () => { live = false }
  }, [imageUrl])

  if (imageUrl && !failed) {
    const resolvedUrl = cachedUrl || resolveMediaUrl(imageUrl)

    if (fill) {
      return (
        <img
          src={resolvedUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          data-no-wallpaper
          onError={() => imageUrl && setFailedUrl(imageUrl)}
        />
      )
    }

    return (
      <img
        src={resolvedUrl}
        alt=""
        width={size}
        height={size}
        className="flex-shrink-0 object-cover rounded-full"
        style={{ width: size, height: size }}
        data-no-wallpaper
        onError={() => imageUrl && setFailedUrl(imageUrl)}
      />
    )
  }

  const colorIndex = hashToInt(id, 0, COLORS.length)
  const bgColor = COLORS[colorIndex]
  const fgColor = COLORS[(colorIndex + 4) % COLORS.length]

  const cx = size / 2
  const cy = size / 2
  const r = size * 0.35

  const shape = hashToInt(id, 1, 4)

  if (fill) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <rect width="100%" height="100%" fill={bgColor} />
        {shape === 0 && (
          <circle cx={cx} cy={cy} r={r} fill={fgColor} opacity={0.6} />
        )}
        {shape === 1 && (
          <rect
            x={cx - r * 0.7}
            y={cy - r * 0.7}
            width={r * 1.4}
            height={r * 1.4}
            rx={3}
            fill={fgColor}
            opacity={0.6}
          />
        )}
        {shape === 2 && (
          <polygon
            points={`${cx},${cy - r} ${cx + r},${cy + r * 0.5} ${cx - r},${cy + r * 0.5}`}
            fill={fgColor}
            opacity={0.6}
          />
        )}
        {shape === 3 && (
          <>
            <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.4} fill={fgColor} opacity={0.6} />
            <circle cx={cx + r * 0.35} cy={cy + r * 0.35} r={r * 0.4} fill={fgColor} opacity={0.6} />
          </>
        )}
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <rect width={size} height={size} rx={size / 2} fill={bgColor} />
      {shape === 0 && (
        <circle cx={cx} cy={cy} r={r} fill={fgColor} opacity={0.6} />
      )}
      {shape === 1 && (
        <rect
          x={cx - r * 0.7}
          y={cy - r * 0.7}
          width={r * 1.4}
          height={r * 1.4}
          rx={3}
          fill={fgColor}
          opacity={0.6}
        />
      )}
      {shape === 2 && (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy + r * 0.5} ${cx - r},${cy + r * 0.5}`}
          fill={fgColor}
          opacity={0.6}
        />
      )}
      {shape === 3 && (
        <>
          <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.4} fill={fgColor} opacity={0.6} />
          <circle cx={cx + r * 0.35} cy={cy + r * 0.35} r={r * 0.4} fill={fgColor} opacity={0.6} />
        </>
      )}
    </svg>
  )
}
