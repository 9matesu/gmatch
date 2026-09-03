import type { BooruPost } from '../game/types'
import { isRatingAllowed } from '../game/tagFilter'

/**
 * Content quality gate (user spec): humans only, no AI-generated slop,
 * no furry/anthro, no B&W/paper/comic media, no tiny/degraded files.
 * Applied in addition to the hard blocklist (tagFilter).
 */
export function isPostAllowed(post: BooruPost): boolean {
  if (!isRatingAllowed(post.rating)) return false
  if (!/\.(jpe?g|png)$/i.test(post.url)) return false // no webm/gif/mp4
  return post.tags.every((t) => {
    const s = t.toLowerCase()
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

export function allowOnly(posts: BooruPost[]): BooruPost[] {
  return posts.filter(isPostAllowed)
}
