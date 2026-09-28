/**
 * "Liked by" summarisation, Instagram-style.
 *
 * The feed payload carries a short, newest-first `likers` preview (see
 * withLikersPreview in apps/api/src/routes/posts.ts) plus the authoritative
 * `like_count`. The count always drives the "and N others" tail, so the
 * summary can never drift from the number shown next to the heart.
 */

export interface LikerPreview {
  user_id: string
  display_name: string
  pfp_url?: string | null
}

/** Names only, in payload order, de-duplicated by user id. */
function likerNames(likers: LikerPreview[] | undefined, cap: number): string[] {
  if (!Array.isArray(likers)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const l of likers) {
    if (!l) continue
    const key = l.user_id || l.display_name
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = (l.display_name || '').trim()
    if (name) names.push(name)
    if (names.length >= cap) break
  }
  return names
}

function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/**
 * How many names to spell out before switching to "and N others".
 * 2 reads naturally ("Ana and Bo"); 3 starts to wrap on a phone.
 */
const NAMES_BEFORE_OTHERS = 2

/**
 * "Liked by Ana, Bo and 12 others" summary, or '' when there is nothing to
 * name — callers fall back to the bare count. No names is the normal case for
 * a post the API has no `likers` preview for (older rows, the liker themself,
 * a just-created post), and "Liked by 3 people" is strictly worse than "3
 * likes" there.
 *
 * Shapes:
 *  - 0 likes                -> ''
 *  - 1 like, 1 name         -> 'Liked by Ana'
 *  - 2 likes, 2 names       -> 'Liked by Ana and Bo'
 *  - 3+ likes, >=2 names    -> 'Liked by Ana, Bo and 1 other'
 *  - no names               -> '' (caller shows the count)
 */
export function formatLikedBy(
  likers: LikerPreview[] | undefined,
  likeCount: number,
): string {
  const count = Math.max(0, Math.floor(Number(likeCount) || 0))
  if (count === 0) return ''
  const names = likerNames(likers, NAMES_BEFORE_OTHERS + 1)
  if (names.length === 0) return ''

  if (count === 1) return `Liked by ${names[0]}`
  const shown = names.slice(0, NAMES_BEFORE_OTHERS)
  const rest = count - shown.length
  if (rest <= 0) return `Liked by ${joinNames(shown)}`
  const others = rest === 1 ? '1 other' : `${rest} others`
  return `Liked by ${joinNames(shown)} and ${others}`
}

