import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import type { FeedPost } from '../../components/feed/GMatchFeed'
import type { OrbitObject, User } from '@orbit/shared'
import { orbitFetch, subscribeApiBase } from '../../utils/api'
import { usePeerFeedPosts } from '../../hooks/usePeerFeedPosts'
import { localFeedPosts } from '../../utils/localFeed'
import { rememberPushed, type PushedEntry } from '../../utils/feedMerge'
import { projectFeed } from './feedProjection'
import {
  feedTimelineUnchanged, fetchFeedSnapshot, fetchPostById, invalidateFeedCache,
} from './feedRepository'
import { readCachedFeed, writeCachedFeed } from './feedSnapshotCache'

/**
 * Feed controller: the stateful half. Owns the request sequence (so a slow
 * earlier snapshot can never overwrite a newer one), the remembered WS pushes,
 * the pinned deep-link row and the outbox tick, and returns the projected
 * timeline plus the operations the UI needs.
 *
 * The pure merge lives in `feedProjection.ts`; the network in
 * `feedRepository.ts`. This file is the only one that knows React.
 */

export type FeedStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'error'

export interface FeedControllerInput {
  identity: OrbitIdentity | null
  users: readonly User[]
  profilePics: Readonly<Record<string, string>>
  myProfile: { displayName: string }
  /** Locally-held objects (gallery/swarm store). */
  items: readonly OrbitObject[]
  deletedPostIds: ReadonlySet<string>
  archivedPostIds: ReadonlySet<string>
  feedSort: string
  normalizePost: (post: FeedPost) => FeedPost
}

export interface FeedController {
  posts: FeedPost[]
  /** The raw server snapshot (before merge), for callers that need "what the
   *  node listed" rather than the rendered timeline (badge baseline, tag sync). */
  serverPosts: FeedPost[]
  /** The caller's own profile rows (node snapshot + local/P2P mirrors), so a
   *  delete can tell a node-backed post from a local-only one. */
  myProfilePosts: FeedPost[]
  /** Peer-replicated rows projected from the durable log (with the LOCAL
   *  bookmark flag folded in), independent of any node read. */
  peerPosts: FeedPost[]
  status: FeedStatus
  /** True while the timeline came from the durable snapshot (this device's own
   *  last read) rather than a live node response. */
  restoredFromCache: boolean
  hasMore: boolean
  loadingMore: boolean
  load: () => Promise<FeedPost[]>
  refresh: () => Promise<FeedPost[]>
  loadMore: () => Promise<void>
  resolvePostById: (postId: string) => Promise<boolean>
  setServerPosts: React.Dispatch<React.SetStateAction<FeedPost[]>>
  setOptimisticPosts: React.Dispatch<React.SetStateAction<FeedPost[]>>
  setPinnedPosts: React.Dispatch<React.SetStateAction<FeedPost[]>>
  setRepostedPosts: React.Dispatch<React.SetStateAction<FeedPost[]>>
  setMyProfilePosts: React.Dispatch<React.SetStateAction<FeedPost[]>>
  removePost: (postId: string) => void
  /** Register a WS push so it survives an in-flight snapshot. */
  pushPost: (post: FeedPost | null | undefined) => void
  reset: () => void
}

const PAGE_SIZE = 50
const MORE_PAGE_SIZE = 20

