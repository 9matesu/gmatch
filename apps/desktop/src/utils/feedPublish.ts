/**
 * Reconciling a just-published post with the node's feed (plan B, area 5).
 *
 * Publishing is a POST whose response already names the new object; reading the
 * feed is a separate GET that (a) answers from a 3s in-memory cache and (b) can
 * run before the node indexes the row. So the old "upload → loadServerFeed()"
 * showed the pre-upload snapshot, and a successful post looked like it had been
 * dropped. The feed keeps the optimistic tile (the bytes are already durable
 * locally) and this helper decides when the authoritative list has caught up,
 * retrying a bounded number of times.
 */

export interface FeedPostLike {
  id: string
  mediaUrls?: string[]
}

/** True when the authoritative list already carries the published post. */
export function postVisibleInFeed(posts: readonly FeedPostLike[] | null | undefined, id: string): boolean {
  const wanted = String(id || '')
  if (!wanted) return false
  for (const p of posts || []) {
    if (!p) continue
    if (String(p.id) === wanted) return true
    // Multi-image posts are addressed by their primary object id; the node may
    // list the post under a group id while the media still names our object.
    if (Array.isArray(p.mediaUrls) && p.mediaUrls.some((u) => String(u).endsWith(`/${wanted}`))) return true
  }
  return false
}

export interface ReconcileOptions {
  id: string
  /** Forced refresh (must bypass the GET cache). Returns the fresh list. */
  refresh: () => Promise<FeedPostLike[] | null | undefined>
  attempts?: number
  /** Injected for tests; defaults to a growing backoff. */
  wait?: (ms: number) => Promise<void>
}

/**
 * Resolve true as soon as the feed shows the post, false when the bounded
 * attempts ran out (the caller keeps the optimistic tile: a post that is
 * durable locally but not yet readable from the node is "pending", not lost).
 */
export async function reconcilePublishedPost(opts: ReconcileOptions): Promise<boolean> {
  const id = String(opts.id || '')
  if (!id) {
    // Nothing to match on; still refresh once so the feed is not stale.
    await opts.refresh().catch(() => null)
    return false
  }
  const attempts = Math.max(1, opts.attempts ?? 5)
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const posts = await opts.refresh().catch(() => null)
    if (postVisibleInFeed(posts, id)) return true
    if (attempt < attempts - 1) await wait(800 + attempt * 700)
  }
  return false
}
