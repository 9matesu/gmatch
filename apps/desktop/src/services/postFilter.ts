import type { BooruPost } from '../game/types'
import { isRatingAllowed } from '../game/tagFilter'

/**
 * Content quality gate (user spec): humans only, no AI-generated slop,
 * no furry/anthro, no B&W/paper/comic media, no tiny/degraded files.
 * Applied in addition to the hard blocklist (tagFilter).
 * Images AND motion (gif/mp4/webm) pass — kind is inferred at render.
 * Caption hunts (query carries caption/goon_caption) keep text-overlay tags
 * that the gate otherwise drops, mirroring electron/main.cjs.
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
    )
      return true
    return (
      !s.includes('ai_generated') &&
      !s.includes('ai-generated') &&
      !s.includes('monochrome') &&
      !s.includes('greyscale') &&
      !s.includes('grayscale') &&
      !s.includes('sketch') &&
      !s.includes('comic') &&
      !s.includes('3d') &&
      !s.includes('furry') &&
      !s.includes('anthro') &&
      !s.includes('scalie') &&
      !s.includes('feral') &&
      !s.includes('animal_') &&
      !s.includes('monster_') &&
      !s.includes('horse') &&
      !s.includes('dog_') &&
      !s.includes('wrong_eye') &&
      !s.startsWith('bad_') &&
      s !== 'video' &&
      s !== 'animated' &&
      s !== 'scan' &&
      !s.includes('speech_bubble') &&
      !s.includes('english_text') &&
      !s.includes('translated') &&
      !s.includes('commentary') &&
      s !== 'watermark' &&
      s !== 'yaoi' &&
      s !== 'futanari' &&
      s !== 'trap' &&
      s !== 'netorare' &&
      s !== 'vocaloid' &&
      s !== 'tentacles'
    )
  })
}

export function allowOnly(posts: BooruPost[], opts?: { captions?: boolean }): BooruPost[] {
  return posts.filter((p) => isPostAllowed(p, opts))
}
