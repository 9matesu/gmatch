// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFeedController, type FeedControllerInput } from './useFeedController'
import type { FeedPost } from '../../components/feed/GMatchFeed'

// jsdom in this repo has no localStorage; stub it the way the other
// persistence tests do.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
  key: () => null,
  length: 0,
} as Storage

/**
 * The feed controller's projection must not be re-computed because the
 * CALLER passed a new callback.
 *
 * This is the regression test for the idle CPU burn: `normalizePost` was an
 * inline arrow in App's `useFeedController(...)` call, so it was a new
 * identity on every render — and it was a dependency of the projection memo.
 * The timeline was therefore re-projected on every render, `feedPosts` got a
 * new identity on every render, and App's profile effect (which depends on
 * `feedPosts`) re-ran, cleared a state array and re-rendered. An infinite
 * render loop that burned ~3 CPU cores with nothing on screen but the idle
 * clicker.
 *
 * Two things are asserted:
 *  1. a re-render with a FRESH inline `normalizePost` does not re-project the
 *     timeline (the memo's deps are the DATA, not the callback);
 *  2. the normalizer is still applied when the timeline really does change
 *     (the ref must not swallow the callback).
 */

const USERS = [] as const
const PROFILE_PICS: Record<string, string> = {}
const ITEMS = [] as const
const MY_PROFILE = { displayName: 'Tester' }
const DELETED = new Set<string>()
const ARCHIVED = new Set<string>()

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

/** The App-side normalizer: a multi-image post carries them in `media`. */
function normalizeFeedPost(p: FeedPost): FeedPost {
  const media = (p as unknown as { media?: { url?: string }[] }).media
  if (Array.isArray(media) && media.length > 1) {
    return { ...p, mediaUrls: media.map((m) => m.url).filter(Boolean) as string[] }
  }
  return p
}

describe('useFeedController projection stability', () => {
  it('does not re-project the timeline when the caller passes a new normalizePost', () => {
    const normalize = vi.fn(normalizeFeedPost)

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        const input: FeedControllerInput = {
          identity: null,
          users: USERS,
          profilePics: PROFILE_PICS,
          myProfile: MY_PROFILE,
          items: ITEMS,
          deletedPostIds: DELETED,
          archivedPostIds: ARCHIVED,
          feedSort: 'latest',
          // An INLINE arrow: a new identity on every render, exactly like the
          // App call site that caused the idle CPU burn.
          normalizePost: (p) => normalize(p),
        }
        // `tick` is only here to make the hook re-render on demand.
        void tick
        return useFeedController(input)
      },
      { initialProps: { tick: 0 } },
    )

    act(() => {
      result.current.setServerPosts([
        post('a', { media: [{ url: 'https://cdn.test/a-1.jpg' }, { url: 'https://cdn.test/a-2.jpg' }] } as Partial<FeedPost>),
      ])
    })

    const timeline = result.current.posts
    expect(timeline).toHaveLength(1)
    const callsAfterProjection = normalize.mock.calls.length
    expect(callsAfterProjection).toBeGreaterThan(0)

    // A re-render with a FRESH inline normalizePost: the timeline must be the
    // SAME array, and the normalizer must not run again.
    rerender({ tick: 1 })

    expect(result.current.posts).toBe(timeline)
    expect(normalize.mock.calls.length).toBe(callsAfterProjection)
  })

  it('still normalizes a post that arrives later', () => {
    const { result } = renderHook(() => useFeedController({
      identity: null,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    act(() => {
      result.current.setServerPosts([
        post('b', { media: [{ url: 'https://cdn.test/b-1.jpg' }, { url: 'https://cdn.test/b-2.jpg' }] } as Partial<FeedPost>),
      ])
    })

    const row = result.current.posts[0]
    expect(row.id).toBe('b')
    expect(row.mediaUrls).toEqual(['https://cdn.test/b-1.jpg', 'https://cdn.test/b-2.jpg'])
  })

  it('drops the previous world\'s timeline when a server switch commits', () => {
    const { result } = renderHook(() => useFeedController({
      identity: null,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    act(() => {
      result.current.setServerPosts([post('old-world')])
      result.current.setMyProfilePosts([post('old-self')])
    })
    expect(result.current.posts.map((p) => p.id)).toEqual(['old-world', 'old-self'])

    act(() => {
      window.dispatchEvent(new CustomEvent('gmatch-api-base-changed', {
        detail: { base: 'http://friend-node:8790' },
      }))
    })

    expect(result.current.posts).toEqual([])
    expect(result.current.serverPosts).toEqual([])
    expect(result.current.myProfilePosts).toEqual([])
    expect(result.current.status).toBe('idle')
  })
})
