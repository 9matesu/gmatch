// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WatchPartyRoomList } from './WatchPartyRoomList'

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

const mockJoinPartyById = vi.fn()
vi.mock('../../hooks/watchPartyStore', () => ({
  joinPartyById: (...args: any[]) => mockJoinPartyById(...args),
  // The gallery also offers rooms this device remembers but has left.
  rememberedRooms: () => [],
}))

const mockOrbitFetch = vi.fn()
vi.mock('../../utils/api', () => ({
  orbitFetch: (...args: any[]) => mockOrbitFetch(...args),
}))

describe('WatchPartyRoomList Gallery Grid', () => {
  const identity = { orbitId: 'user-alice', publicKeyHex: 'pub', privateKeyHex: 'priv' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockOrbitFetch.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/watchparty') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parties: [
              {
                id: 'room-1',
                name: 'Anime Chill Room',
                members: 4,
                mediaName: 'Episode 12.mp4',
                mediaUrl: 'https://example.com/ep12.mp4',
              },
              {
                id: 'room-2',
                name: 'Late Night Cinema',
                members: 0,
                mediaName: 'Movie.mp4',
                mediaUrl: 'https://example.com/movie.mp4',
              },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  })

  it('renders Create Room silhouette card and triggers onNewParty when clicked', async () => {
    const onNewParty = vi.fn()
    render(<WatchPartyRoomList identity={identity} onNewParty={onNewParty} />)

    const createBtn = screen.getByRole('button', { name: /create a new room/i })
    expect(createBtn).toBeInTheDocument()
    expect(screen.getByText('Create Room')).toBeInTheDocument()
    expect(screen.getByText('Start a new watch party')).toBeInTheDocument()

    fireEvent.click(createBtn)
    expect(onNewParty).toHaveBeenCalledOnce()

    expect(await screen.findByText('Anime Chill Room')).toBeInTheDocument()
  })

  it('renders room cards in gallery grid with thumbnails, counts, and persistent status', async () => {
    render(<WatchPartyRoomList identity={identity} onNewParty={() => {}} />)

    expect(await screen.findByText('Anime Chill Room')).toBeInTheDocument()
    expect(screen.getByText('Episode 12.mp4')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    // Persistent empty room
    expect(screen.getByText('Late Night Cinema')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Persistent')).toBeInTheDocument()

    // Clicking room card joins the party
    const roomBtn = screen.getByRole('button', { name: /join room anime chill room/i })
    fireEvent.click(roomBtn)
    expect(mockJoinPartyById).toHaveBeenCalledWith(identity, 'room-1')
  })
})
