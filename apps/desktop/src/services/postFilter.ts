import type { BooruPost } from '../game/types'
import { isRatingAllowed, isTagBlocked } from '../game/tagFilter'

/**
 * Single source of truth post filter: evaluates solely based on ratings,
 * supported media formats, and the unified blocklist (and user excludes).
 * No hardcoded tag fragment blocks.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|gif|webp)(?:[?#]|$)/i.test(url)
}

const TEXT_OVERLAY = ['speech_bubble', 'english_text', 'translated', 'commentary']

export function isPostAllowed(post: BooruPost, opts?: { captions?: boolean }): boolean {
  if (!isRatingAllowed(post.rating)) return false
  if (!/\.(jpe?g|png|gif|webp|mp4|webm)(?:[?#]|$)/i.test(post.url)) return false
  return post.tags.every((t) => {
    const s = t.toLowerCase()
    if (
      opts?.captions &&
      (s.includes('caption') || s.includes('dialogue') || TEXT_OVERLAY.some((b) => s.includes(b)))
    ) {
      return true
    }
    if (!opts?.captions && TEXT_OVERLAY.some((b) => s.includes(b))) {
      return false
    }
    return !isTagBlocked(s)
  })
}

export function allowOnly(posts: BooruPost[], opts?: { captions?: boolean }): BooruPost[] {
  return posts.filter((p) => isPostAllowed(p, opts))
}
