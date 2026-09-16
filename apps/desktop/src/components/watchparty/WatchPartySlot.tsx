'use client'

// One watch-party slot: dashed "+" placeholder when empty, a sync-driven
// NativeVideoPlayer when filled. Transport belongs to the party, so all the
// player's own controls are hidden; mute stays local.

import { useEffect, useRef, useState } from 'react'
import { Maximize, PictureInPicture2, Plus } from 'lucide-react'
import { NativeVideoPlayer } from '../media/NativeVideoPlayer'
import { useObjectImage } from '../../hooks/useObjectImage'
import { controlPlayback, serverNow, queueOp, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition, driftCorrection, shouldFireQueueNext } from '../../utils/watchSync'

export function WatchPartySlot({
  party,
  identity,
  active,
  fill = false,
  onSelect,
  onEmptyClick,
}: {
  party: PartyRuntime | null
  identity: { orbitId: string; publicKeyHex: string; privateKeyHex: string }
  active: boolean
  fill?: boolean
  onSelect: () => void
  onEmptyClick: () => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const endedRef = useRef<string>('')
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  // Default muted: Chrome blocks unmuted autoplay, and a silent room that
  // starts playing beats a dead frame waiting for a click. Unmute is local.
  const [muted, setMuted] = useState(true)

  const media = useObjectImage(party?.url || null, identity, { enabled: Boolean(party?.url) })
  const src = media.url

  useEffect(() => {
    setVideoSrc(src)
  }, [src])

  // The volume slider starts at 0 (autoplay-safe): make the element agree.
  useEffect(() => {
    const v = wrapRef.current?.querySelector('video')
    if (v) v.muted = true
  }, [videoSrc])

  // 250 ms sync tick, only while a party exists. The video element is read
  // imperatively from the DOM: NativeVideoPlayer keeps it in its own ref.
  useEffect(() => {
    if (!party?.frame || !videoSrc) return
    const timer = setInterval(() => {
      if (document.hidden) return
      const v = wrapRef.current?.querySelector('video')
      if (!v || !party.frame || !videoSrc) return
      const target = computeTargetPosition(party.frame, serverNow())
      if (v.duration > 0 && target >= v.duration - 0.25 && party.frame.action === 'play') {
        // Video ended: the host advances the queue. Keyed by media+frame
        // stamp so a wrap back to the same entry re-arms the guard.
        if (!v.paused) v.pause()
        const endedKey = `${party.current}:${party.frame.updatedAt}`
        if (shouldFireQueueNext({
          isHost: party.host === identity.orbitId,
          queueLength: party.queue.length,
          action: party.frame.action,
          endedKey,
          lastFiredKey: endedRef.current,
        })) {
          endedRef.current = endedKey
          queueOp(party.id, 'next')
        }
        return
      }
      const localPlaying = !v.paused
      const plan = driftCorrection(v.currentTime, target, localPlaying, party.frame.action)
      // Buffering must never move the needle: seeking into a stalled element
      // just restarts the buffer (the lurching-playhead report). Transport
      // (play/pause) still applies; the next data-rich tick re-seeks once.
      const buffering = v.seeking || v.readyState < 3
      if (plan.seekTo !== null && !buffering) v.currentTime = plan.seekTo
      if (plan.play && v.paused) void v.play().catch(() => {})
      if (plan.pause && !v.paused) v.pause()
    }, 250)
    return () => clearInterval(timer)
  }, [party?.id, videoSrc, party?.frame])

  // Stream hiccup recovery: a relay blip or upstream abort leaves a frozen
  // frame forever otherwise. Reload the element; the 250 ms sync tick above
  // re-joins the party position (driftCorrection seeks + plays). One shot
  // per 5 s so a dead URL cannot spin the network.
  useEffect(() => {
    if (!videoSrc) return
    let attached = false
    let recover: (() => void) | null = null
    const attach = () => {
      const v = wrapRef.current?.querySelector('video')
      if (!v || attached) return
      attached = true
      let last = 0
      recover = () => {
        const t = Date.now()
        if (t - last < 5_000) return
        last = t
        v.load()
      }
      v.addEventListener('error', recover)
      v.addEventListener('stalled', recover)
    }
    // The <video> mounts inside NativeVideoPlayer; give it a tick to exist.
    const probe = setInterval(attach, 500)
    attach()
    return () => {
      clearInterval(probe)
      const v = wrapRef.current?.querySelector('video')
      if (v && recover) {
        v.removeEventListener('error', recover)
        v.removeEventListener('stalled', recover)
      }
    }
  }, [videoSrc])

  if (!party) {
    return (
      <button
        type="button"
        onClick={onEmptyClick}
        className="relative aspect-video rounded-lg border border-dashed border-border-glass bg-glass-w5 hover:bg-glass-w10 flex flex-col items-center justify-center gap-2 text-retro-muted transition-colors cursor-pointer"
      >
        <Plus className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Start playing</span>
      </button>
    )
  }

  return (
    <div
      ref={wrapRef}
      data-active={active ? 'true' : 'false'}
      onClick={onSelect}
      className={`watch-party-slot relative ${fill ? 'h-full' : 'aspect-video'} overflow-hidden bg-black cursor-pointer ${active ? 'ring-1 ring-retro-fg' : 'border border-border-glass'}`}
    >
      {videoSrc ? (
        <NativeVideoPlayer
          key={videoSrc}
          src={videoSrc}
          preload="auto"
          loop={false}
          autoPlay={false}
          controls={false}
          showFullscreenButton={false}
          showPipButton={false}
          showSpeedButton={false}
          showLoopButton={false}
          onPlay={() => {
            const v = wrapRef.current?.querySelector('video')
            controlPlayback(party.id, 'play', v ? v.currentTime : 0)
          }}
          onPause={() => {
            const v = wrapRef.current?.querySelector('video')
            controlPlayback(party.id, 'pause', v ? v.currentTime : 0)
          }}
          className="w-full h-full"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-retro-muted">
            {media.failed ? 'Media unavailable' : 'Loading...'}
          </span>
        </div>
      )}
      <span className="absolute top-2 left-3 rounded bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90 pointer-events-none">
        {party.mediaName || party.name}
      </span>
      {party.frame?.by && (
        <span className="absolute bottom-2 left-3 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80 pointer-events-none truncate max-w-[55%]">
          {party.frame.by} controls playback
        </span>
      )}
      {/* Local controls (never synced): volume, PiP detach, fullscreen —
          one button, one function, identical casing. */}
      {videoSrc && (
        <div className="absolute top-2 right-3 flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : 1}
            aria-label="Volume"
            title="Volume"
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => {
              const v = wrapRef.current?.querySelector('video')
              if (!v) return
              const vol = Number((e.target as HTMLInputElement).value)
              v.volume = vol
              v.muted = vol === 0
              setMuted(vol === 0)
            }}
            className="h-1 w-16 accent-retro-fg cursor-pointer"
          />
          <button
            type="button"
            aria-label="Detach to picture-in-picture"
            title="Detach (picture-in-picture)"
            onClick={(e) => {
              e.stopPropagation()
              const v = wrapRef.current?.querySelector('video')
              if (!v) return
              if (document.pictureInPictureElement) void document.exitPictureInPicture()
              else void v.requestPictureInPicture().catch(() => {})
            }}
            className="p-2 bg-black/60 text-white/90 hover:text-white cursor-pointer transition-colors duration-150"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={(e) => {
              e.stopPropagation()
              if (document.fullscreenElement) void document.exitFullscreen()
              else void wrapRef.current?.requestFullscreen()
            }}
            className="p-2 bg-black/60 text-white/90 hover:text-white cursor-pointer transition-colors duration-150"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}


