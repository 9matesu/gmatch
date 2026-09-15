'use client'

// One watch-party slot: dashed "+" placeholder when empty, a sync-driven
// NativeVideoPlayer when filled. Transport belongs to the party, so all the
// player's own controls are hidden; mute stays local.

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { NativeVideoPlayer } from '../media/NativeVideoPlayer'
import { useObjectImage } from '../../hooks/useObjectImage'
import { controlPlayback, serverNow, type PartyRuntime } from '../../hooks/watchPartyStore'
import { computeTargetPosition, driftCorrection } from '../../utils/watchSync'

export function WatchPartySlot({
  party,
  identity,
  active,
  onSelect,
  onEmptyClick,
}: {
  party: PartyRuntime | null
  identity: { orbitId: string; publicKeyHex: string; privateKeyHex: string }
  active: boolean
  onSelect: () => void
  onEmptyClick: () => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const lastActionRef = useRef<string | null>(null)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)

  const media = useObjectImage(party?.url || null, identity, { enabled: Boolean(party?.url) })
  const src = media.url

  useEffect(() => {
    setVideoSrc(src)
  }, [src])

  // 250 ms sync tick, only while a party exists. The video element is read
  // imperatively from the DOM: NativeVideoPlayer keeps it in its own ref.
  useEffect(() => {
    if (!party?.frame || !videoSrc) return
    const timer = setInterval(() => {
      if (document.hidden) return
      const v = wrapRef.current?.querySelector('video')
      if (!v || !party.frame || !videoSrc) return
      applyPartyFrame(v, party.frame, lastActionRef)
    }, 250)
    return () => clearInterval(timer)
  }, [party?.id, videoSrc, party?.frame])

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
      className={`watch-party-slot relative aspect-video rounded-lg overflow-hidden bg-black cursor-pointer ${active ? 'ring-1 ring-retro-fg' : 'border border-border-glass'}`}
    >
      {videoSrc ? (
        <NativeVideoPlayer
          key={videoSrc}
          src={videoSrc}
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
      <span className="absolute top-1 left-2 text-[10px] font-bold uppercase tracking-wider text-white/70 pointer-events-none drop-shadow">
        {party.name}
      </span>
    </div>
  )
}

/** Apply the party frame to a local <video>: follow action, correct drift. */
function applyPartyFrame(
  v: HTMLVideoElement,
  frame: { action: 'play' | 'pause'; position: number; rate: number; updatedAt: number },
  lastActionRef: { current: string | null },
): void {
  const target = computeTargetPosition(frame as never, serverNow())
  if (v.duration > 0 && target >= v.duration - 0.25 && frame.action === 'play') {
    // party video ended: park paused at the end (no loop in V1)
    if (!v.paused) v.pause()
    return
  }
  const localPlaying = !v.paused
  const plan = driftCorrection(v.currentTime, target, localPlaying, frame.action)
  if (plan.seekTo !== null) v.currentTime = plan.seekTo
  if (plan.play && v.paused) {
    // Autoplay policy: a joined slot may not start until first interaction;
    // a rejected play() just retries on the next tick.
    void v.play().catch(() => {})
  }
  if (plan.pause && !v.paused) v.pause()
  lastActionRef.current = frame.action
}
