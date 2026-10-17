'use client'

// One watch-party slot: the video player viewport. Transport lives in the
// timeline overlay; room info lives in the rail. Empty slot = "+ Start playing".

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import { NativeVideoPlayer } from '../media/NativeVideoPlayer'
import { useObjectImage } from '../../hooks/useObjectImage'
import { controlPlayback, serverNow, queueOp, type PartyRuntime } from '../../hooks/watchPartyStore'
import { isVerified, signalLocalReady } from '../../hooks/watchLocalShare'
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
  // Entries this slot already claimed readiness for: one signal per entry,
  // only after local bytes verified (never on a bare successful resolve).
  const readySentRef = useRef<Set<string>>(new Set())
  // Set when the slot's END handling pauses the element (sync tick) or the
  // video ends natively. The resulting 'pause' must NOT echo to the room:
  // arriving after the host's 'next' frame it would pause the room at the
  // start of the next video (the "autoplay skips/holds" report).
  const endPauseRef = useRef(0)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)

  // Determine current playing item's URL from queue or fallback to party.url
  const currentItem = party?.queue.find((q) => q.id === party?.current)
  const currentUrl = currentItem?.url || party?.url || null

  // Ensure stream URLs always include the item ID so:
  // 1. Each queue item has a distinct URL, preventing browser Range caching of previous videos
  // 2. Switching videos triggers videoSrc change and cleanly remounts NativeVideoPlayer
  // 3. Both local and remote Fly API endpoints know which video item is requested
  const targetMediaUrl = useMemo(() => {
    if (!currentUrl) return null
    if (currentUrl.includes('/stream')) {
      const itemId = party?.current || currentItem?.id
      if (itemId && !currentUrl.includes('item=')) {
        const sep = currentUrl.includes('?') ? '&' : '?'
        return `${currentUrl}${sep}item=${encodeURIComponent(itemId)}`
      }
    }
    return currentUrl
  }, [currentUrl, party?.current, currentItem?.id])

  const media = useObjectImage(targetMediaUrl, identity, { enabled: Boolean(targetMediaUrl) })
  const src = media.url

  useEffect(() => {
    setVideoSrc(src)
    // Announce the (re)created element so the transport bar can re-apply the
    // remembered per-room volume to the NEW <video>, not the discarded one.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('watch-video-element', { detail: { src } }))
    }
    // Local-file readiness: claim it only when THIS client verified the bytes
    // (own share or hash-checked transfer). Resolving alone is not proof.
    if (src && party && currentItem?.hash) {
      const objectId = (/\/api\/objects\/([0-9a-fA-F-]{36})/.exec(currentItem.url || '') || [])[1]
      if (!readySentRef.current.has(currentItem.id) && isVerified(objectId, currentItem.hash)) {
        readySentRef.current.add(currentItem.id)
        signalLocalReady(party.id, currentItem.id, currentItem.hash)
      }
    }
  }, [src])

  // Autoplay-safe start: Chrome only allows unattended play() while muted, so
  // a party that opens already-playing must start muted or the host's play
  // frame is rejected. Volume/mute ownership is reconciled in Step 4 (the
  // timeline owns it); this only guarantees the element can start at all.
  useEffect(() => {
    const v = wrapRef.current?.querySelector('video')
    if (v) v.muted = true
  }, [videoSrc])

  // Start loading the media even while the room is PAUSED, and honour an
  // already-playing frame on arrival. Without this the element sat at
  // readyState 0: rooms are created with action:'pause', the tick only calls
  // play() when the frame says 'play', and nothing else ever kicked off
  // resource selection — so "the video is not buffering" (no data, and no
  // spinner either, because a spinner needs a request in flight).
  useEffect(() => {
    if (!videoSrc) return
    // NativeVideoPlayer's own load() effect covers the first commit; this
    // covers arriving at an already-playing room and a src swap.
    const id = setTimeout(() => {
      const v = wrapRef.current?.querySelector('video')
      if (!v) return
      if (v.readyState === 0) {
        try { v.load() } catch { /* not ready */ }
      }
      if (party?.frame?.action === 'play' && v.paused) void v.play().catch(() => { })
    }, 0)
    return () => clearTimeout(id)
  }, [videoSrc, party?.frame?.action])

  // The sync tick reads the frame through a ref. It used to list
  // `party?.frame` in its dependency array, and every inbound watch.sync /
  // watch.roster / watch.queue replaces that with a freshly parsed object — so
  // the interval was destroyed and recreated on every frame, resetting the
  // 250ms phase and starving the reconciler during chat/roster traffic.
  const frameRef = useRef(party?.frame ?? null)
  frameRef.current = party?.frame ?? null

  // 250 ms sync tick, only while a party exists. The video element is read
  // imperatively from the DOM: NativeVideoPlayer keeps it in its own ref.
  useEffect(() => {
    if (!videoSrc) return
    const timer = setInterval(() => {
      const v = wrapRef.current?.querySelector('video')
      const frame = frameRef.current
      if (!v || !frame || !videoSrc || !party) return
      const target = computeTargetPosition(frame, serverNow())
      if (v.duration > 0 && target >= v.duration - 0.25 && frame.action === 'play') {
        // Video ended: the host advances the queue. Keyed by media+frame
        // stamp so a wrap back to the same entry re-arms the guard.
        if (!v.paused) { endPauseRef.current = Date.now(); v.pause() }
        const endedKey = `${party.current}:${frame.updatedAt}`
        if (shouldFireQueueNext({
          isHost: party.host === identity.orbitId,
          queueLength: party.queue.length,
          action: frame.action,
          endedKey,
          lastFiredKey: endedRef.current,
        })) {
          endedRef.current = endedKey
          queueOp(party.id, 'next')
        }
        return
      }
      const localPlaying = !v.paused
      const plan = driftCorrection(v.currentTime, target, localPlaying, frame.action)
      // Buffering must never move the needle: seeking into a stalled element
      // just restarts the buffer (the lurching-playhead report). Transport
      // (play/pause) still applies; the next data-rich tick re-seeks once.
      const buffering = v.seeking || v.readyState < 3
      if (plan.seekTo !== null && !buffering) {
        // Clamp to what is actually buffered. Without this, a stalled element
        // gets seeked to a target that grows without bound (the extrapolation
        // keeps adding elapsed time), which restarts the buffer at an even more
        // distant offset — the seek/underrun loop that reads as "never buffers".
        // With nothing buffered yet, seek anyway: the element then buffers from
        // the right place instead of from 0.
        const bufEnd = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0
        v.currentTime = bufEnd > 0 ? Math.min(plan.seekTo, bufEnd) : plan.seekTo
      }
      if (plan.play && v.paused) void v.play().catch(() => {})
      if (plan.pause && !v.paused) v.pause()
    }, 250)
    return () => clearInterval(timer)
  }, [party?.id, videoSrc, party?.current, party?.host, party?.queue.length, identity.orbitId])

  // Stream hiccup recovery. Only a real `error` is worth reloading the
  // element: `stalled` is Chrome's "I asked for data and got nothing" signal,
  // i.e. ORDINARY buffering, and load() resets currentTime and readyState — so
  // treating `stalled` as fatal threw away the buffer on every underrun and
  // restarted the fetch (up to once per 5s), which is exactly why playback
  // never got anywhere on a slow upstream. One shot per 5s so a dead URL
  // cannot spin the network.
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
    }
    // The <video> mounts inside NativeVideoPlayer; give it a tick to exist.
    const probe = setInterval(attach, 500)
    attach()
    return () => {
      clearInterval(probe)
      const v = wrapRef.current?.querySelector('video')
      if (v && recover) {
        v.removeEventListener('error', recover)
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

  const isPlaying = party.frame?.action === 'play'

  // Live element diagnostics, sampled only while there is nothing to show. This
  // is what distinguishes "never requested anything" (readyState 0 /
  // networkState 0) from "downloading" (1/2) from "buffered" (3/4) — the single
  // measurement that splits the "the video is not buffering" report in half.
  const [diag, setDiag] = useState<string | null>(null)
  useEffect(() => {
    if (videoSrc) {
      setDiag(null)
      return
    }
    const id = setInterval(() => {
      const v = wrapRef.current?.querySelector('video')
      if (!v) return
      setDiag(`readyState ${v.readyState} · networkState ${v.networkState} · src ${v.currentSrc ? v.currentSrc.slice(0, 48) : 'none'}`)
    }, 1000)
    return () => clearInterval(id)
  }, [videoSrc, media.failed])

  const togglePlayback = () => {
    const v = wrapRef.current?.querySelector('video')
    const pos = v ? v.currentTime : 0
    controlPlayback(party.id, isPlaying ? 'pause' : 'play', pos)
  }

  return (
    <div
      ref={wrapRef}
      data-active={active ? 'true' : 'false'}
      onClick={onSelect}
      className={`watch-party-slot relative ${fill ? 'w-full h-full' : 'aspect-video'} bg-black cursor-pointer overflow-hidden flex items-center justify-center ${
        active ? '' : 'border border-border-glass'
      }`}
    >
      {videoSrc ? (
        <>
          <NativeVideoPlayer
            // Keyed on the ROOM, never on the media. It used to be
            // `${videoSrc}:${party.current}`, so every "next" built a brand new
            // <video> — discarding position, volume, mute, buffered range and
            // readyState together. Worse, for /api/objects/ media the src
            // transiently resolves to null during the swap, which UNMOUNTED the
            // element and made the 250ms tick below return early, so the whole
            // slot went inert until it remounted. A <video> resets and reloads
            // on its own when src changes; NativeVideoPlayer resets its state on
            // resolvedSrc and calls load().
            key={party.id}
            src={videoSrc}
            preload="auto"
            disableViewportGating={true}
            loop={false}
            autoPlay={false}
            controls={false}
            showFullscreenButton={false}
            showPipButton={false}
            showSpeedButton={false}
            showLoopButton={false}
            onPlay={() => {
              // Host-only: a viewer's local play/pause is a client-side echo,
              // and broadcasting it dragged the whole room. The server refuses
              // it now too; not sending it avoids a pointless round trip.
              if (party.host !== identity.orbitId) return
              const v = wrapRef.current?.querySelector('video')
              controlPlayback(party.id, 'play', v ? v.currentTime : 0)
            }}
            onPause={() => {
              // End-of-video pauses are local: echoing them races the host's
              // 'next' frame and pauses the room at the next video's start.
              if (Date.now() - endPauseRef.current < 2000) return
              if (party.host !== identity.orbitId) return
              const v = wrapRef.current?.querySelector('video')
              controlPlayback(party.id, 'pause', v ? v.currentTime : 0)
            }}
            className="w-full h-full object-contain"
          />

          {/* Big Center Play Button when paused */}
          {!isPlaying && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 transition-opacity duration-300"
            >
              <button
                type="button"
                aria-label="Play party"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlayback()
                }}
                className="pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/60 hover:bg-black/80 border border-border-glass text-white flex items-center justify-center shadow-lg transition-transform duration-150 active:scale-95 cursor-pointer"
              >
                <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white text-white translate-x-0.5" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
          <span className="text-[10px] uppercase tracking-wider text-retro-muted">
            {media.failed ? 'Media unavailable' : 'Loading...'}
          </span>
          {/* Say WHY, not just that it failed. "Media unavailable" is
              indistinguishable between a 404, a refused SSRF probe, a
              truncated relay and a 20-minute fetch, which made this impossible
              to diagnose from the UI. The real element state is right here. */}
          {diag && (
            <span
              className="text-[9px] font-mono text-retro-muted/70 tabular-nums"
              data-testid="watch-media-diag"
              title="readyState / networkState — 0 = nothing requested, 1 = loading, 4 = enough data"
            >
              {diag}
            </span>
          )}
          {media.failed && !diag && (
            <span className="text-[9px] font-mono text-retro-muted/70">{videoSrc?.slice(0, 60)}</span>
          )}
        </div>
      )}
    </div>
  )
}
