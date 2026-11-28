import type { DirectoryServer } from './ServersView'

export type { DirectoryServer }

/** This install's own node is ALWAYS the one canonical, verified official row. */
export const OFFICIAL_NODE_NAME = 'gMatch Central (Official)'

/** A listing dies after 24h of silence (ADR-002, §Vivacidade). A healthy node
 *  re-lists every 15min, so a gmatch-branded row older than two beats is a
 *  ghost from a retired node, not a friend who merely stopped by. */
const LISTING_TTL_MS = 24 * 60 * 60 * 1000
const BRAND_FRESH_MS = 2 * 15 * 60 * 1000

/**
 * Wave 2 (D2): nodes teach each other without the hub. After joining node B,
 * the client fetches B's directory (GET /api/servers — same shape as the
 * central one) and merges it into a local cache so the list survives the
 * central node being down. Pure function; the caller persists to
 * localStorage under `orbit_node_directory_v1`.
 */
export const DIRECTORY_CACHE_KEY = '***'

/**
 * The mirror belongs to ONE world. A node's `/api/servers` lists the directory
 * IT knows; merging that into a global cache made rows from the previous node
 * survive a switch forever (the new node never lists them, so nothing ever
 * replaced them). Keying on the committed API base gives each world its own
 * mirror; the unscoped key stays for legacy readers and tests.
 */
export function directoryCacheKey(base?: string | null): string {
  const origin = (base || '').trim().replace(/\/+$/, '')
  return origin ? `${DIRECTORY_CACHE_KEY}:${origin}` : DIRECTORY_CACHE_KEY
}

export function mergeDirectory(
  cached: DirectoryServer[],
  fresh: DirectoryServer[],
): DirectoryServer[] {
  const byId = new Map<string, DirectoryServer>()
  for (const s of cached) byId.set(s.id, s)
  for (const s of fresh) {
    // Reject dead/impersonating rows at the SOURCE: a fresh directory answer
    // must never re-seed a row the boot purge removed from the cache.
    if (isDroppedDirectoryRow(s)) continue
    const prev = byId.get(s.id)
    // newest last_seen wins; fresh entries with no hint don't erase a known one
    if (!prev || (s.last_seen || '') >= (prev.last_seen || '')) {
      byId.set(s.id, prev && !s.endpoint_hint && prev.endpoint_hint ? { ...s, endpoint_hint: prev.endpoint_hint } : s)
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''))
    .slice(0, 200) // ponytail: cap the cache; add paging if directories ever outgrow 200
}

/**
 * Canonical identity of a server: its address when it has one, else its
 * directory id. The same node can be listed under two ids (re-registration, a
 * `mask:` code row, the local node's own synthetic row), so the address is the
 * one stable key the protocol actually carries. Never the display name — two
 * different servers can share one.
 */
export function serverKey(s: DirectoryServer): string {
  const hint = (s.endpoint_hint || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  return hint || s.id
}

/** One row per server: collapse records that share a `serverKey`. Never merges
 *  by name. The newest `last_seen` wins, flags and counts are unioned so a
 *  stale zero never wins over a known value. Order is preserved. */
export function dedupeServers(list: DirectoryServer[]): DirectoryServer[] {
  const byKey = new Map<string, DirectoryServer>()
  for (const s of list) {
    const key = serverKey(s)
    const prev = byKey.get(key)
    if (!prev) { byKey.set(key, s); continue }
    const newer = (s.last_seen || '') >= (prev.last_seen || '')
    const [win, lose] = newer ? [s, prev] : [prev, s]
    byKey.set(key, {
      ...win,
      password_required: (win.password_required || lose.password_required) ? 1 : 0,
      is_private: (win.is_private || lose.is_private) ? 1 : 0,
      endpoint_hint: win.endpoint_hint || lose.endpoint_hint,
      online_count: win.online_count ?? lose.online_count,
      user_count: win.user_count ?? lose.user_count,
    })
  }
  return [...byKey.values()]
}

function lastSeenAt(s: DirectoryServer): number {
  if (!s.last_seen) return NaN
  const raw = s.last_seen
  // Same lenient ISO reading as formatRelativeTime; an unparseable stamp is
  // UNKNOWN, never stale (fixtures and old nodes both carry bare strings).
  const iso = !raw.endsWith('Z') && !raw.includes('+')
    ? (raw.includes('T') ? `${raw}Z` : `${raw.replace(' ', 'T')}Z`)
    : raw
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t > 0 ? t : NaN
}

/**
 * A row that is NOT a destination and must never reach the list: retired
 * synthetic `central-*` rows, the legacy nameless "gmatch" placeholder, any
 * listing past the 24h TTL, a remote row claiming the canonical official
 * identity, and a gmatch-branded row whose owner stopped heartbeating. One
 * predicate for the boot purge, the cache read, the merge and the render —
 * a stale mirror cannot resurrect a row a name filter later has to hide.
 * A self row is this machine's own node; an unknown timestamp is kept.
 */
export function isDroppedDirectoryRow(s: DirectoryServer, now = Date.now()): boolean {
  if (s.id.startsWith('central-')) return true
  if (s.name.trim().toLowerCase() === 'gmatch' && !s.endpoint_hint?.trim()) return true
  if (s.id.startsWith('self:')) return false
  const name = s.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (name === 'gmatch central official') return true
  const seen = lastSeenAt(s)
  if (!Number.isFinite(seen)) return false
  const brand = name === 'gmatch' || name === 'gmatch central'
  return now - seen > (brand ? BRAND_FRESH_MS : LISTING_TTL_MS)
}

export function readDirectoryCache(base?: string | null): DirectoryServer[] {
  try {
    const raw = localStorage.getItem(directoryCacheKey(base))
    const parsed = raw ? JSON.parse(raw) : []
    // Purge on READ too: a caller that never boots the Servers view (or a
    // cached reply served while the directory is down) still sees no ghosts.
    return Array.isArray(parsed) ? parsed.filter((s) => !isDroppedDirectoryRow(s)) : []
  } catch {
    return []
  }
}

export function writeDirectoryCache(list: DirectoryServer[], base?: string | null): void {
  try { localStorage.setItem(directoryCacheKey(base), JSON.stringify(list)) } catch { /* quota */ }
}
