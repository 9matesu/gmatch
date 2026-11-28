'use client'

// Transport overlay for the ACTIVE party slot. Two aligned tiers: a full-width
// scrubber, then one control row with the transport/volume/time cluster on the
// left and view controls on the right. The bar is a flat token plate — no
// gradient, no raw colour, no per-call duration.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  PanelRightClose,
  PanelRightOpen,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  CHROME,
  COLOR,
  GAP,
  ICON,
  MONO,
  MOTION,
  SHADOW,
  TYPE,
} from '../../ui/tokens'
import { formatVideoTime } from '../media/NativeVideoPlayer'
import { controlPlayback, queueOp, serverNow, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition } from '../../utils/watchSync'
import { getRoomVolume, setRoomVolume, readElementVolume, applyRoomVolume } from '../../utils/watchVolume'

const BTN_ICON = cn(CHROME.iconButton, COLOR.fgSoft)

export function WatchPartyTimeline({
  party,
  isHost = false,
  onToggleRail,
  railOpen = false,
}: {
  party: PartyRuntime | null
  /** Holds the room's transport controls. Non-hosts get a read-only bar: the
   *  server refuses their frames (applyWatch is host-gated), so showing live
   *  controls that silently do nothing is worse than no controls. */
  isHost?: boolean
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
  const roomId = party?.id || null
  // Bumped by the slot whenever a new <video> is created, so the volume effects
  // below re-apply to the fresh element instead of the discarded one.
  const [videoNonce, setVideoNonce] = useState(0)
  useEffect(() => {
    const onNew = () => setVideoNonce((n) => n + 1)
    window.addEventListener('watch-video-element', onNew)
    return () => window.removeEventListener('watch-video-element', onNew)
  }, [])

  useEffect(() => {
    if (!frame) return
    // The playhead only needs repainting while the room is actually being
    // watched. A hidden window (tab in the background) skips the repaint, so an
    // idle second costs nothing — the 250 ms slot tick still reconciles.
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      forceTick((n) => n + 1)
    }, 250)
    return () => clearInterval(t)
  }, [frame])

  const video = useCallback(() => {
    return document.querySelector<HTMLVideoElement>('.watch-party-slot[data-active="true"] video')
  }, [])

  /**
   * Volume ownership. Seeded from localStorage per room, re-applied to the
   * element whenever it appears, and kept in sync by listening to the element.
   */
  useEffect(() => {
    const el = video()
    if (!el) return
    const remembered = getRoomVolume(roomId)
    applyRoomVolume(el, remembered)
    setVolume(remembered.volume)
    setPrevVolume(remembered.volume > 0 ? remembered.volume : 1)
    setIsMuted(remembered.muted)
    const onVolumeChange = () => {
      const live = readElementVolume(el)
      if (!live) return
      setVolume(live.volume)
      setIsMuted(live.muted)
      if (live.volume > 0) setPrevVolume(live.volume)
      setRoomVolume(roomId, live)
    }
    el.addEventListener('volumechange', onVolumeChange)
    const cleanup = () => el.removeEventListener('volumechange', onVolumeChange)
    return cleanup
  }, [roomId, video, videoNonce])

  // Re-apply on room switch: the element is recreated, so the remembered value
  // has to land on the NEW element rather than the old one.
  useEffect(() => {
    applyRoomVolume(video(), getRoomVolume(roomId))
  }, [roomId, video, videoNonce])

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
    if (!isHost) return
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
      setRoomVolume(roomId, { volume: restored, muted: false })
    } else {
      setPrevVolume(volume > 0 ? volume : 1)
      v.muted = true
      v.volume = 0
      setVolume(0)
      setIsMuted(true)
      setRoomVolume(roomId, { volume: 0, muted: true })
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
    setRoomVolume(roomId, { volume: val, muted: val === 0 })
  }

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    // Seeking is transport, so it is host-only too: a viewer dragging the bar
    // had their frame refused and the playhead snapped back with no feedback.
    if (!isHost) return
    const el = scrubBarRef.current
    if (!el || duration <= 0) return
    try { el.setPointerCapture(e.pointerId) } catch { /* jsdom / no capture */ }
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
      // Instant local seek: move the playhead under the pointer NOW, without
      // waiting for the server to echo the frame back through the 250 ms tick.
      const v = video()
      if (v) v.currentTime = pos * duration
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
    // Apply locally first (instant), then broadcast. controlPlayback also
    // applies an optimistic frame, but the element seek is what the eye sees.
    const v = video()
    if (v) v.currentTime = seekTime
    controlPlayback(party.id, playing ? 'play' : 'pause', seekTime)
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute bottom-0 inset-x-0 z-20 flex flex-col justify-end border-t pt-2',
        COLOR.edge, COLOR.canvasVeil, MOTION.transition.fade,
        'px-3 sm:px-4 pb-2 select-none',
        playing && !isScrubbing
          ? 'opacity-0 group-hover/watch:opacity-100 focus-within:opacity-100 pointer-events-none group-hover/watch:pointer-events-auto focus-within:pointer-events-auto'
          : 'opacity-100 pointer-events-auto',
      )}
    >
      {/* Tier 1: full-width scrubber */}
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
        <div className={cn('w-full h-1 group-hover/scrub:h-1.5 rounded-full overflow-hidden', COLOR.glassW20, MOTION.transition.quick)}>
          <div className={cn('h-full rounded-full', COLOR.glassW20, MOTION.transition.quick)} style={{ width: `${bufferedPct}%` }} />
        </div>

        <div
          className={cn('absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/scrub:h-1.5 rounded-full pointer-events-none', COLOR.accentBg, MOTION.transition.quick)}
          style={{ width: `${progressPct}%` }}
        />

        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-3.5 rounded-full pointer-events-none',
            'border', COLOR.edge, COLOR.accentBg, SHADOW.large, MOTION.transition.transform,
            'scale-0 group-hover/scrub:scale-100',
          )}
          style={{ left: `${progressPct}%` }}
        />

        {hoverTime !== null && (
          <div
            className={cn(
              'absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md pointer-events-none whitespace-nowrap',
              COLOR.scrim, COLOR.edge, TYPE.caption, 'font-bold', COLOR.fg, SHADOW.large, MONO,
            )}
            style={{ left: `${hoverPosition}%` }}
          >
            {formatVideoTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Tier 2: one control row, two aligned clusters */}
      <div className={cn('flex items-center justify-between', GAP[2], 'mt-1', COLOR.fg)}>
        <div className={cn('flex items-center', GAP[1.5], 'sm:gap-2')}>
          {/* Transport is host-only server-side; viewers see it disabled. */}
          <button
            type="button"
            aria-label="Previous video"
            disabled={!isHost}
            title={isHost ? undefined : 'Playback control is not shared with you in this room'}
            onClick={() => isHost && queueOp(party.id, 'prev')}
            className={BTN_ICON}
          >
            <ChevronLeft className={ICON.md} />
          </button>

          <button
            type="button"
            aria-label={playing ? 'Pause party' : 'Play party'}
            data-testid="watch-transport-play"
            disabled={!isHost}
            title={isHost ? undefined : 'Playback control is not shared with you in this room'}
            onClick={handleTogglePlay}
            className={BTN_ICON}
          >
            {playing ? <Pause className={cn(ICON.md, 'fill-current')} /> : <Play className={cn(ICON.md, 'fill-current translate-x-0.5')} />}
          </button>

          <button
            type="button"
            aria-label="Next video"
            disabled={!isHost}
            title={isHost ? undefined : 'Playback control is not shared with you in this room'}
            onClick={() => isHost && queueOp(party.id, 'next')}
            className={BTN_ICON}
          >
            <ChevronRight className={ICON.md} />
          </button>

          <div className={cn('flex items-center', GAP[1], 'ml-1')}>
            <button
              type="button"
              aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              onClick={handleToggleMute}
              className={BTN_ICON}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className={cn(ICON.md, COLOR.muted)} />
              ) : volume < 0.5 ? (
                <Volume1 className={cn(ICON.md, COLOR.body)} />
              ) : (
                <Volume2 className={cn(ICON.md, COLOR.body)} />
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
              className={cn('w-14 sm:w-18 h-1 rounded-full appearance-none cursor-pointer', COLOR.glassW20, 'accent-retro-accent opacity-75 hover:opacity-100', MOTION.transition.fade)}
            />
          </div>

          <div className={cn(TYPE.caption, MONO, COLOR.body, 'ml-1.5 select-none')}>
            <span>{formatVideoTime(target)}</span>
            <span className="opacity-40 mx-1">/</span>
            <span className="opacity-75">{duration > 0 ? formatVideoTime(duration) : '--:--'}</span>
          </div>
        </div>

        <div className={cn('flex items-center', GAP[1])}>
          {onToggleRail && (
            <button
              type="button"
              aria-label="Toggle side panel"
              title={railOpen ? 'Hide side panel' : 'Show chat and queue'}
              onClick={onToggleRail}
              className={cn(BTN_ICON, railOpen && COLOR.glassW8)}
            >
              {railOpen ? <PanelRightClose className={ICON.md} /> : <PanelRightOpen className={ICON.md} />}
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
            <PictureInPicture2 className={ICON.md} />
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
            <Maximize className={ICON.md} />
          </button>
        </div>
      </div>
    </div>
  )
}
