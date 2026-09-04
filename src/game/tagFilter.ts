import blocklistData from '../../shared/blocklist.json'

/**
 * HARD blocklist (SPEC §8) — the most important tested module in the repo.
 * A tag is rejected if ANY blocklist term appears as a case-insensitive
 * substring. Single source of truth: shared/blocklist.json (also required
 * by electron/main.cjs, which cannot import TS).
 */
export const BLOCKLIST: readonly string[] = blocklistData.blocklist
export const NOISE_TAGS: readonly string[] = blocklistData.noise

const NOISE = new Set(NOISE_TAGS)

/**
 * User excludes: extra blocked terms the player adds on the setup screen or
 * the config tab. Same substring rule as the hard blocklist, persisted in the
 * save (see save.ts). Module-level so every pure gate picks them up; the
 * store syncs them on load/setup/config change via setUserExcludes.
 */
let userExcludes: string[] = []

/** Replace the user-exclude list (normalized: lowercase, trimmed, non-empty, unique). */
export function setUserExcludes(list: readonly string[]): void {
  const seen = new Set<string>()
  userExcludes = []
  for (const raw of list) {
    const t = String(raw).toLowerCase().trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    userExcludes.push(t)
  }
}

/** Current user excludes (copy). */
export function getUserExcludes(): string[] {
  return [...userExcludes]
}

/** Test hook: clear user excludes. */
export function __resetUserExcludes(): void {
  userExcludes = []
}

function matchesAny(term: string, list: readonly string[]): boolean {
  const t = term.toLowerCase()
  return list.some((bad) => t.includes(bad))
}

export function isTagBlocked(tag: string): boolean {
  return matchesAny(tag, BLOCKLIST) || matchesAny(tag, userExcludes)
}

/** True when a tag hits the player's own exclude list (not the hard blocklist). */
export function isUserExcluded(tag: string): boolean {
  return matchesAny(tag, userExcludes)
}

export function isNoise(tag: string): boolean {
  return NOISE.has(tag.toLowerCase())
}

/**
 * Ratings: sources without a rating field pass; when present only
 * explicit/adult content is allowed (SPEC §8).
 */
export function isRatingAllowed(rating?: string): boolean {
  if (rating === undefined || rating === '') return true
  return ['e', 'explicit', 'adult'].includes(rating.toLowerCase())
}

export function parseTagField(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean)
}

/** Drop blocked + noise + duplicates, preserving order. */
export function filterTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const t = tag.trim()
    if (!t || isTagBlocked(t) || isNoise(t)) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Frequency ranking for the tag market (SPEC §3): most frequent first. */
export function rankTags(tags: string[]): { name: string; frequency: number }[] {
  const counts = new Map<string, { name: string; frequency: number }>()
  for (const tag of tags) {
    const t = tag.trim()
    if (!t || isTagBlocked(t) || isNoise(t)) continue
    const key = t.toLowerCase()
    const entry = counts.get(key)
    if (entry) entry.frequency += 1
    else counts.set(key, { name: t, frequency: 1 })
  }
  return [...counts.values()].sort(
    (a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name),
  )
}

/** True if a whole feed query contains any blocked term. */
export function isQueryBlocked(query: string): boolean {
  return parseTagField(query).some(isTagBlocked)
}
