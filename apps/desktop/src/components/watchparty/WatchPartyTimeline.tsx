'use client'

// Shared transport for the ACTIVE party slot: play/pause + scrub. The center
// timeline is the only transport control (the players hide their own).

import { useEffect, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { formatVideoTime } from '../media/NativeVideoPlayer'
import { controlPlayback, serverNow, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition } from '../../utils/watchSync'
import { BTN } from '../../ui/styles'

export function WatchPartyTimeline({ party, canLoad = false, onLoadVideo }: {
  party: PartyRuntime | null
  canLoad?: boolean
  onLoadVideo?: () => void
}) {
  const [, forceTick] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)

  const frame = party?.frame || null

  useEffect(() => {
    if (!frame) return
    const t = setInterval(() => forceTick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [frame])

  useEffect(() => {
    const el = document.querySelector<HTMLVideoElement>('.watch-party-slot[data-active="true"] video')
    if (el && Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
  })

  if (!party) {
    return <div className="h-9 border-t border-border-glass" />
  }

  const target = frame ? computeTargetPosition(frame, serverNow()) : 0
  const pct = scrubbing ? scrubPct : duration > 0 ? Math.min(1, target / duration) : 0
  const playing = frame?.action === 'play'

  return (
    <div className="bg-surface-raised flex items-center gap-2 px-4 py-2.5 border-t border-border-glass">
      <button
        type="button"
        aria-label={playing ? 'Pause party' : 'Play party'}
        onClick={() => controlPlayback(party.id, playing ? 'pause' : 'play', target)}
        className={`${BTN} p-2 rounded-md`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <span className="text-[10px] font-mono tabular-nums text-retro-muted w-10 text-right">
        {formatVideoTime(target)}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={pct}
        aria-label="Seek party"
        onPointerDown={() => setScrubbing(true)}
        onChange={(e) => {
          setScrubPct(Number(e.target.value))
          if (duration > 0) setScrubPct(Number(e.target.value))
        }}
        onPointerUp={(e) => {
          setScrubbing(false)
          const pos = Number((e.target as HTMLInputElement).value) * duration
          if (duration > 0) controlPlayback(party.id, playing ? 'play' : 'pause', pos)
        }}
        className="flex-1 accent-retro-fg h-1"
      />
      <span className="text-[10px] font-mono tabular-nums text-retro-muted w-10">
        {duration > 0 ? formatVideoTime(duration) : '--:--'}
      </span>
      {canLoad && onLoadVideo && (
        <button
          type="button"
          onClick={onLoadVideo}
          className={`${BTN} px-2 py-1 text-[10px] uppercase tracking-wider shrink-0`}
        >
          Video URL
        </button>
      )}
    </div>
  )
}
