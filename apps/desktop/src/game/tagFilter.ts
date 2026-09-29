import blocklistData from '../../../../shared/blocklist.json'
import type { BlocklistData } from '../types/gmatch-bridge'

/**
 * HARD blocklist (SPEC §8) — the illegal-content line only (minors,
 * bestiality, necrophilia, non-consent). A tag is rejected if a blocklist
 * term appears in it ALIGNED TO A TOKEN BOUNDARY (underscore-joined words;
 * a term may still be a prefix of its token, so 'lolicon' stays blocked while
 * 'fifteen' no longer trips 'teen'). Single source of truth:
 * shared/blocklist.json (also required by electron/main.cjs, which cannot
 * import TS). Everything legal-but-polarising lives in SUGGESTED_EXCLUDES
 * and is blocked only when the player adds it to their own exclude list.
 */
export const DEFAULT_BLOCKLIST_DATA: BlocklistData = blocklistData as BlocklistData

export let BLOCKLIST: readonly string[] = [...blocklistData.blocklist]
export let NOISE_TAGS: readonly string[] = [...blocklistData.noise]
export let SUGGESTED_EXCLUDES: readonly string[] = [...(blocklistData.suggested ?? [])]

let NOISE = new Set(NOISE_TAGS.map((t) => t.toLowerCase()))

const STORAGE_KEY = 'gmatch_custom_blocklist'

export function getActiveBlocklistData(): BlocklistData {
  return {
    ...blocklistData,
    blocklist: [...BLOCKLIST],
    suggested: [...SUGGESTED_EXCLUDES],
    noise: [...NOISE_TAGS],
  }
}

export function updateActiveBlocklist(data: Partial<BlocklistData>): void {
  if (Array.isArray(data.blocklist)) {
    BLOCKLIST = [...data.blocklist]
  }
  if (Array.isArray(data.noise)) {
    NOISE_TAGS = [...data.noise]
    NOISE = new Set(NOISE_TAGS.map((t) => t.toLowerCase()))
  }
  if (Array.isArray(data.suggested)) {
    SUGGESTED_EXCLUDES = [...data.suggested]
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmatch:blocklist-updated', { detail: data }))
  }
}

export function loadSavedBlocklist(): BlocklistData {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          updateActiveBlocklist(parsed)
          return {
            ...blocklistData,
            ...parsed,
          }
        }
      }
    }
  } catch {
    /* fallback to default */
  }
  return { ...blocklistData } as BlocklistData
}

export async function syncBlocklistFromBridge(): Promise<BlocklistData> {
  if (typeof window !== 'undefined' && window.gmatch?.blocklistGet) {
    try {
      const res = await window.gmatch.blocklistGet()
      if (res?.current) {
        updateActiveBlocklist(res.current)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(res.current))
        } catch {
          /* ignore */
        }
        return res.current
      }
    } catch {
      /* ignore */
    }
  }
  return loadSavedBlocklist()
}

export async function saveBlocklist(data: BlocklistData): Promise<boolean> {
  updateActiveBlocklist(data)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.gmatch?.blocklistSet) {
    try {
      const res = await window.gmatch.blocklistSet(data)
      return Boolean(res?.ok)
    } catch {
      return false
    }
  }
  return true
}

export async function resetBlocklist(): Promise<BlocklistData> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
  let defaultData: BlocklistData = { ...blocklistData } as BlocklistData
  if (typeof window !== 'undefined' && window.gmatch?.blocklistReset) {
    try {
      const res = await window.gmatch.blocklistReset()
      if (res?.data) defaultData = res.data
    } catch {
      /* ignore */
    }
  }
  updateActiveBlocklist(defaultData)
  return defaultData
}

export function __resetBlocklist(): void {
  updateActiveBlocklist(blocklistData as BlocklistData)
}

// Initial bootstrap from localStorage if present
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  loadSavedBlocklist()
}

/**
 * User excludes: extra blocked terms the player adds on the setup screen or
 * the config tab. Same token-boundary rule as the hard blocklist, persisted
 * in the save (see save.ts). Module-level so every pure gate picks them up;
 * the store syncs them on load/setup/config change via setUserExcludes.
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
  const t = normalizeTagText(term)
  if (!t) return false
  return list.some((bad) => hitsAtTokenStart(t, normalizeTagText(bad)))
}

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
 * 20 of 28 sampled legal tags were being dropped for merely containing the
 * letters of a banned word, which quietly starves the feed.
 *
 * Requiring token alignment fixes those. Crucially a term may still be a
 * PREFIX of its token, so every real compound stays blocked: 'lolicon',
 * 'shota'/'shotacon', 'teenager', 'childhood_friends', 'necrophilia' and
 * 'zoo_philia' are all caught. What stops matching is only a mid-token hit,
 * which is exactly the accidental case. No safety term loses its coverage
 * except compounds where the banned word is a SUFFIX ('grandchild'); tag
 * vocabularies put the head noun first, so this is not a real gap.
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
