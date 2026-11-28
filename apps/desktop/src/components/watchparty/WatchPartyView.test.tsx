// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { PartyRuntime } from '../../hooks/watchPartyStore'

let mockParties: PartyRuntime[] = []

vi.mock('../../hooks/watchPartyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/watchPartyStore')>()
  return {
    ...actual,
    useWatchParty: () => ({
      parties: mockParties,
      kickedNotice: null,
    }),
    joinPartyById: vi.fn(),
    MAX_SLOTS: 4,
    controlPlayback: vi.fn(),
    queueOp: vi.fn(),
    serverNow: () => 100,
  }
})

vi.mock('../../hooks/useObjectImage', () => ({
  useObjectImage: (url: string | null) => ({
    url: url ? `blob:${url}` : null,
    failed: false,
    isVideo: url ? url.includes('.mp4') : false,
    isLink: false,
    linkUrl: null,
    awaitingSeeder: false,
  }),
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

  it('renders full-width gallery in browse mode when no party is active', () => {
    mockParties = []
    render(<WatchPartyView identity={identity} profilePics={{}} />)

    expect(screen.getByTestId('room-list')).toBeDefined()
    expect(screen.getByText('Watch')).toBeDefined()
    expect(screen.queryByText('No room open')).toBeNull()
    expect(screen.queryByText('In this room')).toBeNull()
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

  it('fits inside the page: the room root is height-bounded and clears the island', () => {
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
    const root = screen.getByTestId('watch-room-root')
    // Height-bounded + non-overflowing, and reserves the floating island strip.
    expect(root.className).toMatch(/min-h-0/)
    expect(root.className).toMatch(/overflow-hidden/)
    expect(root.className).toMatch(/pb-\[var\(--island-clearance\)\]/)
    // The theater column is a flex child that owns its own scroll containment,
    // and the transport bar lives INSIDE it (bottom), never spilling past the
    // bounded container into the island strip.
    const theater = screen.getByTestId('watch-theater')
    expect(theater.className).toMatch(/min-h-0/)
    expect(theater.className).toMatch(/overflow-hidden/)
    expect(within(theater).getByTestId('timeline')).toBeTruthy()
    expect(within(theater).getByTestId('watch-slot')).toBeTruthy()
  })

  it('previews the current media when hovering the now-playing card, hides on leave', () => {
    mockParties = [
      {
        id: 'party-1',
        name: 'Cool Party',
        url: 'https://example.com/v.mp4',
        mediaName: 'Cool Video',
        host: 'user-1',
        queue: [{ id: 'q1', name: 'Cool Video', url: 'https://example.com/v.mp4' }],
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
    expect(screen.getByText('Now playing')).toBeDefined()
    expect(screen.queryByTestId('now-playing-preview')).toBeNull()

    const card = screen.getByText('Now playing').closest('div')!.parentElement!
    fireEvent.mouseEnter(card)
    expect(screen.getByTestId('now-playing-preview')).toBeDefined()
    fireEvent.mouseLeave(card)
    expect(screen.queryByTestId('now-playing-preview')).toBeNull()
  })

  it('keeps secondary room facts behind a single Details disclosure', () => {
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
    const details = screen.getByText('Details').closest('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)
    expect(screen.getByText('In this room')).toBeDefined()

    fireEvent.click(screen.getByText('Details'))
    expect(details.open).toBe(true)
    // The now-playing card also names the media; scope to the disclosure.
    expect(within(details).getByText('Cool Video')).toBeDefined()
  })
})
