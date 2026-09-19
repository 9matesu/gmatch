'use client'

// Transport overlay for the ACTIVE party slot: 2-tier player layout.
// Tier 1: Full-width precision scrubber with hover timestamp preview and buffer indication.
// Tier 2: Left cluster (Prev/Play/Next, Volume icon + slider, Time), Right cluster (Rail toggle, PiP, Fullscreen).
// Overlaid on a bottom gradient scrim per DESIGN.md.

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  Volume1,
  VolumeX,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { formatVideoTime } from '../media/NativeVideoPlayer'
import { controlPlayback, queueOp, serverNow, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition } from '../../utils/watchSync'

const BTN_ICON =
  'p-1.5 rounded-md hover:bg-glass-w10 text-white/90 hover:text-white cursor-pointer transition-colors duration-150 select-none'

export function WatchPartyTimeline({
  party,
  onToggleRail,
  railOpen = false,
}: {
  party: PartyRuntime | null
  onToggleRail?: () => void
  railOpen?: boolean
}) {
  const scrubBarRef = useRef<HTMLDivElement | null>(null)
  const [, forceTick] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedPct, setBufferedPct] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverPosition, setHoverPosition] = useState(0)

  // Volume state: defaults to 1 if video has volume, or reflects video state
  const [volume, setVolume] = useState(1)
  const [prevVolume, setPrevVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  const frame = party?.frame || null

  useEffect(() => {
    if (!frame) return
    const t = setInterval(() => forceTick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [frame])

  const video = useCallback(() => {
    return document.querySelector<HTMLVideoElement>('.watch-party-slot[data-active="true"] video')
  }, [])

  useEffect(() => {
    const el = video()
    if (el && Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration)
      if (el.buffered && el.buffered.length > 0) {
        const end = el.buffered.end(el.buffered.length - 1)
        setBufferedPct(Math.min(100, (end / el.duration) * 100))
      }
    }
  })

  if (!party) return null

  const target = frame ? computeTargetPosition(frame, serverNow()) : 0
  const playing = frame?.action === 'play'
  const progressPct = isScrubbing
    ? scrubPct * 100
    : duration > 0
      ? Math.min(100, Math.max(0, (target / duration) * 100))
      : 0

  const handleTogglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    controlPlayback(party.id, playing ? 'pause' : 'play', target)
  }

  const handleToggleMute = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = video()
    if (!v) return
    if (isMuted || volume === 0) {
      const restored = prevVolume > 0 ? prevVolume : 1
      v.muted = false
      v.volume = restored
      setVolume(restored)
      setIsMuted(false)
    } else {
      setPrevVolume(volume > 0 ? volume : 1)
      v.muted = true
      v.volume = 0
      setVolume(0)
      setIsMuted(true)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    const val = Number(e.target.value)
    const v = video()
    if (v) {
      v.volume = val
      v.muted = val === 0
    }
    setVolume(val)
    setIsMuted(val === 0)
    if (val > 0) setPrevVolume(val)
  }

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const el = scrubBarRef.current
    if (!el || duration <= 0) return
    el.setPointerCapture(e.pointerId)
    setIsScrubbing(true)

    const rect = el.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setScrubPct(pos)
  }

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrubBarRef.current
    if (!el || duration <= 0) return
    const rect = el.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverPosition(pos * 100)
    setHoverTime(pos * duration)
    if (isScrubbing) {
      setScrubPct(pos)
    }
  }

  const handleScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!isScrubbing) return
    setIsScrubbing(false)
    try {
      scrubBarRef.current?.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
    const el = scrubBarRef.current
    if (!el || duration <= 0) return
    const rect = el.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const seekTime = pos * duration
    controlPlayback(party.id, playing ? 'play' : 'pause', seekTime)
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute bottom-0 inset-x-0 z-20 flex flex-col justify-end pt-10 px-3 sm:px-4 pb-[calc(0.75rem+var(--island-clearance))] bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 select-none ${
        playing && !isScrubbing
          ? 'opacity-0 group-hover/watch:opacity-100 focus-within:opacity-100 pointer-events-none group-hover/watch:pointer-events-auto focus-within:pointer-events-auto'
          : 'opacity-100 pointer-events-auto'
      }`}
    >
      {/* Tier 1: Full-width Scrubber Bar */}
      <div
        ref={scrubBarRef}
        role="slider"
        aria-label="Seek video position"
        aria-valuemin={0}
        aria-valuemax={duration || 100}
        aria-valuenow={target}
        onPointerDown={handleScrubPointerDown}
        onPointerMove={handleScrubPointerMove}
        onPointerUp={handleScrubPointerUp}
        onMouseEnter={() => setIsScrubbing(false)}
        onMouseLeave={() => setHoverTime(null)}
        className="relative w-full h-4 flex items-center cursor-pointer group/scrub"
      >
        <div className="w-full h-1 group-hover/scrub:h-1.5 rounded-full bg-glass-w20 overflow-hidden transition-all duration-150">
          <div
            className="h-full bg-glass-w20 rounded-full transition-all duration-150"
            style={{ width: `${bufferedPct}%` }}
          />
        </div>

        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/scrub:h-1.5 rounded-full bg-gradient-to-r from-retro-accent to-white pointer-events-none transition-all duration-150"
          style={{ width: `${progressPct}%` }}
        />

        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg border border-black/20 pointer-events-none transition-transform duration-150 scale-0 group-hover/scrub:scale-100"
          style={{ left: `${progressPct}%` }}
        />

        {hoverTime !== null && (
          <div
            className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/90 border border-border-glass text-[10px] font-mono font-bold text-white shadow-lg pointer-events-none whitespace-nowrap"
            style={{ left: `${hoverPosition}%` }}
          >
            {formatVideoTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Tier 2: Grouped Controls Bar */}
      <div className="flex items-center justify-between gap-2 mt-1 text-white">
        {/* Left Cluster: Transport, Volume, and Time Readout */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Previous video"
            onClick={() => queueOp(party.id, 'prev')}
            className={BTN_ICON}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            aria-label={playing ? 'Pause party' : 'Play party'}
            onClick={handleTogglePlay}
            className={BTN_ICON}
          >
            {playing ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white translate-x-0.5" />}
          </button>

          <button
            type="button"
            aria-label="Next video"
            onClick={() => queueOp(party.id, 'next')}
            className={BTN_ICON}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Volume Control Cluster */}
          <div className="flex items-center gap-1 group/vol ml-1">
            <button
              type="button"
              aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              onClick={handleToggleMute}
              className={BTN_ICON}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-zinc-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4 text-zinc-200" />
              ) : (
                <Volume2 className="w-4 h-4 text-zinc-200" />
              )}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              aria-label="Volume"
              onChange={handleVolumeChange}
              className="w-14 sm:w-18 h-1 bg-glass-w20 rounded-full appearance-none cursor-pointer accent-white opacity-75 hover:opacity-100 transition-opacity"
            />
          </div>

          {/* Time Readout: Current / Duration grouped together */}
          <div className="text-[10px] font-mono tabular-nums text-zinc-300 ml-1.5 select-none">
            <span>{formatVideoTime(target)}</span>
            <span className="opacity-40 mx-1">/</span>
            <span className="opacity-75">{duration > 0 ? formatVideoTime(duration) : '--:--'}</span>
          </div>
        </div>

        {/* Right Cluster: Rail toggle, PiP, and Fullscreen */}
        <div className="flex items-center gap-1">
          {onToggleRail && (
            <button
              type="button"
              aria-label="Toggle side panel"
              title={railOpen ? 'Hide side panel' : 'Show chat and queue'}
              onClick={onToggleRail}
              className={`${BTN_ICON} ${railOpen ? 'bg-glass-w10 text-white' : ''}`}
            >
              {railOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          )}

          <button
            type="button"
            aria-label="Detach to picture-in-picture"
            title="Picture in Picture"
            onClick={async () => {
              const v = video()
              if (!v) return
              try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture()
                else await v.requestPictureInPicture()
              } catch { /* unsupported */ }
            }}
            className={BTN_ICON}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={(e) => {
              const slot = (e.currentTarget as HTMLElement).closest('.watch-party-slot') || document.querySelector('.watch-party-slot')
              if (document.fullscreenElement) void document.exitFullscreen()
              else void slot?.requestFullscreen()
            }}
            className={BTN_ICON}
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
