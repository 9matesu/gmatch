import {
  DEFAULT_BLOCKLIST,
  DEFAULT_BLOCKLIST_DATA as SHARED_BLOCKLIST_DATA,
  DEFAULT_NOISE_TAGS,
  DEFAULT_SUGGESTED_EXCLUDES,
  tagHitsAnyTerm,
} from '@orbit/shared'
import type { BlocklistData } from '../types/gmatch-bridge'

/**
 * HARD blocklist (SPEC §8) — the illegal-content line only (minors,
 * bestiality, necrophilia, non-consent). A tag is rejected if a blocklist
 * term appears in it ALIGNED TO A TOKEN BOUNDARY (underscore-joined words;
 * a term may still be a prefix of its token, so 'lolicon' stays blocked while
 * 'fifteen' no longer trips 'teen'). The RULE lives in @orbit/shared
 * (one canonical implementation); the TERMS live in shared/blocklist.json
 * (also required by electron/main.cjs, which cannot import TS).
 * Everything legal-but-polarising lives in SUGGESTED_EXCLUDES and is blocked
 * only when the player adds it to their own exclude list.
 */
export const DEFAULT_BLOCKLIST_DATA: BlocklistData = SHARED_BLOCKLIST_DATA as BlocklistData

export let BLOCKLIST: readonly string[] = [...DEFAULT_BLOCKLIST]
export let NOISE_TAGS: readonly string[] = [...DEFAULT_NOISE_TAGS]
export let SUGGESTED_EXCLUDES: readonly string[] = [...DEFAULT_SUGGESTED_EXCLUDES]

let NOISE = new Set(NOISE_TAGS.map((t) => t.toLowerCase()))

const STORAGE_KEY = 'gmatch_custom_blocklist'

export function getActiveBlocklistData(): BlocklistData {
  return {
    ...SHARED_BLOCKLIST_DATA,
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
            ...SHARED_BLOCKLIST_DATA,
            ...parsed,
          }
        }
      }
    }
  } catch {
    /* fallback to default */
  }
  return { ...SHARED_BLOCKLIST_DATA } as BlocklistData
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

/**
 * Ban terms FOR GOOD: they land in the user's blocklist.json, so the clicker
 * never offers them again (the main process sends `-term` in every provider
 * query AND the renderer post-filter drops the post).
 *
 * The MAIN PROCESS owns the file: it merges the terms into the authoritative
 * list and hands the result back. The renderer used to send its own (possibly
 * stale) full list, which silently clobbered anything main had written since.
 */
export async function banTagsInBlocklist(
  terms: readonly string[],
): Promise<{ ok: boolean; data?: BlocklistData; error?: string }> {
  const clean = [...new Set(terms.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean))]
  if (!clean.length) return { ok: true, data: getActiveBlocklistData() }
  if (typeof window !== 'undefined' && window.gmatch?.blocklistBan) {
    try {
      const res = await window.gmatch.blocklistBan(clean)
      if (res?.ok && res.data) {
        updateActiveBlocklist(res.data)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(res.data))
        } catch {
          /* ignore */
        }
        return { ok: true, data: res.data }
      }
      return { ok: false, error: res?.error || 'the blocklist write was refused' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  // No bridge (browser dev): merge locally and persist.
  const data = getActiveBlocklistData()
  const next = { ...data, blocklist: [...new Set([...data.blocklist, ...clean])] }
  const ok = await saveBlocklist(next)
  return { ok, data }
}

export async function resetBlocklist(): Promise<BlocklistData> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
  let defaultData: BlocklistData = { ...SHARED_BLOCKLIST_DATA } as BlocklistData
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
  updateActiveBlocklist(SHARED_BLOCKLIST_DATA as BlocklistData)
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
  return tagHitsAnyTerm(term, list)
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
