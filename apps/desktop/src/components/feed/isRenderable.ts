import { hasMedia, type PostLike } from './postModel';

/**
 * The one rule for "is this row a post?".
 *
 * A post is CONTENT: words or media. Text is content, so a text-only row shows
 * immediately as a clean text card — it is NEVER hidden for having no picture.
 * Only a row with no words AND no media is dropped: it is an empty card.
 *
 * `ObjectImage` reports the separate, later failure: MEDIA bytes that never
 * arrive. That is the tile's own `onMediaUnavailable` → `hidePost`, not this
 * predicate, because at this point the row may still be in flight; text-only
 * rows never make that call.
 */
export type RenderablePost = PostLike;

export function isRenderable(post: RenderablePost): boolean {
  if (hasMedia(post)) return true;
  return typeof post?.caption === 'string' && post.caption.trim().length > 0;
}

/** Rows dropped by the predicate, for the dev-only counter in the feed header. */
export function countHidden(posts: RenderablePost[]): number {
  let n = 0
  for (const p of posts) if (!isRenderable(p)) n++
  return n
}
