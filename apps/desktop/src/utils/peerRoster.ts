import type { User } from '@orbit/shared'

/**
 * Peers absent from the server roster for longer than this are marked
 * offline. The roster ticks every 60s and swarm PRESENCE broadcasts every
 * 60s, so a genuinely-active peer always has a sighting inside this window;
 * anything older is a leaver, not a missed tick. Pure — unit-tested.
 */
export const STALE_PEER_MS = 90_000

function seenMs(v?: string | null): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * Merge the server's online roster (GET /api/users/online — online peers
 * ONLY) into the client peer map:
 * - roster members are marked online with a fresh sighting (profile fields
 *   refreshed), whether previously known or not;
 * - known peers ABSENT from the roster decay to offline once their last
 *   sighting (swarm or roster) goes stale, so leavers stop haunting the UI.
 * Peers with no timestamp at all are left untouched (nothing to judge by).
 * Pure — unit-tested.
 */
export function mergeRoster(
  peerMap: Map<string, User>,
  roster: User[],
  selfId: string,
): boolean {
  let changed = false
  const now = Date.now()
  const seen = new Set<string>()
  for (const u of roster) {
    if (!u || !u.id || u.id === selfId) continue
    seen.add(u.id)
    const known = peerMap.get(u.id)
    const sighting = u.last_seen || new Date(now).toISOString()
    if (!known) {
      peerMap.set(u.id, { ...u, online: true, last_seen: sighting })
      changed = true
      continue
    }
    const merged: User = {
      ...known,
      display_name: u.display_name || known.display_name,
      pfp_url: u.pfp_url ?? known.pfp_url,
      score: u.score ?? known.score,
      maximum_gooner: u.maximum_gooner ?? known.maximum_gooner,
      tags: u.tags && u.tags.length > 0 ? u.tags : known.tags,
      online: true,
      last_seen: sighting,
    }
    if (JSON.stringify(merged) !== JSON.stringify(known)) {
      peerMap.set(u.id, merged)
      changed = true
    }
  }
  // Downgrade leavers: known-online but absent from the roster with a stale
  // sighting. last_seen is preserved so the UI can still show "x ago".
  for (const [id, p] of peerMap) {
    if (!p || id === selfId || seen.has(id)) continue
    if (!p.online) continue
    const last = seenMs(p.last_seen)
    if (last > 0 && now - last >= STALE_PEER_MS) {
      peerMap.set(id, { ...p, online: false })
      changed = true
    }
  }
  return changed
}
