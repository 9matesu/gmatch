'use client'

// One watch-party slot: the video only. Transport lives in the timeline
// overlay; room info lives in the rail. Empty slot = "+ Start playing".

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
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

  const media = useObjectImage(party?.url || null, identity, { enabled: Boolean(party?.url) })
  const src = media.url

  useEffect(() => {
    setVideoSrc(src)
  }, [src])

  // Autoplay-safe start: Chrome only allows unattended play while muted; the
  // timeline volume slider (at 0) is the source of truth.
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
        className="relative aspect-video border border-dashed border-border-glass bg-glass-w5 hover:bg-glass-w10 flex flex-col items-center justify-center gap-2 text-retro-muted transition-colors cursor-pointer"
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
      className={`watch-party-slot relative ${fill ? 'absolute inset-0' : 'aspect-video'} bg-black cursor-pointer ${active ? '' : 'border border-border-glass'}`}
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
    </div>
  )
}
