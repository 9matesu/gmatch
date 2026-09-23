/**
 * Smart round-query builder for the idle feed.
 *
 * One pill per query — never auto-combines separate tags. Combo searches
 * exist only as merged pills (ShopPanel merge flow: "a b" is ONE pill and
 * is never split apart here). Each round draws a random subset of the
 * eligible pills in random order and refuses to repeat recent round keys,
 * so consecutive rounds never fire the same queries twice.
 * Pure — unit-tested, no DOM, no network.
 */

export interface RoundQueryOptions {
  /** Eligible pills (merged "a b" pills stay intact as a single unit). */
  pills: string[]
  /** How many pills to query this round (capped at pills.length). */
  count: number
  /** Priority pill (fresh pick/solo): always included when eligible. */
  forceInclude?: string | null
  /** Recent round keys (see roundQueryKey) to avoid repeating. */
  recentKeys?: string[]
  /** Injectable RNG (default Math.random) for deterministic tests. */
  rand?: () => number
  /** Re-roll attempts when the draw collides with recentKeys. */
  maxRetries?: number
}

/** How many pills the feed queries per round. */
export const PILLS_PER_ROUND = 2
/** Round keys remembered to refuse immediate repeats. */
export const RECENT_QUERY_DEPTH = 8

/** Canonical key for a round's picks (order-independent). */
export function roundQueryKey(picks: string[]): string {
  return [...picks].sort().join(' ')
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

/**
 * Draw `count` distinct pills in random order. The forced pill is included
 * when eligible; draws colliding with recentKeys are re-rolled (small pools
 * with no alternative return as-is — repeats there are unavoidable).
 */
export function buildRoundQueries(opts: RoundQueryOptions): string[] {
  const rand = opts.rand ?? Math.random
  const pills = [...new Set(opts.pills.map((p) => p.trim()).filter(Boolean))]
  if (pills.length === 0) return []
  const n = Math.min(Math.max(1, opts.count), pills.length)
  const recent = new Set(opts.recentKeys ?? [])
  const forced = (opts.forceInclude ?? '').trim()
  const forceEligible = forced && pills.includes(forced) ? forced : null

  const draw = (): string[] => {
    const rest = shuffled(
      pills.filter((p) => p !== forceEligible),
      rand,
    )
    const out = forceEligible ? [forceEligible] : []
    for (const p of rest) {
      if (out.length >= n) break
      out.push(p)
    }
    return shuffled(out, rand)
  }

  // Single possible draw (or forced + only alternative): no re-roll can help.
  if (pills.length <= n) return draw()
  const retries = Math.max(1, opts.maxRetries ?? 8)
  let picks = draw()
  for (let i = 1; i < retries && recent.has(roundQueryKey(picks)); i++) {
    picks = draw()
  }
  return picks
}
