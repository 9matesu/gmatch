// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FeedPost } from './GMatchFeed'

/**
 * The detail sheet states peer-confirmed durability — and stays silent when
 * only this device holds the bytes.
 *
 * The count is read from the swarm's receipt roles (mocked here; the hook and
 * the label rule have their own unit tests). What this pins is the PRODUCT
 * wiring: `content_hash` is the object the receipt is keyed by, and a count of
 * one (this node alone) must not claim "replicated".
 */
const state = vi.hoisted(() => ({ holders: new Map<string, number>() }))

vi.mock('../../utils/p2pSwarm', () => ({
  DURABLE_REPLICATION_EVENT: 'orbit-durable-replication',
  durableCustodyHolders: (id: string) => state.holders.get(id) ?? 1,
}))
vi.mock('../ObjectImage', () => ({ ObjectImage: () => <div data-testid="object-image" /> }))
vi.mock('../media/NativeVideoPlayer', () => ({ NativeVideoPlayer: () => <div data-testid="video" /> }))
vi.mock('./PostComments', () => ({ PostComments: () => <div data-testid="comments" /> }))
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn() }))

import { ProfileExpandedPost } from './ProfileExpandedPost'

const HASH = 'a'.repeat(64)

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'object-1',
    author_id: 'author-1',
    author_name: 'Tester',
    author_avatar: null,
    url: `/api/objects/object-1`,
    mime_type: 'image/png',
    content_hash: HASH,
    caption: 'hello',
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
    is_liked: false,
    is_saved: false,
    ...overrides,
  } as FeedPost
}

function renderPost(p: FeedPost) {
  return render(
    <ProfileExpandedPost post={p} onClose={() => {}} identity={null} />,
  )
}

describe('ProfileExpandedPost · peer-confirmed durability', () => {
  beforeEach(() => state.holders.clear())

  it('stays silent when only this device holds the bytes', () => {
    state.holders.set(HASH, 1)
    renderPost(post())
    expect(screen.queryByText(/Stored on/)).toBeNull()
  })

  it('speaks when a peer signed a receipt for the bytes', () => {
    state.holders.set(HASH, 3)
    renderPost(post())
    expect(screen.getByText('Stored on 3 devices')).toBeTruthy()
  })

  it('keys custody by the content hash, not the row id', () => {
    // The peer fetched by the bytes' hash, so the receipt lives there.
    state.holders.set(HASH, 2)
    renderPost(post())
    expect(screen.getByText('Stored on 2 devices')).toBeTruthy()
  })
})

describe('ProfileExpandedPost post model', () => {
  it('renders a text-only post with no media panel or placeholder', () => {
    renderPost(post({ id: 'text-1', caption: 'words on their own', url: '', mime_type: undefined }))
    expect(screen.getByText('words on their own')).toBeTruthy()
    expect(screen.queryByTestId('object-image')).toBeNull()
    expect(screen.queryByText(/No preview|Loading media/i)).toBeNull()
  })

  it('renders an image post with its media and its caption', () => {
    renderPost(post())
    expect(screen.getByTestId('object-image')).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
  })
})

describe('ProfileExpandedPost · save to Vault', () => {
  it('wires the Vault action when the caller offers it', () => {
    const onSaveToVault = vi.fn()
    const p = post()
    render(<ProfileExpandedPost post={p} onClose={() => {}} identity={null} onSaveToVault={onSaveToVault} />)
    fireEvent.click(screen.getByLabelText('Save to Vault'))
    expect(onSaveToVault).toHaveBeenCalledWith(p)
  })

  it('has no Vault action for a text-only post', () => {
    render(
      <ProfileExpandedPost
        post={post({ id: 'text-2', caption: 'just words', url: '', mime_type: undefined })}
        onClose={() => {}} identity={null} onSaveToVault={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Save to Vault')).toBeNull()
  })
})
