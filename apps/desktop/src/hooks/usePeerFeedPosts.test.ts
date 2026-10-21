import { describe, expect, it } from 'vitest'
import { projectedPostsToFeedPosts } from './usePeerFeedPosts'
import type { ProjectedPost } from '../services/socialFeedProjection'

const base: ProjectedPost = {
  id: 'post-a',
  authorId: 'peer-1',
  headOperationId: 'a'.repeat(64),
  contentCid: 'c'.repeat(64),
  manifestHash: 'm'.repeat(64),
  mimeType: 'image/jpeg',
  sizeBytes: 10,
  caption: 'hi',
  tags: [],
  createdAt: 1_700_000_000_000,
  edited: false,
  status: 'committed',
}

describe('peer feed rows (L4.2)', () => {
  it('maps a projected post onto the feed shape without a provider URL', () => {
    const [row] = projectedPostsToFeedPosts([base], 'me')
    expect(row).toMatchObject({
      id: 'post-a',
      author_id: 'peer-1',
      url: '/api/objects/post-a',
      mime_type: 'image/jpeg',
      caption: 'hi',
      origin: 'peer',
      like_count: 0,
      comment_count: 0,
    })
    expect(row.url).not.toMatch(/^https?:/)
  })

  it('shows a sync badge only on our own rows, derived from the log status', () => {
    const mine = (status: ProjectedPost['status']) =>
      projectedPostsToFeedPosts([{ ...base, authorId: 'me', status }], 'me')[0]

    expect(mine('committed').sync_state).toBe('local')
    expect(mine('sending').sync_state).toBe('pending')
    expect(mine('delivered').sync_state).toBe('replicated')
    // Someone else's post is never labelled with our delivery state.
    expect(projectedPostsToFeedPosts([base], 'me')[0].sync_state).toBeUndefined()
  })
})
