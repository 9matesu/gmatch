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

// jsdom in this repo has no localStorage; stub it the way other persistence tests do.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
  key: () => null,
  length: 0,
} as Storage

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.clear()
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
    const submit = screen.getByRole('button', { name: 'START PARTY' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('submits the typed URL and closes', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://example.com/v' } })
    fireEvent.click(screen.getByRole('button', { name: 'START PARTY' }))
    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://example.com/v', ''))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the server parse error inline', async () => {
    vi.mocked(createParty).mockResolvedValueOnce({ ok: false, error: 'Could not find a playable video at that link.' })
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'START PARTY' }))
    expect(await screen.findByText(/playable video/)).toBeTruthy()
  })

  it('warns immediately for image links before contacting the server', () => {
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://cdn.example.com/pic.jpg' } })
    expect(screen.getByText(/image, not a playable video/i)).toBeTruthy()
  })

  it('surfaces provider failure reasons instead of bare URLs', async () => {
    vi.mocked(loadPartyVideo).mockResolvedValueOnce({ ok: false, added: 0, failed: ['https://example.com/article'], failedDetails: [{ url: 'https://example.com/article', kind: 'provider-unresolved', provider: 'page', reason: 'No playable video was found at page.', sync: 'none' }], error: 'Could not load these videos.' })
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} joinPartyId="p1" queueMode />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://example.com/article' } })
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    expect(await screen.findByText(/No playable video was found at page/i)).toBeTruthy()
  })

  it('multi-line create: first URL starts the party, the rest bulk-queue', async () => {
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://one\nhttps://two\nhttps://three' } })
    fireEvent.click(screen.getByRole('button', { name: 'START PARTY' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'START PARTY' }))

    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://video1', 'Awesome Playlist'))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p9', ['https://video2', 'https://video3'], true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('saves a launched URL locally and offers it as a quick-launch chip with a thumbnail', async () => {
    const first = render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Video URL'), { target: { value: 'https://example.com/v' } })
    fireEvent.click(screen.getByRole('button', { name: 'START PARTY' }))
    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://example.com/v', ''))

    // Stored on this device, not on the node: a chip survives a modal re-open.
    expect(window.localStorage.getItem('gmatch_watch_urls_v1')).toContain('https://example.com/v')
    first.unmount()
    render(<WatchPartyUrlModal identity={identity} onClose={() => {}} />)

    const chip = screen.getByRole('button', { name: 'Quick launch https://example.com/v' })
    expect(chip.querySelector('img')?.getAttribute('src')).toBe('https://example.com/v')
  })

  it('relaunches a saved link in one click through the real create path', async () => {
    window.localStorage.setItem('gmatch_watch_urls_v1', JSON.stringify([
      { url: 'https://saved.example/v', at: Date.now() },
    ]))
    const onClose = vi.fn()
    render(<WatchPartyUrlModal identity={identity} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quick launch https://saved.example/v' }))
    await waitFor(() => expect(createParty).toHaveBeenCalledWith(identity, 'https://saved.example/v', ''))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

