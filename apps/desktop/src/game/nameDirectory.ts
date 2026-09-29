import { isDefaultPeerName } from '@orbit/shared'
import { isUsableName, type NameRosterEntry } from '../utils/displayName'

/**
 * THE name directory — one durable place where "who is this person called".
 *
 * Why it exists: names kept disappearing from the UI because every surface
 * consulted a different, capped, short-lived source. The chat hub read a
 * 100-row /api/users page, the profile modal read whatever object the opener
 * happened to hold, the presence poll read the dashboard's own 100 rows. A
 * peer outside the cap currently being consulted had no name at all, so the UI
 * invented one — and the inventions disagreed, which is how the same person
 * read as "User" in one place and their real name (or the viewer's own name) in
 * another.
 *
 * This is deliberately NOT a store: it is a module-level map plus a persisted
 * copy. It is read during render, written from a dozen places, and its answer
 * must be identical before and after a reload — the "permanent" requirement.
 * A zustand store would add a subscription per character on the message list
 * for no benefit: nothing here is ever "stale", only absent.
 *
 * Fed by every source: the /api/users directory, the presence poll, and the
 * display name sealed into DM/room messages. Last write wins, so a rename is
 * picked up.
 */

const STORAGE_KEY = 'gmatch.name_directory_v1'

/** Bounded so a long-lived install cannot grow localStorage without limit. */
const MAX_ENTRIES = 2000

let names = new Map<string, string>()

function load(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      // Junk in the file must not become a name: only a usable string keyed on
      // a non-empty id is admitted.
      if (id && typeof name === 'string' && isUsableName(name)) names.set(id, name.trim())
    }
  } catch {
    // A corrupt directory is survivable — we simply start empty and refill.
  }
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (names.size > MAX_ENTRIES) {
      // Drop the oldest half. Insertion order is first-seen order, so this
      // keeps the names we have seen most recently.
      const keep = [...names.entries()].slice(-MAX_ENTRIES)
      names = new Map(keep)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(names)))
  } catch {
    // Quota exceeded: keep the in-memory directory working for this session.
  }
}

/** Reload from storage. Call once at startup. */
export function hydrateFromStorage(): void {
  names = new Map()
  load()
}

/** The remembered name for an id, or undefined if we have never known one. */
export function nameFor(id: string): string | undefined {
  if (!id) return undefined
  return names.get(id)
}

/**
 * Remember one name.
 *
 * Refuses placeholders (`User_1da964`) on purpose: the server mints them for
 * accounts with no display_name, and storing one would freeze a placeholder as
 * if it were the person's real, permanent name.
 */
export function rememberName(id: string, name: string | null | undefined): void {
  if (!id) return
  if (typeof name !== 'string' || !isUsableName(name) || isDefaultPeerName(name.trim())) return
  const next = name.trim()
  if (names.get(id) === next) return
  names.set(id, next)
  persist()
}

export interface NamedSubject {
  id?: string
  orbitId?: string
  display_name?: string | null
  name?: string | null
}

/** Remember a batch — a /api/users page, a group member list, a poll payload. */
export function rememberNames(users: readonly NamedSubject[]): void {
  let changed = false
  for (const u of users) {
    const id = u?.id || u?.orbitId
    if (!id) continue
    const name = u.display_name ?? u.name
    if (typeof name !== 'string' || !isUsableName(name) || isDefaultPeerName(name.trim())) continue
    const next = name.trim()
    if (names.get(id) === next) continue
    names.set(id, next)
    changed = true
  }
  if (changed) persist()
}

/**
 * A view compatible with the shared name resolver, so every chat surface can
 * swap its capped roster for the durable directory without changing the
 * resolution order.
 */
export function nameRoster(): Map<string, NameRosterEntry> {
  const out = new Map<string, NameRosterEntry>()
  for (const [id, name] of names) out.set(id, { display_name: name })
  return out
}

/** Every known name, for diagnostics and tests. */
export function allNames(): Record<string, string> {
  return Object.fromEntries(names)
}

export function __resetNameDirectoryForTests(): void {
  names = new Map()
}

// Bootstrap as early as possible so the first render already has the names.
if (typeof localStorage !== 'undefined') load()