export function useFeedController(input: FeedControllerInput): FeedController {
  const { identity, users, profilePics, myProfile, items, deletedPostIds, archivedPostIds, feedSort, normalizePost } = input

  const [serverPosts, setServerPosts] = useState<FeedPost[]>([])
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [optimisticPosts, setOptimisticPosts] = useState<FeedPost[]>([])
  const [pinnedPosts, setPinnedPosts] = useState<FeedPost[]>([])
  const [repostedPosts, setRepostedPosts] = useState<FeedPost[]>([])
  const [myProfilePosts, setMyProfilePosts] = useState<FeedPost[]>([])
  const [outboxTick, setOutboxTick] = useState(0)

  const seqRef = useRef(0)
  const pushedRef = useRef<Map<string, PushedEntry<FeedPost>>>(new Map())
  const postsRef = useRef<FeedPost[]>([])
  /**
   * The caller's `normalizePost`, read through a ref.
   *
   * It used to be a DEPENDENCY of the projection memo below. A caller that
   * passes an inline arrow (a new identity on every render) therefore
   * re-projected the whole timeline on every render, so `posts` got a new
   * identity on every render too — and every effect that depends on the
   * timeline re-ran on every render. In App that was an infinite loop: the
   * profile effect cleared a state array, the clear re-rendered the app, and
   * the app re-projected the timeline. The result was ~3 CPU cores burned at
   * idle with no user interaction.
   *
   * A ref keeps the memo's dependencies to the DATA. The latest callback is
   * still used whenever the projection actually recomputes.
   */
  const normalizePostRef = useRef(normalizePost)
  normalizePostRef.current = normalizePost
  /**
   * True while the timeline on screen came from the durable snapshot rather
   * than from a read this session. It is what makes the stale-first behaviour
   * honest: the UI can say "showing what you had" instead of implying the node
   * answered. Cleared the moment a live snapshot lands.
   */
  const [restoredFromCache, setRestoredFromCache] = useState(false)

  // Hydrate from the durable snapshot BEFORE the first read, so a node that is
  // still booting (or a machine that is offline) shows the timeline this device
  // already holds instead of "Loading…". This is a STALE read by definition:
  // the live snapshot below replaces it as soon as it lands.
  const identityId = identity?.orbitId ?? null
  useEffect(() => {
    if (!identityId) {
      setServerPosts([])
      setRestoredFromCache(false)
      return
    }
    const cached = readCachedFeed(identityId)
    if (cached && cached.posts.length > 0) {
      setServerPosts((prev) => (prev.length > 0 ? prev : cached.posts))
      setRestoredFromCache(true)
    } else {
      setRestoredFromCache(false)
    }
  }, [identityId])

  // Persist each successful live snapshot, so the NEXT boot has something to
  // show. Keyed by identity, so a second player never inherits this one's feed.
  useEffect(() => {
    if (!identityId || status !== 'ready' || serverPosts.length === 0) return
    if (restoredFromCache) return
    writeCachedFeed(identityId, serverPosts)
  }, [identityId, status, serverPosts, restoredFromCache])

  // Signing out must not leave this player's timeline on the disk for the next
  // identity to read.
  useEffect(() => {
    if (identityId) return
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('gmatch.feed.snapshot.v1:')) localStorage.removeItem(key)
    }
  }, [identityId])

  // The outbox is durable storage, not state: bump a counter when it changes so
  // a post that is still local/pending appears (and updates) without a reload.
  useEffect(() => {
    const bump = () => setOutboxTick((n) => n + 1)
    window.addEventListener('gmatch:post-outbox-changed', bump)
    return () => window.removeEventListener('gmatch:post-outbox-changed', bump)
  }, [])

  const peerFeedPosts = usePeerFeedPosts(identity?.orbitId)

  const localPending = useMemo(
    () => localFeedPosts(identity, myProfile.displayName),
    // outboxTick is the invalidation signal for the durable store
    [identity, myProfile.displayName, outboxTick],
  )

  const posts = useMemo(() => projectFeed({
    items, optimisticPosts, localPending, pinnedPosts, peerFeedPosts,
    serverPosts, repostedPosts, myProfilePosts,
    deletedPostIds, archivedPostIds, users, profilePics,
    identity, myProfile, normalizePost: normalizePostRef.current,
  }), [
    items, optimisticPosts, localPending, pinnedPosts, peerFeedPosts, serverPosts,
    repostedPosts, myProfilePosts, deletedPostIds, archivedPostIds, users,
    profilePics, identity, myProfile,
  ])

  useEffect(() => { postsRef.current = posts }, [posts])

  const load = useCallback((): Promise<FeedPost[]> => {
    if (!identity) return Promise.resolve([])
    // Every trigger shares one ordering: a response that is no longer the
    // newest request is discarded instead of replacing fresher state.
    const seq = ++seqRef.current
    setStatus((prev) => (prev === 'idle' ? 'loading' : prev))
    setHasMore(true)
    const pushed = pushedRef.current
    const current = () => seqRef.current
    return fetchFeedSnapshot({ fetch: orbitFetch, pushed }, identity, seq, current, { limit: PAGE_SIZE, sort: feedSort })
      .then((snap) => {
        if (snap.stale) return []
        if (!snap.ok) {
          // 404 = this node hosts no feed: a state, not a retryable failure.
          // A restored snapshot stays on screen (it is this device's own data);
          // the status says which one the player is looking at.
          setStatus('offline')
          return []
        }
        setServerPosts((prev) => (feedTimelineUnchanged(prev, snap.posts) ? prev : snap.posts))
        setRestoredFromCache(false)
        setStatus('ready')
        setHasMore(snap.posts.length >= PAGE_SIZE)
        return snap.posts
      })
      .catch(() => {
        if (seq === seqRef.current) {
          // Keep a working feed on screen when only a background refresh fails.
          setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'))
        }
        return []
      })
  }, [identity, feedSort])

  const refresh = useCallback(() => {
    invalidateFeedCache()
    return load()
  }, [load])

  /**
   * A first read that answers with NO rows is not a settled timeline. The
   * local node can still be booting, and the 3s GET cache can hold that empty
   * answer while the real posts arrive. The caller's boot loop only retries
   * error/offline states, so a "ready but empty" first read used to sit there
   * until the player opened a profile (whose own author_id query re-read the
   * node) and came back. Re-read with a cache BYPASS, bounded, and let the
   * request sequence above discard any superseded answer.
   */
  const emptyReadRetries = useRef(0)
  useEffect(() => {
    if (!identity || status !== 'ready' || posts.length > 0) {
      emptyReadRetries.current = 0
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const retry = () => {
      if (cancelled) return
      emptyReadRetries.current += 1
      void refresh()
      if (emptyReadRetries.current < 3) timer = setTimeout(retry, 1200)
    }
    timer = setTimeout(retry, 1200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [identity, status, posts.length, refresh])

  /**
   * Returning to a visible window re-reads the node, with the response cache
   * dropped: a push can land while the tab is hidden and the cached answer
   * would otherwise keep the new row off screen. Bounded to one refresh per
   * 15s, generation-guarded by `load` above.
   */
  const lastVisibleRefresh = useRef(0)
  useEffect(() => {
    if (!identity || typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastVisibleRefresh.current < 15_000) return
      lastVisibleRefresh.current = now
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [identity, refresh])

  const loadMore = useCallback(async () => {
    if (!identity || loadingMore || !hasMore) return
    setLoadingMore(true)
    const seq = ++seqRef.current
    try {
      const res = await orbitFetch(`/api/posts?limit=${MORE_PAGE_SIZE}&sort=${feedSort}&offset=${serverPosts.length}`, {}, identity)
      if (seq !== seqRef.current) return
      const data = await res.json().catch(() => null)
      const more = data && typeof data === 'object' && Array.isArray((data as { posts?: unknown }).posts)
        ? (data as { posts: FeedPost[] }).posts
        : []
      setServerPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        const next = [...prev, ...more.filter((p) => !seen.has(p.id))]
        return feedTimelineUnchanged(prev, next) ? prev : next
      })
      setHasMore(more.length >= MORE_PAGE_SIZE)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [identity, feedSort, loadingMore, hasMore, serverPosts.length])

  const resolvePostById = useCallback(async (postId: string): Promise<boolean> => {
    if (!identity || !postId) return false
    if (postsRef.current.some((p) => p.id === postId)) return true
    const post = await fetchPostById({ fetch: orbitFetch, pushed: pushedRef.current }, identity, postId)
    if (!post) return false
    setPinnedPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)].slice(0, 8))
    return true
  }, [identity])

  const pushPost = useCallback((post: FeedPost | null | undefined) => {
    rememberPushed(pushedRef.current, post)
  }, [])

  const removePost = useCallback((postId: string) => {
    setServerPosts((prev) => prev.filter((p) => p.id !== postId))
  }, [])

  const reset = useCallback(() => {
    seqRef.current++
    pushedRef.current.clear()
    setServerPosts([])
    setOptimisticPosts([])
    setPinnedPosts([])
    setRepostedPosts([])
    setMyProfilePosts([])
    setRestoredFromCache(false)
    setStatus('idle')
    emptyReadRetries.current = 0
    lastVisibleRefresh.current = 0
  }, [])

  /**
   * A committed world switch changes the node that OWNS the timeline. Every
   * row held here came from the previous node (or a push it relayed), so it
   * must be dropped the moment the base changes — otherwise a world with no
   * posts keeps showing the old world's feed, and any in-flight snapshot from
   * the old node could still land afterwards. `invalidateCache()` only clears
   * HTTP responses; THIS is the state that is rendered.
   */
  useEffect(() => subscribeApiBase(() => reset()), [reset])

  return {
    posts, serverPosts, myProfilePosts, peerPosts: peerFeedPosts, status, restoredFromCache, hasMore, loadingMore,
    load, refresh, loadMore, resolvePostById,
    setServerPosts, setOptimisticPosts, setPinnedPosts, setRepostedPosts, setMyProfilePosts,
    removePost, pushPost, reset,
  }
}