// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TagBrowser from './TagBrowser'
import { useGame } from '../../game/store'
import type { OwnedTag } from '../../game/types'

const { fetchPostsMock } = vi.hoisted(() => ({ fetchPostsMock: vi.fn() }))
vi.mock('../../services/booru', () => ({ fetchPosts: fetchPostsMock }))

const ownedTag = (name: string, level = 1): OwnedTag => ({ name, level, base: 10, income: 1, weight: 1 })

describe('TagBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchPostsMock.mockResolvedValue({ posts: [], source: 'tbib', ok: true })
    // Only level>0 tags belong in the picker; level 0 is an unbought market offer.
    useGame.setState({ tags: [ownedTag('wet_ass', 3), ownedTag('blonde', 1), ownedTag('offer_only', 0)] })
  })

  it('shows only owned tags in the picker, not unbought market offers', () => {
    render(<TagBrowser />)
    expect(screen.getByRole('button', { name: /wet_ass/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /blonde/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /offer_only/i })).not.toBeInTheDocument()
  })

  it('does not fetch until a tag is picked', () => {
    render(<TagBrowser />)
    expect(fetchPostsMock).not.toHaveBeenCalled()
    expect(screen.getByText(/no tags picked/i)).toBeInTheDocument()
  })

  it('fetches silently when a tag is picked, so browsing never consumes the feed pool', async () => {
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    await waitFor(() => expect(fetchPostsMock).toHaveBeenCalledTimes(1))
    expect(fetchPostsMock.mock.calls[0][0]).toMatchObject({ tags: 'wet_ass', silent: true })
  })

  it('AND-joins multiple picks into one query', async () => {
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    fireEvent.click(screen.getByRole('button', { name: /blonde/i }))
    await waitFor(() => expect(fetchPostsMock).toHaveBeenLastCalledWith(expect.objectContaining({ tags: 'wet_ass blonde' })))
  })

  it('renders results deduped by id', async () => {
    fetchPostsMock.mockResolvedValue({
      posts: [
        { id: 'a', url: 'https://e.test/a.jpg', tags: ['wet_ass'] },
        { id: 'a', url: 'https://e.test/a-dup.jpg', tags: ['wet_ass'] },
        { id: 'b', url: 'https://e.test/b.jpg', tags: ['wet_ass'] },
      ],
      source: 'tbib',
      ok: true,
    })
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    const tiles = await screen.findAllByRole('button', { name: /view image tagged/i })
    expect(tiles).toHaveLength(2)
  })

  it('states provenance under the grid instead of failing silently', async () => {
    fetchPostsMock.mockResolvedValue({
      posts: [{ id: 'a', url: 'https://e.test/a.jpg', tags: ['wet_ass'] }],
      source: 'xbooru',
      ok: true,
    })
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    expect(await screen.findByText('1 from xbooru')).toBeInTheDocument()
  })

  it('says offline when the providers are unreachable', async () => {
    fetchPostsMock.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
  })

  it('clears loading and offers retry when the provider call rejects', async () => {
    fetchPostsMock.mockRejectedValueOnce(new Error('gateway error')).mockResolvedValueOnce({
      posts: [{ id: 'retry', url: 'https://e.test/retry.jpg', tags: ['wet_ass'] }], source: 'tbib', ok: true,
    })
    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i }))
    expect(await screen.findByText('Offline: tag search failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 from tbib')).toBeInTheDocument()
  })

  it('drops a stale response so a slow round cannot overwrite a newer query', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    fetchPostsMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ posts: [{ id: 'new', url: 'https://e.test/new.jpg', tags: ['blonde'] }], source: 'tbib', ok: true })

    render(<TagBrowser />)
    fireEvent.click(screen.getByRole('button', { name: /wet_ass/i })) // slow request
    fireEvent.click(screen.getByRole('button', { name: /blonde/i })) // newer request

    // The slow first request finally answers with different data and must be ignored.
    resolveFirst({ posts: [{ id: 'stale', url: 'https://e.test/stale.jpg', tags: ['wet_ass'] }], source: 'tbib', ok: true })
    await waitFor(() => expect(screen.getAllByRole('button', { name: /view image tagged/i })).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /tagged wet_ass/i })).not.toBeInTheDocument()
  })

  it('tells the player to own tags when the picker is empty', () => {
    useGame.setState({ tags: [ownedTag('offer_only', 0)] })
    render(<TagBrowser />)
    expect(screen.getByText(/own tags in the tag market first/i)).toBeInTheDocument()
  })
})
