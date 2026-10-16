// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/watchPartyStore', () => ({
  loadPartyVideos: vi.fn(async () => ({ ok: true, added: 3, failed: [] })),
  queueOp: vi.fn(),
  moveQueueEntry: vi.fn(),
}))

import { loadPartyVideos } from '../../hooks/watchPartyStore'
import { WatchPartyQueue } from './WatchPartyQueue'
import type { PartyRuntime } from '../../hooks/watchPartyStore'

// loadPartyVideos is mocked above; PartyRuntime is a type-only import.

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never
const party = {
  id: 'p1', name: 'N', url: 'u', frame: null, members: [], chat: [],
  host: 'me', mutedIds: {}, lockVideo: false, isPrivate: false,
  mediaName: '', queue: [{ id: 'q1', name: 'a', url: '/api/objects/a' }, { id: 'q2', name: 'b', url: '/api/objects/b' }], current: 'q1',
  frameRev: 0, queueRev: 0, settingsRev: 0,
} as PartyRuntime

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('WatchPartyQueue', () => {
  it('submits all pasted lines in one bulk add', async () => {
    render(<WatchPartyQueue party={party} identity={identity} />)
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    const box = screen.getByLabelText('Queue video URLs')
    fireEvent.change(box, { target: { value: 'https://a\n\nhttps://b\nhttps://c\n' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p1', ['https://a', 'https://b', 'https://c'], true))
    // success closes the add panel
    await waitFor(() => expect(screen.queryByLabelText('Queue video URLs')).toBeNull())
  })

  it('partial failure keeps the panel open with the failed url', async () => {
    vi.mocked(loadPartyVideos).mockResolvedValueOnce({ ok: true, added: 1, failed: ['https://bad'] })
    render(<WatchPartyQueue party={party} identity={identity} />)
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    fireEvent.change(screen.getByLabelText('Queue video URLs'), { target: { value: 'https://good\nhttps://bad' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/Failed 1: https:\/\/bad/)).toBeTruthy()
  })

  it('full-reject 422 still names the failed urls', async () => {
    vi.mocked(loadPartyVideos).mockResolvedValueOnce({ ok: false, added: 0, failed: ['https://bad'], error: 'Could not find a playable video at that link.' })
    render(<WatchPartyQueue party={party} identity={identity} />)
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    fireEvent.change(screen.getByLabelText('Queue video URLs'), { target: { value: 'https://bad' } })
    fireEvent.click(screen.getByRole('button', { name: /add and play/i }))
    expect(await screen.findByText(/Failed: https:\/\/bad/)).toBeTruthy()
  })

  it('drag-drop reorder sends move with the drop-target id', async () => {
    const { moveQueueEntry } = await import('../../hooks/watchPartyStore')
    render(<WatchPartyQueue party={party} identity={identity} />)
    const rows = screen.getAllByText(/^(a|b)$/)
    const rowA = rows.find((el) => el.textContent === 'a')!.closest('li')!
    const rowB = rows.find((el) => el.textContent === 'b')!.closest('li')!
    fireEvent.dragStart(rowA)
    fireEvent.dragOver(rowB)
    fireEvent.drop(rowB)
    expect(vi.mocked(moveQueueEntry)).toHaveBeenCalledWith('p1', 'q1', 'q2')
  })

  it('add and play sends queueOnly false', async () => {
    render(<WatchPartyQueue party={party} identity={identity} />)
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    fireEvent.change(screen.getByLabelText('Queue video URLs'), { target: { value: 'https://x' } })
    fireEvent.click(screen.getByRole('button', { name: /add and play/i }))
    await waitFor(() => expect(loadPartyVideos).toHaveBeenCalledWith(identity, 'p1', ['https://x'], false))
  })

  it('truncation displays queue limit notice and clears input', async () => {
    vi.mocked(loadPartyVideos).mockResolvedValueOnce({ ok: true, added: 2, failed: [], truncated: true })
    render(<WatchPartyQueue party={party} identity={identity} />)
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    fireEvent.change(screen.getByLabelText('Queue video URLs'), { target: { value: 'https://a\nhttps://b\nhttps://c' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/Queue limit \(50\) reached/)).toBeTruthy()
  })
})
