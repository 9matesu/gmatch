// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileView } from './ProfileView'
import type { GalleryImage } from '../../game/types'

vi.mock('../../hooks/useCropper', () => ({
  useCropper: () => ({ crop: vi.fn().mockResolvedValue({ dataUrl: '', file: null }), cropper: null }),
}))
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn() }))
vi.mock('../../utils/profile', () => ({ saveUserProfile: vi.fn() }))

const HASH = 'd'.repeat(64)
const keep: GalleryImage = {
  id: `upload:${HASH}`, url: HASH, localRef: HASH, saveState: 'persisted',
  kind: 'image', tags: ['upload'], rarityBase: 0, clicks: 0, rarity: 'Common',
  boughtAt: 1,
}
let gallery: GalleryImage[] = [keep]
vi.mock('../../game/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../game/store')>()
  const useGame = Object.assign(
    (selector: (s: any) => unknown) => selector({ ...actual.useGame.getState(), gallery }),
    {
      getState: actual.useGame.getState,
      setState: actual.useGame.setState,
      subscribe: actual.useGame.subscribe,
    },
  )
  return { ...actual, useGame }
})
vi.mock('../ObjectImage', () => ({
  ObjectImage: ({ contentHash, alt }: any) => <img data-testid="media-tile" data-hash={contentHash || ''} alt={alt || ''} />,
}))
vi.mock('../cards/GameCard', () => ({
  GameCard: ({ name, clicker, interactive }: any) => (
    <div data-testid="shelf-card" data-clicker={clicker ? 'true' : 'false'} data-interactive={String(interactive)}>{name}</div>
  ),
}))

const identity = { orbitId: 'me', publicKey: 'pk' } as any
const post = {
  id: 'profile-text-1', author_id: 'me', author_name: 'Me', caption: 'Words to repost',
  url: '', created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
} as any

beforeEach(() => { gallery = [keep] })

function renderProfile(onRepostPost: (p: any) => void, cards: any[] = []) {
  const noop = vi.fn()
  render(
    <ProfileView
      identity={identity}
      myUser={{ id: 'me', display_name: 'Me' } as any}
      profilePics={{}}
      feedPosts={[post]}
      savedPosts={[]}
      myCards={cards}
      repostedPosts={[]}
      followingIds={[]}
      myProfile={{ displayName: 'Me', tags: [], isAdmin: false, pfpUrl: '', bio: '', website: '' }}
      toast={noop}
      setShowSettingsModal={noop}
      setFollowersModalState={noop as any}
      setExpandedItemId={noop}
      setMyProfile={noop as any}
      setProfilePics={noop as any}
      loadUsers={noop}
      setArchivedPostIds={noop as any}
      setDeletedPostIds={noop as any}
      deletePostOnServer={vi.fn().mockResolvedValue('deleted')}
      users={[]}
      onSendDm={vi.fn().mockResolvedValue(true)}
      onPersistLike={vi.fn().mockResolvedValue(undefined)}
      onPersistSave={noop}
      onPersistComment={vi.fn().mockResolvedValue(null)}
      onSelectUser={noop}
      onOpenNetwork={noop}
      shareGroups={[]}
      onRepostPost={onRepostPost}
    />,
  )
}

describe('ProfileView keepsake surface', () => {
  it('shows saved keeps as keepsakes, not as cards in the Cards tab', async () => {
    renderProfile(vi.fn())
    expect(screen.getByText(/Keepsakes \(1\)/)).toBeInTheDocument()
    expect(screen.getByTestId('media-tile')).toHaveAttribute('data-hash', HASH)

    await userEvent.click(screen.getByRole('button', { name: /cards/i }))
    expect(screen.getByText('No cards yet')).toBeInTheDocument()
    // The keep stays in its own keepsake surface; it never becomes a card tile.
    expect(screen.getByTestId('media-tile')).toBeInTheDocument()
  })

  it('never puts posts or unverified keeps in the keepsake grid', () => {
    gallery = [
      keep,
      {
        ...keep, id: 'still-downloading', url: 'https://cdn.example/pending.jpg',
        localRef: undefined, saveState: 'downloading',
      },
    ]
    renderProfile(vi.fn())
    const tiles = screen.getAllByTestId('media-tile')
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toHaveAttribute('data-hash', HASH)
    expect(screen.getByText(/Keepsakes \(1\)/)).toBeInTheDocument()
    // The post lives in the Posts grid only; it is never a keepsake tile.
    expect(screen.getByText('Words to repost')).toBeInTheDocument()
    expect(screen.getByLabelText('Profile keepsakes')).toBeInTheDocument()
  })
})

describe('ProfileView repost prop chain', () => {
  it('passes onRepostPost to the profile text card as exactly one action', async () => {
    const onRepostPost = vi.fn()
    renderProfile(onRepostPost)
    const actions = screen.getAllByRole('button', { name: 'Repost to Profile' })
    expect(actions).toHaveLength(1)
    await userEvent.click(actions[0])
    expect(onRepostPost).toHaveBeenCalledTimes(1)
    expect(onRepostPost).toHaveBeenCalledWith(post)
  })
})

describe('ProfileView card collection shelf', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: `obj-${i}`,
    card_id: `card-${i}`,
    name: `Card ${i}`,
    value: 100,
    tags: i === 0 ? ['clicker'] : [],
    content_url: 'https://example.test/a.jpg',
    mime_type: 'image/jpeg',
    created_at: '2026-01-01T00:00:00Z',
    owner_id: 'me',
    size_bytes: 1,
  }))

  it('shows up to six of the owner cards as a read-only shelf', () => {
    renderProfile(vi.fn(), cards)
    expect(screen.getByText(/Card collection \(8\)/)).toBeInTheDocument()
    expect(screen.getByText(/Showing your top 6/)).toBeInTheDocument()
    const tiles = screen.getAllByTestId('shelf-card')
    expect(tiles).toHaveLength(6)
    expect(tiles.every((t) => t.getAttribute('data-interactive') === 'false')).toBe(true)
  })

  it('passes the clicker origin through to the shelf card tile', () => {
    renderProfile(vi.fn(), cards)
    const tiles = screen.getAllByTestId('shelf-card')
    expect(tiles[0].getAttribute('data-clicker')).toBe('true')
    expect(tiles[1].getAttribute('data-clicker')).toBe('false')
  })

  it('adds no shelf when the player owns no cards', () => {
    renderProfile(vi.fn())
    expect(screen.queryByLabelText('Profile card collection')).toBeNull()
  })
})
