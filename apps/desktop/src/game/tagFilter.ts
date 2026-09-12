import blocklistData from '../../../../shared/blocklist.json'
import type { BlocklistData } from '../types/gmatch-bridge'

/**
 * HARD blocklist (SPEC §8) — the illegal-content line only (minors,
 * bestiality, necrophilia, non-consent). A tag is rejected if ANY blocklist
 * term appears as a case-insensitive substring. Single source of truth:
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
