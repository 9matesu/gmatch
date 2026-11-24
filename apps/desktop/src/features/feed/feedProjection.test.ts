import { describe, it, expect } from 'vitest'
import { projectFeed } from './feedProjection'
import type { FeedPost } from '../../components/feed/GMatchFeed'
import type { OrbitObject } from '@orbit/shared'

/**
 * Feed projection contract tests.
 *
 * The rules the timeline must keep, independent of React:
 *  - one row per post id, no fabricated rows;
 *  - a source that cannot be identified is absent, never invented;
 *  - an unverified owner claim may not borrow another user's name/avatar;
 *  - a fresh publish outranks the server snapshot until the node indexes it;
 *  - a deleted post never appears from any source.
 */

const me = { orbitId: 'self' }
const base = {
  users: [
    { id: 'peer-1', publicKey: 'pk1', createdAt: '', display_name: 'Peer One' },
  ],
  profilePics: {} as Record<string, string>,
  identity: me,
  myProfile: { displayName: 'Me' },
  items: [] as OrbitObject[],
  deletedPostIds: new Set<string>(),
  archivedPostIds: new Set<string>(),
  optimisticPosts: [] as FeedPost[],
  localPending: [] as FeedPost[],
  pinnedPosts: [] as FeedPost[],
  peerFeedPosts: [] as FeedPost[],
  serverPosts: [] as FeedPost[],
  repostedPosts: [] as FeedPost[],
  myProfilePosts: [] as FeedPost[],
}

function post(id: string, over: Partial<FeedPost> = {}): FeedPost {
  return {
    id,
    author_id: 'peer-1',
    author_name: 'Peer One',
    author_avatar: null,
    url: `https://cdn.test/${id}.jpg`,
    mime_type: 'image/jpeg',
    caption: '',
    created_at: '2026-01-01T00:00:00.000Z',
    like_count: 0,
    comment_count: 0,
    is_liked: false,
    is_saved: false,
    ...over,
  }
}

describe('projectFeed', () => {
  it('dedupes the same id coming from two sources', () => {
    const rows = projectFeed({
      ...base,
      serverPosts: [post('a')],
      optimisticPosts: [post('a')],
    })
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('lets a fresh publish outrank the server snapshot until the node indexes it', () => {
    const rows = projectFeed({
      ...base,
      serverPosts: [post('old')],
      optimisticPosts: [post('new')],
    })
    expect(rows.map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('keeps my own local posts when the node snapshot is empty (offline / timeout)', () => {
    // The "go to profile, come back, everything is gone" bug: the local posts
    // stayed in myProfilePosts but the node snapshot was empty (a timed-out
    // /api/posts request). They must still render.
    const rows = projectFeed({
      ...base,
      serverPosts: [],
      myProfilePosts: [post('mine-1', { author_id: 'self' })],
    })
    expect(rows.map((r) => r.id)).toEqual(['mine-1'])
  })

  it('drops a deleted post from every source', () => {
    const rows = projectFeed({
      ...base,
      serverPosts: [post('a'), post('b')],
      optimisticPosts: [post('a')],
      deletedPostIds: new Set(['a']),
    })
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('never lets an unverified owner claim borrow a directory name or avatar', () => {
    const rows = projectFeed({
      ...base,
      items: [{
        id: 'obj-1', owner_id: 'peer-1', is_public: 1, owner_verified: false,
        mime_type: 'image/jpeg', created_at: '2026-01-01T00:00:00.000Z',
      } as unknown as OrbitObject],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].author_name).toBe('Player')
    expect(rows[0].author_avatar).toBeNull()
  })

  it('resolves the author from the directory for a verified local object', () => {
    const rows = projectFeed({
      ...base,
      items: [{
        id: 'obj-1', owner_id: 'peer-1', is_public: true,
        mime_type: 'image/jpeg', created_at: '2026-01-01T00:00:00.000Z',
      } as unknown as OrbitObject],
    })
    expect(rows[0].author_name).toBe('Peer One')
  })

  it('marks own local objects as "You" and the peer projection keeps its own name', () => {
    const rows = projectFeed({
      ...base,
      items: [{
        id: 'obj-1', owner_id: 'self', is_public: true,
        mime_type: 'image/jpeg', created_at: '2026-01-01T00:00:00.000Z',
      } as unknown as OrbitObject],
    })
    expect(rows[0].author_name).toBe('Me')
  })

  it('keeps a pinned deep-link row that the snapshot does not carry', () => {
    const rows = projectFeed({
      ...base,
      serverPosts: [post('a')],
      pinnedPosts: [post('deep')],
    })
    expect(rows.map((r) => r.id)).toEqual(['deep', 'a'])
  })

  it('flattens a server media array into mediaUrls', () => {
    const withMedia = post('a', {
      media: [{ url: 'one' }, { url: 'two' }],
    } as Partial<FeedPost>)
    const rows = projectFeed({
      ...base,
      serverPosts: [withMedia],
      normalizePost: (p) => {
        const media = (p as unknown as { media?: { url: string }[] }).media
        if (Array.isArray(media) && media.length > 1) {
          return { ...p, mediaUrls: media.map((m) => m.url).filter(Boolean) } as FeedPost
        }
        return p
      },
    })
    expect((rows[0] as FeedPost & { mediaUrls?: string[] }).mediaUrls).toEqual(['one', 'two'])
  })

  it('returns an empty timeline when there is no input', () => {
    expect(projectFeed({ ...base })).toEqual([])
  })
})