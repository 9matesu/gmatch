/**
 * The one rule for "is this row a post?" (SPEC: an image network shows no empty
 * card). A row is rendered only when it carries MEDIA — a resolvable url or
 * media bytes. A caption-only row with no bytes is dropped: the player has
 * nothing to see, so it must not sit in the feed waiting.
 *
 * `ObjectImage` reports the separate, later failure: bytes that never arrive.
 * That is the tile's own `onMediaUnavailable` → `hidePost`, not this predicate,
 * because at this point the row may still be in flight.
 */
export type RenderablePost = {
  caption?: string | null
  url?: string | null
  localPreviewUrl?: string | null
  media?: { url?: string | null }[] | null
  mediaUrls?: string[] | null
}

export function isRenderable(post: RenderablePost): boolean {
  if (post.url && post.url.trim()) return true
  if (post.localPreviewUrl) return true
  if (post.mediaUrls?.some((u) => !!u && u.trim())) return true
  if (post.media?.some((m) => !!m?.url && m.url.trim())) return true
  return false
}

/** Rows dropped by the predicate, for the dev-only counter in the feed header. */
export function countHidden(posts: RenderablePost[]): number {
  let n = 0
  for (const p of posts) if (!isRenderable(p)) n++
  return n
}