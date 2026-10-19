// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { User } from '@orbit/shared'
import { UserProfileModal } from './UserProfileModal'
import type { FeedPost } from './feed/GMatchFeed'

/**
 * The profile is two panes: identity on the left, the opened post on the right.
 *
 * Before this, opening a post expanded it inline in the same scroll container,
 * which pushed the profile around and could scroll the post away when the feed
 * refreshed. These tests pin the pane split, the layered Escape order and the
 * focus hand-back on close.
 */

const openPost = vi.fn()

vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
  invalidateCache: vi.fn(),
  postShareUrl: (id: string) => `https://example.test/p/${id}`,
}))

vi.mock('./feed/useProfilePostLightbox', () => ({
  useProfilePostLightbox: () => ({
    openPost,
    // Stand-in for the real expanded post; the modal decides WHERE it renders.
    expandedNode: <div data-testid="expanded-post">expanded</div>,
    modals: null,
  }),
}))

const user = { id: 'u-1', display_name: 'Test User', publicKey: 'pk-1', createdAt: new Date().toISOString() } as User

const posts: FeedPost[] = [
  { id: 'p-1', author_id: 'u-1', url: 'obj-1', caption: 'first', likes: 0, comments: 0 } as unknown as FeedPost,
  { id: 'p-2', author_id: 'u-1', url: 'obj-2', caption: 'second', likes: 0, comments: 0 } as unknown as FeedPost,
]

describe('UserProfileModal two-pane layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
  })

  it('renders the profile and the post pane side by side', () => {
    render(<UserProfileModal user={user} onClose={() => {}} posts={posts} />)
    expect(screen.getByTestId('profile-pane')).toBeInTheDocument()
    expect(screen.getByTestId('profile-post-pane')).toBeInTheDocument()
  })

  it('shows the post in the pane without closing the profile', () => {
    const onClose = vi.fn()
    render(<UserProfileModal user={user} onClose={onClose} posts={posts} />)
    expect(screen.queryByTestId('expanded-post')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open post 2'))
    expect(openPost).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2' }))
    const pane = screen.getByTestId('profile-post-pane')
    expect(pane).toContainElement(screen.getByTestId('expanded-post'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape closes the open post first, the profile only as the last layer', () => {
    const onClose = vi.fn()
    render(<UserProfileModal user={user} onClose={onClose} posts={posts} />)
    fireEvent.click(screen.getByLabelText('Open post 1'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('expanded-post')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hands focus back to the opener when it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<UserProfileModal user={user} onClose={() => {}} />)
    cleanup()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps a post open across a re-render with fresh post objects (feed refresh)', () => {
    const { rerender } = render(<UserProfileModal user={user} onClose={() => {}} posts={posts} />)
    fireEvent.click(screen.getByLabelText('Open post 1'))
    const refreshed = posts.map((p) => ({ ...p, likes: 41 }))
    rerender(<UserProfileModal user={{ ...user, last_seen: new Date().toISOString() }} onClose={() => {}} posts={refreshed} />)
    expect(screen.getByTestId('profile-post-pane')).toContainElement(screen.getByTestId('expanded-post'))
  })
})
