import type { OrbitIdentity } from '@orbit/crypto'
import type { FeedPost } from '../../components/feed/GMatchFeed'
import { invalidateCache } from '../../utils/api'
import { mergeRecentPushes, sameTimeline, type PushedEntry } from '../../utils/feedMerge'

/**
 * Feed repository: the network half. One place that knows how to read the
 * server timeline and the by-id deep-link read, with the ordering rules that
 * keep the snapshot from clobbering a fresh push.
 *
 * Stateless by design: the request sequence and the remembered pushes are
 * owned by the caller (the controller), so two consumers cannot silently share
 * a stale sequence counter.
 */
export interface FeedRepositoryDeps {
  /** Signed fetch (orbitFetch already covers timeout/retry/dedupe/cache). */
  fetch: (url: string, init: RequestInit, identity: OrbitIdentity) => Promise<Response>
  /** Remembered WS pushes, newest first. */
  pushed: Map<string, PushedEntry<FeedPost>>
}

export interface FeedSnapshot {
  posts: FeedPost[]
  /** False when the node does not host a stateful feed (blind courier). */
  ok: boolean
  /** True when the request was superseded by a newer one. */
  stale: boolean
}

/**
 * Read one snapshot of the server timeline.
 *
 * `seq`/`current` are the caller's monotonic request counter: a response that is
 * no longer the newest request returns `stale` and must not replace fresher
 * state. A 404 is a STATE ("this node hosts no feed"), not an error to retry.
 */
export async function fetchFeedSnapshot(
  deps: FeedRepositoryDeps,
  identity: OrbitIdentity,
  seq: number,
  current: () => number,
  opts: { limit?: number; sort?: string } = {},
): Promise<FeedSnapshot> {
  const limit = opts.limit ?? 50
  const sort = opts.sort ?? 'recent'
  const res = await deps.fetch(`/api/posts?limit=${limit}&sort=${sort}`, {}, identity)
  if (seq !== current()) return { posts: [], ok: false, stale: true }
  if (res.status === 404) return { posts: [], ok: false, stale: false }
  if (!res.ok) return { posts: [], ok: false, stale: false }
  const data = await res.json().catch(() => null)
  if (seq !== current()) return { posts: [], ok: false, stale: true }
  const raw = data && typeof data === 'object' ? (data as { posts?: unknown }).posts : null
  if (!Array.isArray(raw)) return { posts: [], ok: false, stale: false }
  const posts = mergeRecentPushes(raw as FeedPost[], deps.pushed)
  return { posts, ok: true, stale: false }
}

/**
 * Targeted read for a deep link whose post is not in the current snapshot.
 * One signed request, validated against the id we asked for; a node that does
 * not host the route simply 404s and the deep link keeps the local/P2P copy.
 */
export async function fetchPostById(
  deps: FeedRepositoryDeps,
  identity: OrbitIdentity,
  postId: string,
): Promise<FeedPost | null> {
  const res = await deps.fetch(`/api/posts/${encodeURIComponent(postId)}`, {}, identity).catch(() => null)
  if (!res || !res.ok) return null
  const data = await res.json().catch(() => null)
  const raw = data && typeof data === 'object'
    ? ((data as { post?: unknown }).post ?? data)
    : null
  // Never accept an answer for a different id than the one requested.
  if (!raw || typeof raw !== 'object' || String((raw as { id?: unknown }).id || '') !== postId) return null
  return raw as FeedPost
}

/**
 * Drop cached/inflight feed responses, then reload. A plain reload inside the
 * 3s GET cache (or a stuck inflight request) would otherwise keep serving the
 * stale snapshot that hides fresh posts.
 */
export function invalidateFeedCache(): void {
  invalidateCache('/api/posts')
}

/** True when a fresh snapshot carries exactly what is already on screen, so the
 *  caller can keep the old array and let React bail out. */
export function feedTimelineUnchanged(a: readonly FeedPost[], b: readonly FeedPost[]): boolean {
  return sameTimeline(a, b)
}

export type { PushedEntry }