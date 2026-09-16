// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'

vi.mock('../../hooks/useObjectImage', () => ({
  useObjectImage: () => ({ url: '/api/watchparty/p1/stream' }),
}))
vi.mock('../../components/media/NativeVideoPlayer', async () => {
  const React = await import('react')
  return {
    NativeVideoPlayer: () => React.createElement('video', { 'data-testid': 'v' }),
  }
})
vi.mock('../../hooks/watchPartyStore', async (io) => {
  const actual = await io<typeof import('../../hooks/watchPartyStore')>()
  return {
    ...actual,
    useObjectImage: () => ({ url: '/x' }),
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

function mount() {
  return render(
    <WatchPartySlot
      party={party}
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
})
