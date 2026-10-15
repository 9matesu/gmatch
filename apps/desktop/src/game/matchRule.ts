/**
 * Tag matching rule — renderer mirror of electron/matchRule.cjs, which is the
 * authoritative implementation (main.cjs cannot import TypeScript).
 *
 * This file is a standalone module on purpose: it is bundled for the BROWSER,
 * so it must not reach for node builtins to share code at runtime. The two
 * implementations are kept identical by src/game/matchRule.test.ts, which
 * requires the CJS and pins every verdict across shared fixtures — the same
 * guard tagFilter.ts / main.cjs use for hitsAtTokenStart.
 *
 * Strict AND on normalized tag equality. See matchRule.cjs for why the old
 * `some()` + `includes()` + underscore-splitting rule was wrong: it returned
 * posts matching only ONE of several tags, and matched `large_breasts`
 * against a post tagged `large`. Blocklist/user-exclude prefix semantics are
 * untouched — they live in tagFilter.ts (`hitsAtTokenStart`).
 */

/** Lowercase + collapse whitespace/hyphens into a single `_` (booru style). */
export function normalizeTag(raw: unknown): string {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}

/** Split a query string into required tokens and negated (`-token`) terms. */
export function parseQuery(query: unknown): { required: string[]; negated: string[] } {
  const required: string[] = []
  const negated: string[] = []
  for (const tok of String(query == null ? '' : query).split(/\s+/)) {
    if (!tok) continue
    if (tok.charAt(0) === '-') {
      const t = normalizeTag(tok.slice(1))
      if (t) negated.push(t)
    } else {
      const t = normalizeTag(tok)
      if (t) required.push(t)
    }
  }
  return { required, negated }
}

/** Normalized set of a post's own tags. */
export function tagSet(postTags: readonly string[] | undefined): Set<string> {
  const out = new Set<string>()
  for (const t of postTags ?? []) {
    const n = normalizeTag(t)
    if (n) out.add(n)
  }
  return out
}

/** How many required tokens a post satisfies. Ranking input, not a score. */
export function matchCount(postTags: readonly string[] | undefined, required: readonly string[]): number {
  const have = tagSet(postTags)
  let n = 0
  for (const t of required) if (have.has(t)) n += 1
  return n
}

export interface MatchOptions {
  /**
   * Trust a post that carries NO tags: nothing to validate against, so the
   * provider's own search stands. Providers that do return tags are always
   * validated, so this cannot widen a strict AND query on a tagged source.
   */
  trustUntagged?: boolean
}

export function matchesQuery(
  postTags: readonly string[] | undefined,
  query: unknown,
  opts?: MatchOptions,
): boolean {
  // Caption hunts deliberately keep text-overlay tags; the caller's gate
  // (postFilter `captions`) decides that, and the query carries no tag
  // contract to enforce here.
  if (/caption/i.test(String(query || ''))) return true
  const { required, negated } = parseQuery(query)
  if (!required.length && !negated.length) return true
  const tags = postTags ?? []
  if (opts?.trustUntagged && tags.length === 0) return true
  const have = tagSet(tags)
  for (const n of negated) if (have.has(n)) return false
  for (const r of required) if (!have.has(r)) return false
  return true
}
