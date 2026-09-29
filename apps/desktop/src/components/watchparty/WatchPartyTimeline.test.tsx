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

  it('lifts controls above the pill bar clearance', () => {
    const { container } = render(<WatchPartyTimeline party={sampleParty} />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toMatch(/pb-\[calc\(.*island-clearance.*\)\]/)
  })

  it('handles play/pause toggle clicking controlPlayback', () => {
    // Transport is host-only server-side, so the host is the only identity for
    // which the control does anything.
    render(<WatchPartyTimeline party={sampleParty} isHost />)
    const pauseBtn = screen.getByLabelText('Pause party')
    fireEvent.click(pauseBtn)
    expect(mockControlPlayback).toHaveBeenCalledWith('party-1', 'pause', expect.any(Number))
  })

  it('handles prev and next queue operations', () => {
    render(<WatchPartyTimeline party={sampleParty} isHost />)
    fireEvent.click(screen.getByLabelText('Previous video'))
    expect(mockQueueOp).toHaveBeenCalledWith('party-1', 'prev')

    fireEvent.click(screen.getByLabelText('Next video'))
    expect(mockQueueOp).toHaveBeenCalledWith('party-1', 'next')
  })

  it('disables transport for a non-host and sends nothing when clicked', () => {
    render(<WatchPartyTimeline party={sampleParty} isHost={false} />)
    for (const label of ['Previous video', 'Pause party', 'Next video']) {
      const btn = screen.getByLabelText(label) as HTMLButtonElement
      expect(btn.disabled, label).toBe(true)
    }
    fireEvent.click(screen.getByLabelText('Pause party'))
    expect(mockControlPlayback).not.toHaveBeenCalled()
  })

  it('toggles audio mute and updates volume slider', () => {
    render(<WatchPartyTimeline party={sampleParty} isHost />)
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
