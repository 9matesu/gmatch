import type { User } from '@orbit/shared'

/**
 * Merge the server's online roster (GET /api/users/online) into the client
 * peer map WITHOUT clobbering fresher live data: peers we already know keep
 * their current online flag/profile; roster-only entries are added marked
 * offline until a swarm/heartbeat event confirms them. Pure — unit-tested.
 */
export function mergeRoster(
  peerMap: Map<string, User>,
  roster: User[],
  selfId: string,
): boolean {
  let changed = false
  const now = Date.now()
  for (const u of roster) {
    if (!u || !u.id || u.id === selfId) continue
    const known = peerMap.get(u.id)
    if (!known) {
      peerMap.set(u.id, { ...u, online: false, last_seen: u.last_seen || new Date(now).toISOString() })
      changed = true
      continue
    }
    // Refresh profile fields (name/pfp/score) but never downgrade online:true.
    const merged: User = {
      ...known,
      display_name: u.display_name || known.display_name,
      pfp_url: u.pfp_url ?? known.pfp_url,
      score: u.score ?? known.score,
      maximum_gooner: u.maximum_gooner ?? known.maximum_gooner,
      tags: u.tags && u.tags.length > 0 ? u.tags : known.tags,
    }
    if (JSON.stringify(merged) !== JSON.stringify(known)) {
      peerMap.set(u.id, merged)
      changed = true
    }
  }
  return changed
}
