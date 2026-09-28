# Watch Tab Viewer/Player Layout & Video Player Modernization Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the Watch tab and timeline into a proper, compact video player per `docs/DESIGN.md` by unifying video controls into grouped clusters, replacing the single-line stretched layout with a standard 2-tier control bar, and fixing the viewer/rail flex layout to eliminate dead space and prevent rail overlays.

**Architecture:** Refactor `WatchPartyTimeline.tsx` into a 2-tier video player controller (tier 1: full-width scrubber with hover timestamp preview; tier 2: grouped transport/volume/time on left, panel/pip/fullscreen on right, overlaid on a bottom gradient scrim). In `WatchPartyView.tsx`, transition room mode to a clean flex-row layout where the video player occupies `flex-1 min-w-0` and the side rail docks beside it without obscuring video content, while browse mode centers the room list and drops the empty placeholder rail.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (gMatch design tokens), Vitest + React Testing Library, Lucide icons.

---

## Current Context / Assumptions

- Repo: `I:/goongrid`, package `@gmatch/desktop` under `apps/desktop`.
- Design system: `docs/DESIGN.md` (Monochrome Slate HUD) + `apps/desktop/design-gates.sh` (must report 0 violations).
- Existing flaws:
  1. `WatchPartyTimeline.tsx` is a single horizontal flex line (`inset-x-0 bottom-[var(--island-clearance)]`) where a stretched `<input type="range">` separates left transport controls (Prev/Play/Next/CurrentTime) from right controls (Duration/Volume/PiP/Fullscreen) by up to 1600px.
  2. `WatchPartyTimeline.tsx` lacks a mute toggle button, lacks a hover time tooltip, splits current time from total duration across the scrubber, has no background scrim (bare text-shadow on video), and is pushed 76px up by `--island-clearance` even though `CommandIsland` is recessed to 8% opacity in Watch tab.
  3. `WatchPartyView.tsx` in room mode renders the chat/queue rail as an `absolute inset-y-0 right-0 z-20` overlay that covers 288px of the video player and hides player controls underneath it.
  4. `WatchPartyView.tsx` in browse mode (`parties.length === 0`) renders an empty, disabled `<aside>` showing "No room open" alongside the room list, squishing the list and cluttering the tab.
  5. The rail toggle button was an invisible hover button at `top-3 right-2` rather than an integrated player control.

---

## Step-by-Step Tasks

### Task 1: Write Unit Tests for Proper Video Player Controls in `WatchPartyTimeline.test.tsx`

**Objective:** Create comprehensive unit tests verifying the 2-tier video player control bar, button groupings, volume mute toggling, time formatting, and rail toggle action.

**Files:**
- Create: `apps/desktop/src/components/watchparty/WatchPartyTimeline.test.tsx`

**Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'

const mockControlPlayback = vi.fn()
const mockQueueOp = vi.fn()

vi.mock('../../hooks/watchPartyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/watchPartyStore')>()
  return {
    ...actual,
    controlPlayback: (...args: unknown[]) => mockControlPlayback(...args),
    queueOp: (...args: unknown[]) => mockQueueOp(...args),
    serverNow: () => 100,
  }
})

import { WatchPartyTimeline } from './WatchPartyTimeline'

