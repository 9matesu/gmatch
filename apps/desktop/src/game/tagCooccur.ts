/**
 * Co-occurrence blockers learned from purges (T4): when the player purges a
 * picture, the pairs among its rarest content tags are recorded. A pair seen
 * in >= 2 purged posts blocks any post carrying BOTH tags — unless one of
 * them is a tag the player currently feeds on (intent beats the algorithm).
 */
export interface CoRule { a: string; b: string; count: number }

/** ponytail: threshold + top-6 window are taste knobs; per-player tuning goes
 * in Settings -> Feed only if false positives bite. */
export const BLOCK_THRESHOLD = 2
export const MAX_CO_RULES = 200
const PAIR_WINDOW = 6

const key = (a: string, b: string) => (a <= b ? [a, b] : [b, a])

export function learnPurge(purgedTags: string[], rules: CoRule[]): CoRule[] {
  const top = purgedTags.slice(0, PAIR_WINDOW)
  const out = new Map(rules.map((r) => [`${r.a}|${r.b}`, r]))
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const [a, b] = key(top[i], top[j])
      const r = out.get(`${a}|${b}`)
      if (r) r.count++
      else out.set(`${a}|${b}`, { a, b, count: 1 })
    }
  }
  return [...out.values()].sort((x, y) => y.count - x.count).slice(0, MAX_CO_RULES)
}

export function blockedPair(postTags: string[], rules: CoRule[], feedTags: Set<string>): boolean {
  if (rules.length === 0) return false
  const t = new Set(postTags)
  return rules.some(
    (r) => r.count >= BLOCK_THRESHOLD && t.has(r.a) && t.has(r.b) && !feedTags.has(r.a) && !feedTags.has(r.b),
  )
}

/* Module mirror of the persisted rules — same shape as tagFilter's
 * user-excludes bridge: store owns save/load, feed gate reads live. */
let coRules: CoRule[] = []
export function setCoRules(list: CoRule[]): void { coRules = list.slice(0, MAX_CO_RULES) }
export function getCoRules(): CoRule[] { return coRules }
export function __resetCoRules(): void { coRules = [] }

/** The player's current feed intent — rules touching these tags stand down. */
let feedIntent = new Set<string>()
export function setFeedIntent(tags: Iterable<string>): void { feedIntent = new Set(tags) }
export function isFeedIntent(tag: string): boolean { return feedIntent.has(tag) }
