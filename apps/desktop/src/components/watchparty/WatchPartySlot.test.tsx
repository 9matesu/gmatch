// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'
import { controlPlayback } from '../../hooks/watchPartyStore'

vi.mock('../../hooks/useObjectImage', () => ({
  // /api/objects/ rows only render once their bytes are local (swarm); the
  // room's own stream route resolves from the server.
  useObjectImage: (url: string | null) => ({
    url: !url ? '/api/watchparty/p1/stream' : url.startsWith('/api/objects/') ? null : url,
  }),
}))
vi.mock('../../components/media/NativeVideoPlayer', async () => {
  const React = await import('react')
  return {
    NativeVideoPlayer: ({ src }: { src: string }) => React.createElement('video', { 'data-testid': 'v', 'data-src': src }),
  }
})
vi.mock('../../hooks/watchPartyStore', async (io) => {
  const actual = await io<typeof import('../../hooks/watchPartyStore')>()
  return {
    ...actual,
    controlPlayback: vi.fn(),
    serverNow: () => Date.now() / 1000,
    queueOp: vi.fn(),
  }
})

import { WatchPartySlot } from './WatchPartySlot'

afterEach(() => vi.useRealTimers())

/** Make a jsdom <video> look like a loaded, seekable element. */
function stubVideo(v: HTMLVideoElement, opts: { readyState?: number; buffered?: number } = {}) {
  v.play = () => Promise.resolve()
  v.pause = vi.fn()
  Object.defineProperty(v, 'readyState', { configurable: true, value: opts.readyState ?? 4 })
  Object.defineProperty(v, 'seeking', { configurable: true, value: false })
  Object.defineProperty(v, 'buffered', {
    configurable: true,
    value: {
      length: opts.buffered === undefined ? 1 : 1,
      end: () => opts.buffered ?? 1e9,
    },
  })
  return v
}

const party = {
  id: 'p1', name: 'Room', url: 'u', mediaName: '', host: 'me', queue: [], current: '',
  members: [], chat: [], mutedIds: {}, lockVideo: false, isPrivate: false,
  frame: { url: 'u', action: 'play', position: 1, rate: 1, updatedAt: Date.now() / 1000 },
} as unknown as PartyRuntime

