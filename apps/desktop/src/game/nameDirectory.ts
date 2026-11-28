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
/** Self-declared labels from sealed DMs are chat-only; never feed identities. */
const DM_STORAGE_KEY = 'gmatch.name_directory_dm_v1'

/** Bounded so a long-lived install cannot grow localStorage without limit. */
const MAX_ENTRIES = 2000

/**
 * Two classes, not one: `names` holds TRUSTED names (signed profile.update and
 * the node's own directory — the two sources that already had authority here),
 * `dmNames` holds self-declared chat labels. A peer can write anything into its
 * own DM label, so only `names` may feed author/comment rendering. `nameFor`
 * (chat) reads both, trusted first; `signedNameFor` (feed) reads only trusted.
 */
let names = new Map<string, string>()
let dmNames = new Map<string, string>()

function loadMap(raw: string | null, into: Map<string, string>): void {
  if (!raw) return
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
  for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
    // Junk in the file must not become a name: only a usable string keyed on
    // a non-empty id is admitted.
    if (id && typeof name === 'string' && isUsableName(name)) into.set(id, name.trim())
  }
}

function load(): void {
  try {
    if (typeof localStorage === 'undefined') return
    loadMap(localStorage.getItem(STORAGE_KEY), names)
    loadMap(localStorage.getItem(DM_STORAGE_KEY), dmNames)
  } catch {
    // A corrupt directory is survivable — we simply start empty and refill.
  }
}

function persistMap(key: string, map: Map<string, string>): Map<string, string> {
  let current = map
  if (current.size > MAX_ENTRIES) {
    // Drop the oldest half. Insertion order is first-seen order, so this
    // keeps the names we have seen most recently.
    current = new Map([...current.entries()].slice(-MAX_ENTRIES))
  }
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(current)))
  return current
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    names = persistMap(STORAGE_KEY, names)
    dmNames = persistMap(DM_STORAGE_KEY, dmNames)
  } catch {
    // Quota exceeded: keep the in-memory directory working for this session.
  }
}

/** Reload from storage. Call once at startup. */
export function hydrateFromStorage(): void {
  names = new Map()
  dmNames = new Map()
  load()
}

/** Chat's name: the trusted name wins, a DM self-label is a fallback. */
export function nameFor(id: string): string | undefined {
  if (!id) return undefined
  return names.get(id) ?? dmNames.get(id)
}

/**
 * The ONLY class the feed/comment projection trusts. A self-declared DM label
 * is deliberately invisible here, so it cannot become a post author's name.
 * Signed profile.update names and node-directory rows both arrive through the
 * `rememberNames` funnel, so they share this trusted class; the excluded class
 * is the DM label written by `rememberName`.
 */
export function signedNameFor(id: string): string | undefined {
  if (!id) return undefined
  return names.get(id)
}

/**
 * An accepted `profile.update` name. Signed operations travel through the same
 * batch funnel as node rows, so this writes the trusted class explicitly —
 * callers that know the provenance should use it rather than the generic batch.
 */
export function rememberSignedName(id: string, name: string | null | undefined): void {
  rememberTrusted(id, name)
}

function usableName(name: string | null | undefined): string | undefined {
  if (typeof name !== 'string' || !isUsableName(name) || isDefaultPeerName(name.trim())) return undefined
  return name.trim()
}

function rememberTrusted(id: string, name: string | null | undefined): void {
  const next = usableName(name)
  if (!id || !next || names.get(id) === next) return
  names.set(id, next)
  persist()
}

/**
 * A name from a SIGNED presence beacon. The signature proves the peer owns the
 * key, but the node directory and an accepted profile.update are stronger: an
 * already-known trusted name is NEVER overwritten by a beacon. Minted
 * placeholders (`User_<hex>`, `Player`) are refused — freezing one would make
 * it a permanent feed byline.
 */
export function rememberPresenceName(id: string, name: string | null | undefined): void {
  if (!id || names.has(id)) return
  const next = usableName(name)
  if (!next || next.toLowerCase() === 'player') return
  names.set(id, next)
  persist()
}

/**
 * Remember a self-declared label from a sealed DM/room message. It is chat
 * ONLY: it never overwrites a trusted name and never reaches `signedNameFor`.
 * Refuses placeholders (`User_1da964`): the server mints those for accounts
 * with no display_name, and freezing one would make it a permanent name.
 */
export function rememberName(id: string, name: string | null | undefined): void {
  if (!id) return
  const next = usableName(name)
  if (!next || dmNames.get(id) === next) return
  dmNames.set(id, next)
  persist()
}

export interface NamedSubject {
  id?: string
  orbitId?: string
  display_name?: string | null
  name?: string | null
}

/** Remember a trusted batch — a /api/users page or accepted profile.update. */
export function rememberNames(users: readonly NamedSubject[]): void {
  let changed = false
  for (const u of users) {
    const id = u?.id || u?.orbitId
    const next = usableName(u?.display_name ?? u?.name)
    if (!id || !next || names.get(id) === next) continue
    names.set(id, next)
    changed = true
  }
  if (changed) persist()
}

/**
 * A view compatible with the shared name resolver, so every chat surface can
 * swap its capped roster for the durable directory without changing the
 * resolution order. Trusted entries win over DM labels.
 */
export function nameRoster(): Map<string, NameRosterEntry> {
  const out = new Map<string, NameRosterEntry>()
  for (const [id, name] of names) out.set(id, { display_name: name })
  for (const [id, name] of dmNames) if (!out.has(id)) out.set(id, { display_name: name })
  return out
}

export function __resetNameDirectoryForTests(): void {
  names = new Map()
  dmNames = new Map()
}

// Bootstrap as early as possible so the first render already has the names.
if (typeof localStorage !== 'undefined') load()
