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

/** Long-form video threshold: short mp4/webm loops (redgifs gifs) stay,
 *  only videos with duration metadata above this are dropped. */
export const LONG_VIDEO_SEC = 90

function durationSec(post: BooruPost): number | null {
  const r = post as unknown as Record<string, unknown>
  const candidates = [r.length_sec, r.duration, r.lengthSec, r.durationSec]
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : typeof c === 'number' ? c : NaN
    if (Number.isFinite(n) && n > 0) return n
  }
  if (typeof r.length_min === 'string') {
    const m = /^(\d+):(\d{1,2})$/.exec(r.length_min.trim())
    if (m) return Number(m[1]) * 60 + Number(m[2])
  }
  return null
}

/** True only when duration metadata proves a long-form video (> LONG_VIDEO_SEC).
 *  Duration-less mp4/webm (redgifs loops, realbooru clips) are NOT long. */
export function isLongVideo(post: BooruPost): boolean {
  if (!/\.(mp4|webm)(?:[?#]|$)/i.test(post.url)) return false
  if (typeof post.id === 'string' && post.id.startsWith('rg-')) return false
  const secs = durationSec(post)
  return secs !== null && secs > LONG_VIDEO_SEC
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
  return posts.filter((p) => !isLongVideo(p) && isPostAllowed(p, opts))
}
