// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'
import { controlPlayback } from '../../hooks/watchPartyStore'

vi.mock('../../hooks/useObjectImage', () => ({
  useObjectImage: (url: string | null) => ({ url: url || '/api/watchparty/p1/stream' }),
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
  it('single load() per 5s window on error/stalled', () => {
    vi.useFakeTimers()
    mount()
    const v = screen.getByTestId('v') as HTMLVideoElement
    // jsdom media stubs return undefined from play(); the sync tick chains .catch.
    v.play = () => Promise.resolve()
    const loadSpy = vi.spyOn(v, 'load').mockImplementation(() => {})
    v.dispatchEvent(new Event('error'))
    v.dispatchEvent(new Event('stalled'))
    expect(loadSpy).toHaveBeenCalledTimes(1)
    // after the throttle window a new failure recovers again
    vi.advanceTimersByTime(6000)
    v.dispatchEvent(new Event('error'))
    expect(loadSpy).toHaveBeenCalledTimes(2)
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
