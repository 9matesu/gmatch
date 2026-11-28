// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useFeedController, type FeedControllerInput } from './useFeedController'
import type { FeedPost } from '../../components/feed/GMatchFeed'
import { writeCachedFeed } from './feedSnapshotCache'
import { invalidateCache, orbitFetch } from '../../utils/api'

// The controller owns the network; stub it so a first read can be made to
// answer empty exactly once (the stale/early-node case).
vi.mock('../../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api')>()
  return { ...actual, orbitFetch: vi.fn(), invalidateCache: vi.fn() }
})

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
// One object per identity: App reads identity from a store (stable reference),
// and an inline literal would re-arm any effect keyed on `load` every render.
const IDENTITIES = {
  mount: { orbitId: 'mount' },
  cached: { orbitId: 'cached-mount' },
  late: { orbitId: 'late-node' },
  self: { orbitId: 'self' },
  refreshFailure: { orbitId: 'refresh-failure' },
  emptyRefresh: { orbitId: 'empty-refresh' },
} as const

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
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key]
    vi.mocked(orbitFetch).mockReset()
    vi.mocked(invalidateCache).mockClear()
  })

  it('loads the first page on mount, without a navigation or a manual load()', async () => {
    vi.mocked(orbitFetch).mockImplementation(async () => ({
      ok: true, status: 200, json: async () => ({ posts: [post('mount-a'), post('mount-b')] }),
    } as Response))

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.mount as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['mount-a', 'mount-b'])
    })
    expect(result.current.status).toBe('ready')
    expect(vi.mocked(orbitFetch)).toHaveBeenCalled()
  })

  it('paints the cached snapshot immediately, then revalidates it', async () => {
    writeCachedFeed('cached-mount', [post('cached-1')])
    let release: (res: Response) => void = () => {}
    vi.mocked(orbitFetch).mockImplementation(() => new Promise<Response>((r) => { release = r }))

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.cached as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    // The cached rows are on screen BEFORE the first read settles — no blocking
    // await, no second "Loading…" screen after the boot splash.
    expect(result.current.posts.map((p) => p.id)).toEqual(['cached-1'])
    expect(result.current.restoredFromCache).toBe(true)

    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ posts: [post('live-1')] }) } as Response)
    })
    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['live-1'])
    })
    expect(result.current.restoredFromCache).toBe(false)
  })

  it('retries a failed first read until the node answers, with no navigation', async () => {
    let calls = 0
    vi.mocked(orbitFetch).mockImplementation(async () => {
      calls += 1
      if (calls < 3) return { ok: false, status: 503, json: async () => ({}) } as Response
      return { ok: true, status: 200, json: async () => ({ posts: [post('late')] }) } as Response
    })

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.late as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['late'])
    }, { timeout: 6000 })
    expect(calls).toBeGreaterThanOrEqual(3)
  }, 10_000)

  it('re-arms the first read after a world switch resets the feed', async () => {
    let reads = 0
    vi.mocked(orbitFetch).mockImplementation(async () => {
      reads += 1
      return { ok: true, status: 200, json: async () => ({ posts: [post(`world-${reads}`)] }) } as Response
    })

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.mount as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['world-1'])
    })
    act(() => {
      window.dispatchEvent(new CustomEvent('gmatch-api-base-changed', {
        detail: { base: 'http://friend-node:8790' },
      }))
    })
    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['world-2'])
    })
  })

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

  it('promotes posts from the first feed read without a profile round-trip', async () => {
    // The node can answer with an empty snapshot while it boots, and the 3s
    // GET cache can hold that answer. "ready but empty" used to be treated as
    // settled: the posts only appeared after opening a profile (whose own
    // author_id query re-read the node) and coming back.
    let reads = 0
    vi.mocked(orbitFetch).mockImplementation(async () => {
      reads += 1
      const posts = reads === 1 ? [] : [post('fresh')]
      return { ok: true, status: 200, json: async () => ({ posts }) } as Response
    })

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.self as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    // The mount read is the one that answers empty; the empty-read retry must
    // pick it up with a cache bypass — no profile round-trip, no manual load().
    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['fresh'])
    }, { timeout: 5000 })
    expect(result.current.status).toBe('ready')
    expect(reads).toBeGreaterThanOrEqual(2)
    expect(invalidateCache).toHaveBeenCalledWith('/api/posts')
  })

  it('keeps the last good timeline when a refresh fails', async () => {
    // The node can die between two reads. A 502 (or a network throw) is not an
    // empty feed: the rows already on screen came from a real answer and must
    // stay, with an honest offline status instead of "No posts yet".
    let calls = 0
    vi.mocked(orbitFetch).mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return { ok: true, status: 200, json: async () => ({ posts: [post('a'), post('b'), post('c')] }) } as Response
      }
      return { ok: false, status: 502, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.refreshFailure as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    // Mount already performed the first read; wait for it to settle before the
    // refresh that fails, so the two requests cannot supersede each other.
    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    })
    expect(result.current.status).toBe('ready')

    await act(async () => { await result.current.refresh() })
    expect(result.current.status).toBe('offline')
    expect(result.current.posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not wipe a populated timeline when the node answers empty on refresh', async () => {
    // A sidecar that restarted with a fresh DB can answer 200 with no rows.
    // That is not "nobody posted" for a device that already read three posts:
    // keep the last good rows and say the refresh did not confirm them.
    let calls = 0
    vi.mocked(orbitFetch).mockImplementation(async () => {
      calls += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ posts: calls === 1 ? [post('a'), post('b'), post('c')] : [] }),
      } as Response
    })

    const { result } = renderHook(() => useFeedController({
      identity: IDENTITIES.emptyRefresh as never,
      users: USERS,
      profilePics: PROFILE_PICS,
      myProfile: MY_PROFILE,
      items: ITEMS,
      deletedPostIds: DELETED,
      archivedPostIds: ARCHIVED,
      feedSort: 'latest',
      normalizePost: normalizeFeedPost,
    }))

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    })

    await act(async () => { await result.current.refresh() })
    expect(result.current.posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.status).toBe('offline')
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
