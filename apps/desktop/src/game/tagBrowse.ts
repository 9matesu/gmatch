import type { BooruPost } from './types'

/**
 * Tag-picker browsing logic, kept pure and DOM-free so it can be tested
 * directly.
 *
 * The browser is a READ surface: it never buys, owns or keeps anything, and it
 * fetches with `silent` so browsing does not consume the feed's seen-ledger
 * (the same reason tag-market discovery is silent). Everything here is about
 * turning a set of picked tags into one honest query and an honest result.
 */

/** AND query for the picked tags — every tag is required, never OR. */
export function browseQuery(selected: string[]): string {
  return selected
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * First-wins dedupe by post id. Providers overlap heavily (the same picture is
 * mirrored on several boorus), and the same id can also arrive across pages of
 * one walk, so the grid would otherwise repeat tiles. First occurrence wins
 * because the caller's result order is already the provider/relevance order.
 */
export function dedupePosts(posts: BooruPost[]): BooruPost[] {
  const seen = new Set<string>()
  const out: BooruPost[] = []
  for (const p of posts) {
    const id = String(p?.id ?? '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(p)
  }
  return out
}

export interface BooruOutcome {
  source: string | null
  ok: boolean
  offline?: boolean
  cached?: boolean
  emptyFresh?: boolean
}

/**
 * One honest line describing where a result came from. "Offline" is stated as
 * such rather than shown as an empty grid with no explanation — the spec's
 * never-fabricate rule (§6) applies to the browser too.
 */
export function provenanceLabel(res: BooruOutcome, count: number): string {
  if (res.offline || !res.ok) return 'Offline: showing placeholders'
  const via = res.cached ? 'cache' : res.source || 'source'
  if (count === 0) return res.emptyFresh ? `Nothing new from ${via}` : `No results from ${via}`
  return `${count} from ${via}`
}
