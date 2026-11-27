/**
 * Ordering helpers for the social feed snapshot.
 *
 * The timeline has two independent writers:
 *
 *  1. the snapshot read (`GET /api/posts?limit=50`) — a full replacement, and
 *  2. the WS push (`orbit-feed-new`) — a single post that arrived after the
 *     snapshot request was already on the wire.
 *
 * Without a reconciliation step the (older) snapshot lands last and drops the
 * pushed post until the next background sync — the "a new post vanished" half
 * of the timeline inconsistency. `mergeRecentPushes` keeps a pushed post alive
 * across that in-flight window and lets the snapshot retire it once the row is
 * actually listed, so the effect is self-healing and bounded.
 */

/** How long a pushed post may outlive a snapshot that does not list it. */
export const RECENT_PUSH_TTL_MS = 2 * 60_000

/** Hard bound on remembered pushes (the feed window is 50). */
export const RECENT_PUSH_LIMIT = 20

export interface PushedEntry<T> {
  post: T
  at: number
}

function createdAtMs(post: unknown): number {
  const raw = (post as { created_at?: unknown })?.created_at
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

/** Remember a pushed post; newest wins, oldest evicted past the bound. */
export function rememberPushed<T extends { id: string }>(
  store: Map<string, PushedEntry<T>>,
  post: T | null | undefined,
  now: number = Date.now(),
): void {
  const id = post?.id
  if (!id) return
  // Re-insert so Map iteration order stays least-recent-first.
  store.delete(id)
  store.set(id, { post, at: now })
  while (store.size > RECENT_PUSH_LIMIT) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/**
 * Fold still-relevant pushed posts in front of a fresh snapshot.
 *
 * An entry is retired when the snapshot lists it (the node caught up) or when
 * it is older than `RECENT_PUSH_TTL_MS` (a post that never became listable —
 * deleted, hidden — must not cling to the top of the feed forever). Mutates
 * `store` only by retiring entries; never invents a post.
 */
export function mergeRecentPushes<T extends { id: string }>(
  snapshot: T[],
  store: Map<string, PushedEntry<T>>,
  now: number = Date.now(),
): T[] {
  if (store.size === 0) return snapshot
  const listed = new Set(snapshot.map((p) => p.id))
  const keep: T[] = []
  for (const [id, entry] of Array.from(store.entries())) {
    if (listed.has(id) || now - entry.at > RECENT_PUSH_TTL_MS) {
      store.delete(id)
      continue
    }
    keep.push(entry.post)
  }
  if (keep.length === 0) return snapshot
  keep.sort((a, b) => createdAtMs(b) - createdAtMs(a))
  return [...keep, ...snapshot]
}

/** Fields a timeline row renders. Two rows equal in all of them are the same
 *  row to the reader, so a fresh snapshot may keep the old object. */
const ROW_FIELDS = [
  'url',
  'caption',
  'created_at',
  'like_count',
  'comment_count',
  'is_liked',
  'is_saved',
  'is_archived',
] as const

/**
 * True when a fresh snapshot carries exactly what is already on screen.
 *
 * The timeline is re-read on a socket push and on return to focus, so the same
 * rows arrive again about once a second. Replacing the array with an equal one
 * is a new reference: the shell re-renders, and a 500-post timeline pays for a
 * 500-card render to draw the same pixels. Keeping the old array makes React
 * bail out, which is the whole point imo  a timeline that did not change must
 * cost nothing.
 */
export function sameTimeline<T extends { id: string }>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>
    const y = b[i] as Record<string, unknown>
    if (x.id !== y.id) return false
    for (const key of ROW_FIELDS) {
      if (x[key] !== y[key]) return false
    }
  }
  return true
}
