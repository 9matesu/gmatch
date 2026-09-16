'use client'

// Transport overlay for the ACTIVE party slot: play/pause, scrub, volume,
// PiP detach, fullscreen — one plain-white bar, no casings, hidden until the
// pointer enters the video (YouTube rule), always visible while paused.
// DESIGN.md: 300ms enter/exit, bare icon controls, mono tabular time.

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize, Pause, PictureInPicture2, Play } from 'lucide-react'
import { formatVideoTime } from '../media/NativeVideoPlayer'
import { controlPlayback, queueOp, serverNow, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition } from '../../utils/watchSync'

const BTN_BARE = 'p-1 text-white/90 hover:text-white cursor-pointer transition-colors duration-150'

export function WatchPartyTimeline({ party }: {
  party: PartyRuntime | null
}) {
  const [, forceTick] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  // Mirrors the slot's autoplay-safe start: muted until the slider moves.
  const [volume, setVolume] = useState(0)

  const frame = party?.frame || null

  useEffect(() => {
    if (!frame) return
    const t = setInterval(() => forceTick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [frame])

  const video = () =>
    document.querySelector<HTMLVideoElement>('.watch-party-slot[data-active="true"] video')

  useEffect(() => {
    const el = video()
    if (el && Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
  })

  if (!party) return null

  const target = frame ? computeTargetPosition(frame, serverNow()) : 0
  const pct = scrubbing ? scrubPct : duration > 0 ? Math.min(1, target / duration) : 0
  const playing = frame?.action === 'play'

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute inset-x-0 bottom-[var(--island-clearance)] z-10 flex items-center gap-2 px-3 pb-2 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] transition-opacity duration-300 ${
        playing ? 'opacity-0 group-hover/watch:opacity-100 focus-within:opacity-100' : 'opacity-100'
      }`}
    >
      <button
        type="button"
        aria-label="Previous video"
        onClick={() => queueOp(party.id, 'prev')}
        className={BTN_BARE}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label={playing ? 'Pause party' : 'Play party'}
        onClick={() => controlPlayback(party.id, playing ? 'pause' : 'play', target)}
        className={BTN_BARE}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button
        type="button"
        aria-label="Next video"
        onClick={() => queueOp(party.id, 'next')}
        className={BTN_BARE}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="text-[10px] font-mono tabular-nums w-10 text-right">
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
        onChange={(e) => setScrubPct(Number(e.target.value))}
        onPointerUp={(e) => {
          setScrubbing(false)
          const pos = Number((e.target as HTMLInputElement).value) * duration
          if (duration > 0) controlPlayback(party.id, playing ? 'play' : 'pause', pos)
        }}
        className="flex-1 accent-white h-1 cursor-pointer"
      />
      <span className="text-[10px] font-mono tabular-nums w-10">
        {duration > 0 ? formatVideoTime(duration) : '--:--'}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label="Volume"
        onInput={(e) => {
          const v = video()
          if (!v) return
          const vol = Number((e.target as HTMLInputElement).value)
          v.volume = vol
          v.muted = vol === 0
          setVolume(vol)
        }}
        className="w-14 accent-white h-1 cursor-pointer"
      />
      <button
        type="button"
        aria-label="Detach to picture-in-picture"
        onClick={async () => {
          const v = video()
          if (!v) return
          try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture()
            else await v.requestPictureInPicture()
          } catch { /* unsupported state */ }
        }}
        className={BTN_BARE}
      >
        <PictureInPicture2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label="Fullscreen"
        onClick={(e) => {
          const slot = (e.currentTarget as HTMLElement).closest('.watch-party-slot')
          if (document.fullscreenElement) void document.exitFullscreen()
          else void slot?.requestFullscreen()
        }}
        className={BTN_BARE}
      >
        <Maximize className="w-4 h-4" />
      </button>
    </div>
  )
}
