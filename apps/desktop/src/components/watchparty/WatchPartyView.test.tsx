// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'

let mockParties: PartyRuntime[] = []

vi.mock('../../hooks/watchPartyStore', () => ({
  useWatchParty: () => ({
    parties: mockParties,
    kickedNotice: null,
  }),
  joinPartyById: vi.fn(),
  MAX_SLOTS: 4,
  controlPlayback: vi.fn(),
  queueOp: vi.fn(),
  serverNow: () => 100,
}))

vi.mock('./WatchPartyRoomList', () => ({
  WatchPartyRoomList: () => <div data-testid="room-list">Room List</div>,
}))

vi.mock('./WatchPartySlot', () => ({
  WatchPartySlot: () => <div data-testid="watch-slot">Video Slot</div>,
}))

vi.mock('./WatchPartyTimeline', () => ({
  WatchPartyTimeline: ({ onToggleRail, railOpen }: { onToggleRail?: () => void; railOpen?: boolean }) => (
    <div data-testid="timeline">
      <button type="button" onClick={onToggleRail} aria-label="Toggle side panel">
        {railOpen ? 'Close Rail' : 'Open Rail'}
      </button>
    </div>
  ),
}))

vi.mock('./WatchPartyChat', () => ({
  WatchPartyChat: () => <div data-testid="chat">Chat</div>,
}))

vi.mock('./WatchPartyQueue', () => ({
  WatchPartyQueue: () => <div data-testid="queue">Queue</div>,
}))

vi.mock('./WatchRoomHeader', () => ({
  WatchRoomHeader: () => <div data-testid="room-header">Room Header</div>,
}))

import { WatchPartyView } from './WatchPartyView'

describe('WatchPartyView Component', () => {
  const identity = { orbitId: 'user-1', publicKeyHex: 'pub', privateKeyHex: 'priv' }

  beforeEach(() => {
    mockParties = []
    vi.clearAllMocks()
  })

  it('renders two-column layout in browse mode when no party is active', () => {
    mockParties = []
    render(<WatchPartyView identity={identity} profilePics={{}} />)

    expect(screen.getByTestId('room-list')).toBeDefined()
    expect(screen.getByText('Watch')).toBeDefined()
    expect(screen.getByText('No room open')).toBeDefined()
    expect(screen.getByText('In this room')).toBeDefined()
  })

  it('renders video theater and toggles docked side rail in room mode', () => {
    mockParties = [
      {
        id: 'party-1',
        name: 'Cool Party',
        url: 'https://example.com/v.mp4',
        mediaName: 'Cool Video',
        host: 'user-1',
        queue: [],
        current: 'q1',
        members: [{ id: 'user-1', name: 'User 1' }],
        chat: [],
        mutedIds: {},
        lockVideo: false,
        isPrivate: false,
        frame: { url: 'https://example.com/v.mp4', action: 'play', position: 0, rate: 1, updatedAt: 100 },
      } as unknown as PartyRuntime,
    ]

    render(<WatchPartyView identity={identity} profilePics={{}} />)

    expect(screen.getByTestId('watch-slot')).toBeDefined()
    expect(screen.getByTestId('timeline')).toBeDefined()

    const toggleBtn = screen.getByLabelText('Toggle side panel')
    expect(toggleBtn).toBeDefined()

    // Rail should toggle open when clicked
    fireEvent.click(toggleBtn)
    expect(screen.getByText('In this room')).toBeDefined()
  })
})
