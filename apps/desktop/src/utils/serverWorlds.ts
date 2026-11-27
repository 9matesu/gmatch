// A "world" is a server: one isolated ecosystem (its own SQLite file, blob
// store, profile, posts, media, ids, admin and chat). Worlds are independent
// and infinite — a player may host or join as many as they like. The DEFAULT
// local world is "gmatch Official"; every other world is keyed by its
// canonical server address so the same world is the same id on every device.
//
// This module is the ONE place that turns a server address into a world id and
// namespaces per-world client storage. Pure and deterministic: no I/O, no
// reachability or membership claim.
//
// Boundary (deliberate, SPEC §12c): only cached SOCIAL data is namespaced per
// world (feed snapshot, op log, roster, chat seen); identity, tags/pfp, the idle
// save + gallery index and the on-disk media VAULT + encrypted imgcache stay
// GLOBAL — a picture is bytes addressed by content, not a world's row, and one
// player visits every world as the same person.

/** The install's own default world. Its data lives at the legacy userData root. */
export const DEFAULT_WORLD_ID = 'official'
export const DEFAULT_WORLD_NAME = 'gmatch Official'

/** The world this renderer session is in. Set once at boot by `useActiveWorld`
 *  (seeded from the live API base, confirmed by `server:state`) so non-React
 *  modules can namespace their storage without prop-drilling. */
let activeWorldId: string = DEFAULT_WORLD_ID

export function setActiveWorldId(worldId?: string | null): void {
  activeWorldId = worldId || DEFAULT_WORLD_ID
}

export function getActiveWorldId(): string {
  return activeWorldId
}

/** Canonical key of a server address: no scheme, no trailing slash, lowercase.
 *  Mirrors directoryMerge.serverKey so a row and a world agree on identity. */
export function worldKeyFromAddress(address?: string | null): string {
  return (address || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** FNV-1a, 32-bit — small, dependency-free, deterministic across runtimes. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Stable world id for a canonical server key. Empty → the default world. */
export function worldIdForKey(key: string): string {
  const k = (key || '').trim().toLowerCase()
  if (!k) return DEFAULT_WORLD_ID
  return `w_${fnv1a(k).toString(16).padStart(8, '0')}`
}

/** Stable world id for a server address (scheme/host case insensitive). */
export function worldIdForAddress(address?: string | null): string {
  return worldIdForKey(worldKeyFromAddress(address))
}

export function isDefaultWorld(worldId?: string | null): boolean {
  return !worldId || worldId === DEFAULT_WORLD_ID
}

/** Per-world localStorage key. The default world keeps the global key so an
 *  upgrade never loses the save it already has. */
export function namespaceStorageKey(base: string, worldId?: string | null): string {
  return isDefaultWorld(worldId) ? base : `${base}::${worldId}`
}

/** Per-world IndexedDB name suffix (empty for the default world). */
export function worldDbName(worldId?: string | null): string {
  return isDefaultWorld(worldId) ? '' : String(worldId)
}

/** Human label for a world: its display name, else a stable fallback. */
export function worldLabel(worldId: string | undefined | null, name?: string | null): string {
  const n = (name || '').trim()
  if (n) return n
  return isDefaultWorld(worldId) ? DEFAULT_WORLD_NAME : `World ${worldId}`
}