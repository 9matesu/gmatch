'use strict'

/**
 * Tag matching rule — the single authority for "does this post answer this
 * query?". Authoritative implementation lives HERE because electron/main.cjs
 * cannot import TypeScript; src/game/matchRule.ts is the renderer mirror and
 * src/game/matchRule.test.ts pins the two to identical verdicts over shared
 * fixtures.
 *
 * Why it exists (audit 2026-10): the previous rule in both runtimes was
 * `some()` over query tokens with `String.includes()` fallback, and the
 * renderer additionally split query tags on `_`. So a 2-tag query returned
 * posts matching ONE tag, and `large_breasts` matched a post tagged `large`.
 * Result counts looked healthy and meant nothing.
 *
 * The rule now:
 *   - requires EVERY query token to match a post tag (AND), never OR;
 *   - matches on NORMALIZED TAG EQUALITY, the way booru APIs actually filter
 *     (Danbooru-family `tags=a_b` selects posts tagged `a_b`, not `a`);
 *   - never splits on `_`, never does unrestricted substring matching;
 *   - still rejects any post matching a negated token.
 *
 * Blocklist / user-exclude matching is a DIFFERENT concern and keeps its
 * token-prefix semantics (`hitsAtTokenStart` in src/game/tagFilter.ts,
 * mirrored in main.cjs). Nothing here weakens it: negatives below use exact
 * equality, which is strictly narrower than the prefix rule they replaced.
 */

/** Lowercase + collapse whitespace/hyphens into a single `_` (booru style). */
function normalizeTag(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}

/** Split a query string into required tokens and negated (`-token`) terms. */
function parseQuery(query) {
  const required = []
  const negated = []
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
function tagSet(postTags) {
  const out = new Set()
  for (const t of postTags || []) {
    const n = normalizeTag(t)
    if (n) out.add(n)
  }
  return out
}

/** How many required tokens this post satisfies (relevance ranking input). */
function matchCount(postTags, required) {
  const have = tagSet(postTags)
  let n = 0
  for (const t of required) if (have.has(t)) n += 1
  return n
}

/**
 * Strict AND. `trustUntagged` reproduces the existing, deliberate policy for
 * providers that return no tags at all (redgifs / imhentai / babesource /
 * paheal): there is nothing to validate against, so the provider's own search
 * is trusted. Providers that DO return tags are always validated.
 */
function matchesQuery(postTags, query, opts) {
  const options = opts || {}
  // Caption hunts deliberately keep text-overlay tags, and the caller's gate
  // (postFilter `captions`) decides that. A caption query carries no tag
  // contract to enforce here.
  if (/caption/i.test(String(query || ''))) return true
  const { required, negated } = parseQuery(query)
  if (!required.length && !negated.length) return true
  const tags = postTags || []
  if (options.trustUntagged && tags.length === 0) return true
  const have = tagSet(tags)
  for (const n of negated) {
    if (have.has(n)) return false
  }
  for (const r of required) {
    if (!have.has(r)) return false
  }
  return true
}

module.exports = { normalizeTag, parseQuery, tagSet, matchCount, matchesQuery }
