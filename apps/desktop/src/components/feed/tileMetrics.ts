import type { FeedPost } from './GMatchFeed'
import { hasMedia as postHasMedia } from './postModel'

/**
 * Session cache of width/height per post (and per media object). A re-render
 * must not re-probe a picture it already measured.
 */
const ratios = new Map<string, number>()
/** A text-only post has no pixels, so the row math gives it a card shape. */
const TEXT_TILE_RATIO = 1.5

/** Media presence comes from the one post model, not a field-by-field check. */
export function hasMedia(post: FeedPost): boolean {
  return postHasMedia(post)
}

export function ratioOf(post: FeedPost): number | undefined {
  return ratios.get(post.id) ?? ratios.get(post.media?.[0]?.id || '') ?? (hasMedia(post) ? undefined : TEXT_TILE_RATIO)
}

export function rememberRatio(post: FeedPost, w: number, h: number): boolean {
  if (!w || !h) return false
  const ratio = w / h
  const known = ratios.get(post.id)
  if (known && Math.abs(known - ratio) < 0.001) return false
  ratios.set(post.id, ratio)
  const m = post.media?.[0]
  if (m?.id) ratios.set(m.id, ratio)
  return true
}
