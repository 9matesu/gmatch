// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostContextMenu } from './PostContextMenu'
import type { FeedPost } from './GMatchFeed'

const post = {
  id: 'p1',
  author_id: 'author-1',
  author_name: 'Alice',
  caption: 'hello',
  url: 'https://x/a.jpg',
} as unknown as FeedPost

describe('PostContextMenu', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('opens at the cursor position', () => {
    render(<PostContextMenu post={post} x={120} y={240} onClose={() => {}} />)
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('240px')
  })

  it('lists every action the caller can perform', () => {
    render(
      <PostContextMenu
        post={post}
        x={10}
        y={10}
        onClose={() => {}}
        identityOrbitId="author-1"
        onToggleLike={() => {}}
        onToggleSave={() => {}}
        onSaveToVault={() => {}}
        onRepost={() => {}}
        onShare={() => {}}
        onCopyLink={() => {}}
        onEdit={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onReport={() => {}}
      />,
    )
    for (const label of [
      'Like', 'Save', 'Save to Vault', 'Repost to Profile',
      'Share To Direct / Groups', 'Copy Link', 'Edit post',
      'Archive Post', 'Delete Post',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy()
    }
    // The owner never sees "Report Post" (they would report themselves).
    expect(screen.queryByRole('menuitem', { name: 'Report Post' })).toBeNull()
  })

  it('a NON-owner gets Report and never the owner-only rows', () => {
    render(
      <PostContextMenu
        post={post}
        x={10}
        y={10}
        onClose={() => {}}
        identityOrbitId="someone-else"
        onToggleLike={() => {}}
        onEdit={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onReport={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Report Post' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Edit post' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete Post' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive Post' })).toBeNull()
  })

  it('a row whose handler is missing is NOT shown', () => {
    render(
      <PostContextMenu
        post={post}
        x={10}
        y={10}
        onClose={() => {}}
        identityOrbitId="author-1"
        onToggleLike={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Like' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete Post' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Copy Link' })).toBeNull()
  })

  it('says when the post is already liked / saved', () => {
    render(
      <PostContextMenu
        post={post}
        x={10}
        y={10}
        onClose={() => {}}
        onToggleLike={() => {}}
        onToggleSave={() => {}}
        isLiked
        isSaved
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Unlike' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Remove from Saved' })).toBeTruthy()
  })

  it('runs the action and closes', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <PostContextMenu post={post} x={10} y={10} onClose={onClose} identityOrbitId="author-1" onDelete={onDelete} />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Post' }))
    expect(onDelete).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes it', () => {
    const onClose = vi.fn()
    render(<PostContextMenu post={post} x={10} y={10} onClose={onClose} onToggleLike={() => {}} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('a click outside closes it', () => {
    const onClose = vi.fn()
    render(<PostContextMenu post={post} x={10} y={10} onClose={onClose} onToggleLike={() => {}} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('a click INSIDE does not close it', () => {
    const onClose = vi.fn()
    render(<PostContextMenu post={post} x={10} y={10} onClose={onClose} onToggleLike={() => {}} />)
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
