// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProfileTextPostCard } from './ProfileTextPostCard'
import type { FeedPost } from './GMatchFeed'

const post = {
  id: 'text-1',
  author_id: 'author-1',
  author_name: 'Text Author',
  caption: 'First paragraph.\n\nSecond paragraph with https://example.com link.',
  url: '',
  created_at: new Date().toISOString(),
  like_count: 4,
  comment_count: 1,
} as FeedPost

describe('ProfileTextPostCard', () => {
  it('renders a formatted text card with no media panel', () => {
    const { container } = render(<ProfileTextPostCard post={post} />)
    expect(screen.getByTestId('profile-text-post')).toBeTruthy()
    expect(screen.getByText('Text Author')).toBeTruthy()
    expect(screen.getByText(/@author-1/)).toBeTruthy()
    expect(screen.getByText(/First paragraph\./)).toBeTruthy()
    expect(screen.getByText(/Second paragraph with/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeTruthy()
    expect(container.querySelector('img, video')).toBeNull()
    expect(screen.queryByText(/No preview|Loading media/i)).toBeNull()
  })

  it('keeps every action real and gated on its handler', () => {
    const like = vi.fn()
    const save = vi.fn()
    const repost = vi.fn()
    const share = vi.fn()
    render(
      <ProfileTextPostCard
        post={post}
        liked
        saved
        likes={4}
        onToggleLike={like}
        onToggleSave={save}
        onRepost={repost}
        onShare={share}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unlike post' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from saved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repost to Profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share post' }))
    expect(like).toHaveBeenCalledWith(post)
    expect(save).toHaveBeenCalledWith(post)
    expect(repost).toHaveBeenCalledWith(post)
    expect(share).toHaveBeenCalledWith(post)
    expect(screen.queryByRole('button', { name: 'Save to Vault' })).toBeNull()
  })

  it('shows the repost line without a second body', () => {
    const { container } = render(
      <ProfileTextPostCard post={{ ...post, is_reposted: true, reposted_by: 'peer-1' }} />,
    )
    expect(screen.getByText(/Reposted by/)).toBeTruthy()
    expect(screen.getByText(/@peer-1/)).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="profile-text-post"] p').length).toBe(2)
  })
})