describe('WatchPartyTimeline Component', () => {
  const sampleParty = {
    id: 'party-1',
    name: 'Anime Night',
    url: 'https://example.com/video.mp4',
    mediaName: 'Episode 01',
    host: 'user-host',
    queue: [{ id: 'q1', url: 'u1' }],
    current: 'q1',
    members: [{ id: 'user-host', name: 'Host' }],
    chat: [],
    mutedIds: {},
    lockVideo: false,
    isPrivate: false,
    frame: { url: 'u1', action: 'play', position: 30, rate: 1, updatedAt: 100 },
  } as unknown as PartyRuntime

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div class="watch-party-slot" data-active="true">
        <video src="https://example.com/video.mp4"></video>
      </div>
    `
    const v = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(v, 'duration', { value: 120, writable: true })
    Object.defineProperty(v, 'currentTime', { value: 30, writable: true })
    Object.defineProperty(v, 'volume', { value: 1, writable: true })
    Object.defineProperty(v, 'muted', { value: false, writable: true })
  })

  it('renders all player control clusters (transport, volume, time, and view controls)', () => {
    render(<WatchPartyTimeline party={sampleParty} onToggleRail={() => {}} railOpen={false} />)

    expect(screen.getByLabelText('Previous video')).toBeDefined()
    expect(screen.getByLabelText('Pause party')).toBeDefined()
    expect(screen.getByLabelText('Next video')).toBeDefined()
    expect(screen.getByLabelText('Mute')).toBeDefined()
    expect(screen.getByLabelText('Volume')).toBeDefined()
    expect(screen.getByText('0:30')).toBeDefined()
    expect(screen.getByText('2:00')).toBeDefined()
    expect(screen.getByLabelText('Toggle side panel')).toBeDefined()
    expect(screen.getByLabelText('Detach to picture-in-picture')).toBeDefined()
    expect(screen.getByLabelText('Fullscreen')).toBeDefined()
  })

  it('handles play/pause toggle clicking controlPlayback', () => {
    render(<WatchPartyTimeline party={sampleParty} />)
    const pauseBtn = screen.getByLabelText('Pause party')
    fireEvent.click(pauseBtn)
    expect(mockControlPlayback).toHaveBeenCalledWith('party-1', 'pause', expect.any(Number))
  })

  it('handles prev and next queue operations', () => {
    render(<WatchPartyTimeline party={sampleParty} />)
    fireEvent.click(screen.getByLabelText('Previous video'))
    expect(mockQueueOp).toHaveBeenCalledWith('party-1', 'prev')

    fireEvent.click(screen.getByLabelText('Next video'))
    expect(mockQueueOp).toHaveBeenCalledWith('party-1', 'next')
  })

  it('toggles audio mute and updates volume slider', () => {
    render(<WatchPartyTimeline party={sampleParty} />)
    const muteBtn = screen.getByLabelText('Mute')
    fireEvent.click(muteBtn)

    const v = document.querySelector('video') as HTMLVideoElement
    expect(v.muted).toBe(true)
    expect(v.volume).toBe(0)

    // Second click unmutes
    fireEvent.click(screen.getByLabelText('Unmute'))
    expect(v.muted).toBe(false)
    expect(v.volume).toBe(1)
  })

  it('triggers onToggleRail when side panel button is clicked', () => {
    const toggleSpy = vi.fn()
    render(<WatchPartyTimeline party={sampleParty} onToggleRail={toggleSpy} railOpen={false} />)
    fireEvent.click(screen.getByLabelText('Toggle side panel'))
    expect(toggleSpy).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2: Run test to verify failure**

Run: `npm --workspace=@gmatch/desktop test src/components/watchparty/WatchPartyTimeline.test.tsx`
Expected: FAIL — "Unable to find a label to match: Mute" or "Toggle side panel"

---

### Task 2: Implement Proper Video Player Controls in `WatchPartyTimeline.tsx`

**Objective:** Replace the stretched 1-line timeline with a compact 2-tier video player controller (full-width scrubber with hover time tooltip on top; grouped transport, volume with mute toggle, time readout, and view controls on bottom) with a bottom gradient scrim.

**Files:**
- Modify: `apps/desktop/src/components/watchparty/WatchPartyTimeline.tsx`

**Step 1: Implement the new 2-tier player controls**

Replace the contents of `apps/desktop/src/components/watchparty/WatchPartyTimeline.tsx`:

```tsx
'use client'

// Transport overlay for the ACTIVE party slot: 2-tier player layout.
// Tier 1: Full-width precision scrubber with hover timestamp preview and buffer indication.
// Tier 2: Left cluster (Prev/Play/Next, Volume icon + slider, Time), Right cluster (Rail toggle, PiP, Fullscreen).
// Overlaid on a bottom gradient scrim per DESIGN.md.

import { useEffect, useRef, useState, useCallback } from 'react'
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

  // Volume state: defaults to 0 to mirror autoplay-safe start.
  const [volume, setVolume] = useState(0)
  const [prevVolume, setPrevVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(true)

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
      if (el.buffered.length > 0) {
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
      setPrevVolume(volume)
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
      className={`absolute bottom-0 inset-x-0 z-20 flex flex-col justify-end pt-10 pb-3 px-3 sm:px-4 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 select-none ${
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
            className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-black/90 border border-white/20 text-[10px] font-mono font-bold text-white shadow-lg pointer-events-none whitespace-nowrap"
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
```

**Step 2: Run test to verify pass**

Run: `npm --workspace=@gmatch/desktop test src/components/watchparty/WatchPartyTimeline.test.tsx`
Expected: PASS (5 passed)

**Step 3: Commit**

```bash
git add apps/desktop/src/components/watchparty/WatchPartyTimeline.tsx apps/desktop/src/components/watchparty/WatchPartyTimeline.test.tsx
git commit -m "feat(watchparty): modernize timeline into 2-tier video player per design.md"
```

---

### Task 3: Refactor `WatchPartyView.tsx` Layout to Dock Rail and Center Browse Mode

**Objective:** Clean up the Watch tab layout: dock the rail in-flow alongside the player (preventing video overlay/cropping), pass rail controls to `WatchPartyTimeline`, and present browse mode in a clean centered card without the empty placeholder rail.

**Files:**
- Modify: `apps/desktop/src/components/watchparty/WatchPartyView.tsx`

**Step 1: Update `WatchPartyView.tsx` layout**

Replace `apps/desktop/src/components/watchparty/WatchPartyView.tsx`:

```tsx
'use client'

// Watch tab: in a room the video viewer and docked side rail fit neatly side-by-side.
// When the rail is toggled off, the video expands to 100% width.
// Browse mode (no active room) renders a centered room list card without empty chat clutter.

import { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { Avatar } from '../Avatar'
import { MUTED } from '../../ui/styles'
import { useWatchParty, joinPartyById, MAX_SLOTS } from '../../hooks/watchPartyStore'
import { watchRoomFromHash, stripWatchRoom } from './invite'
import { WatchPartySlot } from './WatchPartySlot'
import { WatchPartyTimeline } from './WatchPartyTimeline'
import { WatchPartyChat } from './WatchPartyChat'
import { WatchPartyQueue } from './WatchPartyQueue'
import { WatchPartyRoomList } from './WatchPartyRoomList'
import { WatchPartyUrlModal } from './WatchPartyUrlModal'
import { WatchRoomHeader } from './WatchRoomHeader'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyView({ identity, profilePics }: { identity: IdentityLike; profilePics: Record<string, string> }) {
  const { parties, kickedNotice } = useWatchParty()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const active = parties.find((p) => p.id === activeId) || parties[parties.length - 1] || null
  const isHost = active?.host === identity.orbitId

  // Deep link joining
  useEffect(() => {
    const tryJoin = () => {
      const roomId = watchRoomFromHash(window.location.hash)
      if (!roomId) return
      window.history.replaceState(null, '', stripWatchRoom(window.location.hash))
      void joinPartyById(identity, roomId)
    }
    tryJoin()
    window.addEventListener('hashchange', tryJoin)
    return () => window.removeEventListener('hashchange', tryJoin)
  }, [identity])

  const inRoom = parties.length > 0

  // BROWSE MODE: Clean centered card layout without empty dead rail
  if (!inRoom) {
    return (
      <div className="p-3 sm:p-6 h-full flex-1 flex flex-col items-center justify-center min-h-0 overflow-y-auto">
        <div className="w-full max-w-xl glass-card overflow-hidden flex flex-col my-auto max-h-[85vh]">
          <div className="glass-header flex items-center justify-between px-4 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg flex items-center gap-2">
              <Clapperboard className="w-4 h-4" />
              Watch
            </h3>
          </div>
          <WatchPartyRoomList identity={identity} onNewParty={() => setModalOpen(true)} kickedNotice={kickedNotice} />
        </div>

        {modalOpen && (
          <WatchPartyUrlModal
            identity={identity}
            onClose={() => setModalOpen(false)}
            joinPartyId={null}
            queueMode={false}
          />
        )}
      </div>
    )
  }

  // ROOM MODE: Full-bleed theater layout with video viewer and docked side rail
  return (
    <div className="group/watch relative h-full flex-1 flex flex-row min-h-0 overflow-hidden bg-black">
      {/* Video Viewer Container: takes remaining width, resizes automatically */}
      <div className="flex-1 min-w-0 min-h-0 relative flex flex-col bg-black overflow-hidden">
        {parties.length === 1 ? (
          <WatchPartySlot
            party={parties[0]}
            identity={identity}
            active
            fill
            onSelect={() => {}}
            onEmptyClick={() => setModalOpen(true)}
          />
        ) : (
          <div className="grid grid-cols-2 h-full min-h-0 place-items-center gap-2 p-2">
            {Array.from({ length: MAX_SLOTS }, (_, i) => {
              const party = parties[i] || null
              return (
                <WatchPartySlot
                  key={party ? party.id : `empty-${i}`}
                  party={party}
                  identity={identity}
                  active={active?.id === party?.id && party !== null}
                  onSelect={() => party && setActiveId(party.id)}
                  onEmptyClick={() => setModalOpen(true)}
                />
              )
            })}
          </div>
        )}

        {/* Cohesive Video Player Controls */}
        <WatchPartyTimeline
          party={active}
          onToggleRail={() => setRailOpen((v) => !v)}
          railOpen={railOpen}
        />
      </div>

      {/* Docked Side Rail (Room info + Participants + Queue + Chat) */}
      <aside
        className={`w-72 lg:w-80 shrink-0 h-full flex-col min-h-0 overflow-hidden border-l border-border-glass bg-retro-panel z-20 ${
          railOpen ? 'flex animate-orbit-fade-in' : 'hidden'
        }`}
      >
        {active && <WatchRoomHeader party={active} identity={identity} profilePics={profilePics} />}

        <div className="flex items-start justify-between gap-2 px-3 py-1.5 border-b border-border-glass">
          <p className="text-[10px] font-bold uppercase tracking-wider text-retro-fg">In this room</p>
        </div>

        {active && active.members.length > 0 && (
          <ul className="px-3 py-2 space-y-1.5 border-b border-border-glass max-h-36 overflow-y-auto styled-scrollbar">
            {active.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Avatar id={m.id} size={18} imageUrl={profilePics[m.id] || null} />
                <span className="text-xs text-retro-fg truncate flex-1">{m.name || m.id}</span>
                {m.muted ? <span className={`text-[10px] uppercase tracking-wider ${MUTED}`}>muted</span> : null}
                {m.id === active.host && <span className="text-[10px] uppercase tracking-wider text-retro-muted">host</span>}
                {m.id === identity.orbitId && <span className="text-[10px] uppercase tracking-wider text-retro-muted">you</span>}
              </li>
            ))}
          </ul>
        )}

        {active && <WatchPartyQueue party={active} identity={identity} />}
        <WatchPartyChat party={active} profilePics={profilePics} myId={identity.orbitId} isHost={isHost} />
      </aside>

      {modalOpen && (
        <WatchPartyUrlModal
          identity={identity}
          onClose={() => setModalOpen(false)}
          joinPartyId={active?.id || null}
          queueMode
          lockVideo={Boolean(active?.lockVideo) && !isHost}
        />
      )}
    </div>
  )
}
```

**Step 2: Run tests to verify pass**

Run: `npm --workspace=@gmatch/desktop test src/components/watchparty`
Expected: PASS (all watchparty test files green)

**Step 3: Commit**

```bash
git add apps/desktop/src/components/watchparty/WatchPartyView.tsx
git commit -m "fix(watchparty): dock side rail in flex layout and center browse mode"
```

---

### Task 4: Enhance `WatchPartySlot.tsx` with Big Center Play Indicator and Click-to-Play

**Objective:** Add big center play button when paused and clean canvas click-to-play so the slot behaves like a polished modern video player.

**Files:**
- Modify: `apps/desktop/src/components/watchparty/WatchPartySlot.tsx`

**Step 1: Update `WatchPartySlot.tsx`**

Ensure `WatchPartySlot.tsx` cleanly supports play/pause on canvas click and displays a centered play button when paused:

```tsx
'use client'

// One watch-party slot: the video player viewport. Transport lives in the
// timeline overlay; room info lives in the rail. Empty slot = "+ Start playing".

import { useEffect, useRef, useState } from 'react'
import { Play, Plus } from 'lucide-react'
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
  const endPauseRef = useRef(0)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)

  const media = useObjectImage(party?.url || null, identity, { enabled: Boolean(party?.url) })
  const src = media.url

  useEffect(() => {
    setVideoSrc(src)
  }, [src])

  // Autoplay-safe start: Chrome only allows unattended play while muted
  useEffect(() => {
    const v = wrapRef.current?.querySelector('video')
    if (v) v.muted = true
  }, [videoSrc])

  // 250 ms sync tick
  useEffect(() => {
    if (!party?.frame || !videoSrc) return
    const timer = setInterval(() => {
      if (document.hidden) return
      const v = wrapRef.current?.querySelector('video')
      if (!v || !party.frame || !videoSrc) return
      const target = computeTargetPosition(party.frame, serverNow())
      if (v.duration > 0 && target >= v.duration - 0.25 && party.frame.action === 'play') {
        if (!v.paused) { endPauseRef.current = Date.now(); v.pause() }
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
      const buffering = v.seeking || v.readyState < 3
      if (plan.seekTo !== null && !buffering) v.currentTime = plan.seekTo
      if (plan.play && v.paused) void v.play().catch(() => {})
      if (plan.pause && !v.paused) v.pause()
    }, 250)
    return () => clearInterval(timer)
  }, [party?.id, videoSrc, party?.frame])

  // Stream hiccup recovery
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

  const isPlaying = party.frame?.action === 'play'

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
              if (Date.now() - endPauseRef.current < 2000) return
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
                className="pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center shadow-2xl transition-transform duration-150 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white text-white translate-x-0.5" />
              </button>
            </div>
          )}
        </>
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
```

**Step 2: Run test to verify pass**

Run: `npm --workspace=@gmatch/desktop test src/components/watchparty/WatchPartySlot.test.tsx`
Expected: PASS (1 passed)

**Step 3: Commit**

```bash
git add apps/desktop/src/components/watchparty/WatchPartySlot.tsx
git commit -m "feat(watchparty): add big center play button and clean player sizing"
```

---

### Task 5: Run Full Verification & Design Gate Audits

**Objective:** Verify that all watchparty tests pass, design gates show 0 regressions, eslint passes on touched files, and typescript check is clean.

**Steps:**
1. Run Vitest on all watchparty tests:
   `npm --workspace=@gmatch/desktop test src/components/watchparty`
   Expected: 5 passed (18+ tests total).
2. Run TypeScript check:
   `npm --workspace=@gmatch/desktop run typecheck`
   Expected: Exit code 0, no errors.
3. Run ESLint on watchparty directory:
   `cd apps/desktop && npx eslint src/components/watchparty`
   Expected: Exit code 0, 0 errors, 0 warnings.
4. Run design system acceptance gates:
   `bash apps/desktop/design-gates.sh`
   Expected: 0 violations for borders, 3+ digit z-indexes, off-scale typography, glow shadows, unexempt hex colors, and emoji chrome.

---

## Tests & Validation Strategy

1. **TDD Cycle:**
   - Write unit test `apps/desktop/src/components/watchparty/WatchPartyTimeline.test.tsx` first.
   - Verify initial test fails against old implementation.
   - Implement modernized `WatchPartyTimeline.tsx`.
   - Verify test suite passes green.
2. **Layout & Visual Verification:**
   - Room Mode: Video fills main area; side rail docks alongside without obscuring video; controls sit at the bottom of the video player without awkward 76px clearance gap.
   - Browse Mode: Room list is centered in a neat `max-w-xl glass-card`; no dead "No room open" sidebar.
   - Responsive & Interactions: Hovering video shows gradient scrim and controls smoothly; scrubber scrubbing dispatches `controlPlayback`; volume slider and mute toggle interact accurately with the `<video>` element.

---

## Risks, Tradeoffs, and Open Questions

1. **CommandIsland Clearance in Room Mode:**
   - *Risk:* In room mode, `CommandIsland` is recessed to opacity 0.08, but still physically located at `bottom-5 left-1/2`.
   - *Mitigation:* The 2-tier controls bar places transport/volume controls on the left and panel/fullscreen controls on the right. The center horizontal space is open, preventing accidental clicks on the recessed island while scrubbing or controlling playback.
2. **Video Aspect Ratio in Docked Mode:**
   - *Decision:* Using standard flex-row (`flex-1 min-w-0` with `object-contain`) allows videos of any aspect ratio (16:9, 4:3, 9:16 vertical) to automatically letterbox and fit without cropping when the rail toggles.
