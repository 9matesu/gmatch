// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/watchPartyStore', () => ({
  createParty: vi.fn(async () => ({ ok: true, partyId: 'p9' })),
  joinPartyById: vi.fn(async () => true),
  loadPartyVideo: vi.fn(async () => ({ ok: true })),
  loadPartyVideos: vi.fn(async () => ({ ok: true, added: 0, failed: [] })),
}))

import { createParty, loadPartyVideos } from '../../hooks/watchPartyStore'
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
})
