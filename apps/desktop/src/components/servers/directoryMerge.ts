import type { DirectoryServer } from './ServersView'

export type { DirectoryServer }

/**
 * Wave 2 (D2): nodes teach each other without the hub. After joining node B,
 * the client fetches B's directory (GET /api/servers — same shape as the
 * central one) and merges it into a local cache so the list survives the
 * central node being down. Pure function; the caller persists to
 * localStorage under `orbit_node_directory_v1`.
 */
export const DIRECTORY_CACHE_KEY = '***'

export function mergeDirectory(
  cached: DirectoryServer[],
  fresh: DirectoryServer[],
): DirectoryServer[] {
  const byId = new Map<string, DirectoryServer>()
  for (const s of cached) byId.set(s.id, s)
  for (const s of fresh) {
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

export function readDirectoryCache(): DirectoryServer[] {
  try {
    const raw = localStorage.getItem(DIRECTORY_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeDirectoryCache(list: DirectoryServer[]): void {
  try { localStorage.setItem(DIRECTORY_CACHE_KEY, JSON.stringify(list)) } catch { /* quota */ }
}
