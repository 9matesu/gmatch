/**
 * The blocklist rule (SPEC §8) — ONE implementation, every caller.
 *
 * A tag is rejected when a blocklist term occurs in it ALIGNED TO A TOKEN
 * BOUNDARY: the tokens of a booru tag vocabulary are underscore-joined words
 * (hyphens and spaces are the same boundary), and a term may still be a
 * PREFIX of its token.
 *
 * The prefix rule is what keeps every real compound blocked ('lolicon',
 * 'shotacon', 'teenager', 'childhood_friends', 'necrophilia', 'zoo_philia').
 * Only a MID-TOKEN hit is ignored — that is exactly the accidental case:
 * 'fifteen' (teen), 'grape'/'scrape' (rape), 'zoom' (zoo), 'babydoll'
 * (baby) are legal tags that a raw substring test used to starve.
 *
 * The single source of truth for the TERMS is shared/blocklist.json. The
 * Electron main process cannot import TypeScript, so it carries a CommonJS
 * mirror of this rule (apps/desktop/electron/blocklistRule.cjs) pinned
 * against this one by a parity test: a disagreement between the renderer and
 * the main process is a safety hole, not a cosmetic bug.
 */

import blocklistData from '../../../shared/blocklist.json'

/** The shape of shared/blocklist.json. */
export interface BlocklistFile {
  blocklist: string[]
  noise: string[]
  suggested?: string[]
  [key: string]: unknown
}

/** The shipped blocklist file (the hard line + noise + suggested excludes). */
export const DEFAULT_BLOCKLIST_DATA = blocklistData as BlocklistFile

/** The hard line: the illegal-content terms. */
export const DEFAULT_BLOCKLIST: readonly string[] = [...blocklistData.blocklist]

/** Count/quality tags that carry no meaning for the player. */
export const DEFAULT_NOISE_TAGS: readonly string[] = [...blocklistData.noise]

/** Legal-but-polarising categories the player may opt into blocking. */
export const DEFAULT_SUGGESTED_EXCLUDES: readonly string[] = [...(blocklistData.suggested ?? [])]

/**
 * Booru tag vocabularies are underscore-joined words, so `_` (plus spaces and
 * hyphens, which sources use interchangeably) is the only real token boundary.
 */
export function normalizeTagText(raw: string): string {
  return String(raw).toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * True when `term` occurs in `tag` STARTING ON A TOKEN BOUNDARY.
 *
 * The old rule was a raw substring test, which is wrong in both directions.
 * It let 'grape' (rape), 'fifteen' (teen) and 'scrape' through as blocked —
 * a large share of legal tags were being dropped for merely containing the
 * letters of a banned word, which quietly starves the feed.
 *
 * Requiring token alignment fixes those. Crucially a term may still be a
 * PREFIX of its token, so every real compound stays blocked. What stops
 * matching is only a mid-token hit.
 */
export function hitsAtTokenStart(tag: string, term: string): boolean {
  if (!tag || !term) return false
  let from = 0
  for (;;) {
    const i = tag.indexOf(term, from)
    if (i === -1) return false
    if (i === 0 || tag.charCodeAt(i - 1) === 95 /* '_' */) return true
    from = i + 1
  }
}

/** True when `tag` hits any of `terms` under the token-boundary rule. */
export function tagHitsAnyTerm(tag: string, terms: readonly string[]): boolean {
  const t = normalizeTagText(tag)
  if (!t) return false
  return terms.some((bad) => hitsAtTokenStart(t, normalizeTagText(bad)))
}
