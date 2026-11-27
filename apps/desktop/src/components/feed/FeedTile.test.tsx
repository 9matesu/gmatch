// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FeedPost } from './GMatchFeed'
import { FeedTile } from './FeedTile'

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'tile-1',
    author_id: 'author-1',
    author_name: 'Tester',
    url: 'https://example.com/pic.jpg',
    mime_type: 'image/jpeg',
    caption: 'a picture',
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
    ...overrides,
  } as FeedPost
}

describe('FeedTile · save to Vault', () => {
  it('offers the Vault action on the inline tile and fires it with the post', () => {
    const onSaveToVault = vi.fn()
    const p = post()
    render(
      <FeedTile post={p} identity={null} liked={false} likes={0} onOpen={() => {}} onToggleLike={() => {}} onSaveToVault={onSaveToVault} />,
    )

    fireEvent.click(screen.getByLabelText('Save to Vault'))
    expect(onSaveToVault).toHaveBeenCalledWith(p)
  })

  it('does not offer Vault on a text-only tile or when the bridge is absent', () => {
    const onSaveToVault = vi.fn()
    const { unmount } = render(
      <FeedTile post={post()} identity={null} liked={false} likes={0} onOpen={() => {}} onToggleLike={() => {}} />,
    )
    expect(screen.queryByLabelText('Save to Vault')).toBeNull()
    unmount()

    render(
      <FeedTile post={post({ id: 'text', url: '', mime_type: undefined, caption: 'words' })} identity={null} liked={false} likes={0} onOpen={() => {}} onToggleLike={() => {}} onSaveToVault={onSaveToVault} />,
    )
    expect(screen.queryByLabelText('Save to Vault')).toBeNull()
  })
})
