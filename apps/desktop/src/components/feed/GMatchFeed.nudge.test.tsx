// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GMatchFeed } from './GMatchFeed'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }))
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  })
})

describe('GMatchFeed cold-start nudge', () => {
  it('shows the nudge card with follow suggestions when the feed is empty', () => {
    const onFollow = vi.fn()
    render(
      <GMatchFeed
        identity={{ orbitId: 'me' } as never}
        posts={[]}
        stories={[]}
        users={[
          { id: 'u1', display_name: 'Alice', online: true, tags: ['cars'], followers_count: 5 },
          { id: 'u2', display_name: 'Bob', online: false, tags: [], followers_count: 9 },
        ]}
        onFollowSuggestion={onFollow}
        myProfileTags={['cars']}
      />,
    )
    expect(screen.getByText(/Empty in here\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('Follow Alice')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Follow Bob'))
    expect(onFollow).toHaveBeenCalledWith('u2')
  })

  it('no nudge when posts exist', () => {
    render(
      <GMatchFeed
        identity={{ orbitId: 'me' } as never}
        posts={[{ id: 'p1', author_id: 'x', url: 'https://example.com/1.jpg', author_name: 'X', tags: [], created_at: new Date().toISOString(), like_count: 0, comment_count: 0 } as never]}
        stories={[]}
        users={[]}
      />,
    )
    expect(screen.queryByText(/Empty in here\?/)).not.toBeInTheDocument()
  })
})
