// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/watchPartyStore', () => ({
  createParty: vi.fn(async () => ({ ok: true, partyId: 'p9' })),
  expandPlaylist: vi.fn(async () => ({ ok: true, isPlaylist: false, count: 1, items: [] })),
  joinPartyById: vi.fn(async () => true),
  loadPartyVideo: vi.fn(async () => ({ ok: true })),
  loadPartyVideos: vi.fn(async () => ({ ok: true, added: 0, failed: [] })),
}))

import { createParty, expandPlaylist, loadPartyVideo, loadPartyVideos } from '../../hooks/watchPartyStore'
import { WatchPartyUrlModal } from './WatchPartyUrlModal'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ parties: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('WatchPartyUrlModal', () => {
  it('renders the URL input, submit disabled while empty', () => {
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)
    const input = screen.getByLabelText('Video URL')
    expect(input).toBeTruthy()
    const submit = screen.getByRole('button', { name: /start party/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('submits the typed URL and closes', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://example.com/v' } })
    fireEvent.click(screen.getByRole('button', { name: /start party/i }))
    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://example.com/v', ''))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the server parse error inline', async () => {
    vi.mocked(createParty).mockResolvedValueOnce({ ok: false, error: 'Could not find a playable video at that link.' })
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://bad' } })
    fireEvent.click(screen.getByRole('button', { name: /start party/i }))
    expect(await screen.findByText(/playable video/)).toBeTruthy()
  })

  it('multi-line create: first URL starts the party, the rest bulk-queue', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://one\nhttps://two\nhttps://three' } })
    fireEvent.click(screen.getByRole('button', { name: /start party/i }))
    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://one', ''))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p9', ['https://two', 'https://three'], true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('room mode: single url calls loadPartyVideo', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} joinPartyId="p1" queueMode />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://single.com/v' } })
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    await waitFor(() => expect(loadPartyVideo).toHaveBeenCalledWith(identity, 'p1', 'https://single.com/v', '', true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('room mode: multi-line urls call loadPartyVideos', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} joinPartyId="p1" queueMode />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://one\nhttps://two' } })
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p1', ['https://one', 'https://two'], true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('playlist url expands, shows feedback, starts party with video 1, and queues the rest', async () => {
    vi.mocked(expandPlaylist).mockResolvedValueOnce({
      ok: true,
      isPlaylist: true,
      count: 3,
      playlistTitle: 'Awesome Playlist',
      items: [
        { url: 'https://video1' },
        { url: 'https://video2' },
        { url: 'https://video3' },
      ],
    })
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://pmvhaven.com/playlists/123' } })
    fireEvent.click(screen.getByRole('button', { name: /start party/i }))

    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://video1', 'Awesome Playlist'))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p9', ['https://video2', 'https://video3'], true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