function mount(customParty = party) {
  return render(
    <WatchPartySlot
      party={customParty}
      identity={{ orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never}
      active
      onSelect={() => {}}
      onEmptyClick={() => {}}
    />,
  )
}

describe('WatchPartySlot stream recovery', () => {
  it('reloads on error, but never on stalled', () => {
    // `stalled` is Chrome's "asked for data, got nothing" signal = ordinary
    // buffering. It used to trigger load(), which resets currentTime and
    // readyState, so every underrun threw the buffer away and restarted the
    // fetch (once per 5s) — the reason playback never got anywhere on a slow
    // upstream. Only a real error is worth reloading.
    vi.useFakeTimers()
    mount()
    const v = screen.getByTestId('v') as HTMLVideoElement
    v.play = () => Promise.resolve()
    const loadSpy = vi.spyOn(v, 'load').mockImplementation(() => {})

    v.dispatchEvent(new Event('stalled'))
    expect(loadSpy).not.toHaveBeenCalled()

    v.dispatchEvent(new Event('error'))
    expect(loadSpy).toHaveBeenCalledTimes(1)

    // still throttled to one reload per 5s window. The spy is cleared first
    // because advancing the timers also fires the "load while paused" effect
    // (readyState is 0 in jsdom), which is a separate, correct behaviour.
    loadSpy.mockClear()
    v.dispatchEvent(new Event('error'))
    expect(loadSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(6000)
    loadSpy.mockClear()
    v.dispatchEvent(new Event('error'))
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('renders center play button when paused and triggers controlPlayback on click', () => {
    const pausedParty = {
      ...party,
      frame: { ...party.frame, action: 'pause' },
    } as unknown as PartyRuntime

    mount(pausedParty)
    const playBtn = screen.getByLabelText('Play party')
    expect(playBtn).toBeDefined()

    fireEvent.click(playBtn)
    expect(controlPlayback).toHaveBeenCalledWith('p1', 'play', expect.any(Number))
  })

  it('updates video source URL with item parameter when party.current changes', () => {
    const queueParty = {
      ...party,
      url: '/api/watchparty/p1/stream',
      queue: [
        { id: 'item-1', name: 'First', url: '/api/watchparty/p1/stream' },
        { id: 'item-2', name: 'Second', url: '/api/watchparty/p1/stream' },
      ],
      current: 'item-1',
    } as unknown as PartyRuntime

    const { rerender } = mount(queueParty)
    let v = screen.getByTestId('v') as HTMLVideoElement
    expect(v.getAttribute('data-src')).toBe('/api/watchparty/p1/stream?item=item-1')

    // Transition to second item
    const nextParty = {
      ...queueParty,
      current: 'item-2',
    } as unknown as PartyRuntime

    rerender(
      <WatchPartySlot
        party={nextParty}
        identity={{ orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never}
        active
        onSelect={() => {}}
        onEmptyClick={() => {}}
      />,
    )

    v = screen.getByTestId('v') as HTMLVideoElement
    expect(v.getAttribute('data-src')).toBe('/api/watchparty/p1/stream?item=item-2')
  })
})

/**
 * The 250ms sync tick against a real (jsdom) <video>. Nothing tested this
 * before: the old suite mocked the player down to a bare element and never
 * advanced the timer, which is why "the host's pause never lands" shipped.
 */
describe('WatchPartySlot sync tick', () => {
  it("applies the host's pause frame to the element", () => {
    vi.useFakeTimers()
    const paused = {
      ...party,
      frame: { ...party.frame, action: 'pause', position: 12, updatedAt: Date.now() / 1000 },
    } as unknown as PartyRuntime
    mount(paused)
    const v = stubVideo(screen.getByTestId('v') as HTMLVideoElement)
    // Pretend it is currently playing so a pause is actually needed.
    Object.defineProperty(v, 'paused', { configurable: true, value: false })
    vi.advanceTimersByTime(300)
    expect(v.pause).toHaveBeenCalled()
  })

  it('seeks a loaded element to the party position', () => {
    vi.useFakeTimers()
    const seeking = {
      ...party,
      frame: { ...party.frame, action: 'pause', position: 42, updatedAt: Date.now() / 1000 },
    } as unknown as PartyRuntime
    mount(seeking)
    const v = stubVideo(screen.getByTestId('v') as HTMLVideoElement, { readyState: 4 })
    v.currentTime = 3
    Object.defineProperty(v, 'paused', { configurable: true, value: true })
    vi.advanceTimersByTime(300)
    expect(Math.round(v.currentTime)).toBe(42)
  })

  // Regression: with a small buffer the target extrapolates past what has been
  // downloaded, and seeking there restarted the buffer at a further offset —
  // the loop that reads as "it never buffers".
  it('clamps the seek to the buffered range instead of seeking past it', () => {
    vi.useFakeTimers()
    const seeking = {
      ...party,
      frame: { ...party.frame, action: 'pause', position: 900, updatedAt: Date.now() / 1000 },
    } as unknown as PartyRuntime
    mount(seeking)
    const v = stubVideo(screen.getByTestId('v') as HTMLVideoElement, { readyState: 4, buffered: 30 })
    v.currentTime = 0
    Object.defineProperty(v, 'paused', { configurable: true, value: true })
    vi.advanceTimersByTime(300)
    expect(v.currentTime).toBeLessThanOrEqual(30)
  })

  it('does not move the needle while the element is still buffering', () => {
    vi.useFakeTimers()
    const seeking = {
      ...party,
      frame: { ...party.frame, action: 'pause', position: 50, updatedAt: Date.now() / 1000 },
    } as unknown as PartyRuntime
    mount(seeking)
    const v = stubVideo(screen.getByTestId('v') as HTMLVideoElement, { readyState: 1 })
    v.currentTime = 0
    Object.defineProperty(v, 'paused', { configurable: true, value: true })
    vi.advanceTimersByTime(300)
    expect(v.currentTime).toBe(0)
  })

  // Regression: the key used to include party.current, so every "next" rebuilt
  // the <video> and threw away position, volume, mute and the buffer.
  it('keeps the same element across a queue change', () => {
    const queueParty = {
      ...party,
      url: '/api/watchparty/p1/stream',
      queue: [
        { id: 'item-1', name: 'First', url: '/api/watchparty/p1/stream' },
        { id: 'item-2', name: 'Second', url: '/api/watchparty/p1/stream' },
      ],
      current: 'item-1',
    } as unknown as PartyRuntime
    const { rerender } = mount(queueParty)
    const first = screen.getByTestId('v')
    rerender(
      <WatchPartySlot
        party={{ ...queueParty, current: 'item-2' } as unknown as PartyRuntime}
        identity={{ orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never}
        active
        onSelect={() => {}}
        onEmptyClick={() => {}}
      />,
    )
    expect(screen.getByTestId('v')).toBe(first)
  })
})

/**
 * A consent-shared local file only lives on the sharer (+ whoever fetched it).
 * The room used a 5s swarm window and nothing else, so a peer's tile sat on a
 * black box while the bytes were one explicit transfer away.
 */
describe('WatchPartySlot shared local media', () => {
  const sharedParty = {
    ...party,
    url: '/api/watchparty/p1/stream',
    queue: [
      {
        id: 'aaaaaaaa',
        name: 'movie.mp4',
        url: '/api/objects/11111111-2222-3333-4444-555555555555',
        local: true,
        thumb: '/api/objects/22222222-3333-4444-5555-666666666666',
      },
    ],
    current: 'aaaaaaaa',
  } as unknown as PartyRuntime

  it('auto-starts the transfer and explains it instead of a dead player', async () => {
    mount(sharedParty)
    const notice = await screen.findByText(
      /Waiting for the sharer|Receiving from the sharer|Transfer failed/,
    )
    expect(notice).toBeDefined()
  })

  it('never shows transfer UI for an ordinary remote entry', () => {
    mount()
    expect(screen.queryByText(/Waiting for the sharer/)).toBeNull()
    expect(screen.queryByText(/Receiving from the sharer/)).toBeNull()
    expect(screen.queryByText('Retry transfer')).toBeNull()
  })
})
