import type { User, OrbitObject } from '@orbit/shared';

export function areItemsStructurallyEqual(a: OrbitObject[], b: OrbitObject[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].content_url !== b[i].content_url ||
      a[i].is_favorited !== b[i].is_favorited ||
      a[i].caption !== b[i].caption
    ) return false;
  }
  return true;
}

/**
 * Fields that only change when the user's economics change, i.e. between two
 * otherwise-identical polls. The server pins the caller to index 0 and keeps
 * `online` true on the 30s heartbeat, so if this list is left out the roster is
 * declared "structurally equal" and the wallet/reputation in the top bar, the
 * Store and the rankings freeze until you rename yourself or someone joins.
 */
const USER_ECONOMY_FIELDS = [
  'balance',
  'score',
  'daily_score',
  'reputation',
  'matches_won',
  'matches_lost',
  'matches_total',
  'gacha_items_collected',
  'gacha_downloads_received',
  'likes_received',
  'likes_given',
  'objects_sent_count',
  'posts_count',
  'followers_count',
  'following_count',
  'is_private',
  'maximum_gooner',
] as const satisfies readonly (keyof User)[];

/**
 * Presence bucket width, in ms.
 *
 * `last_seen` is rewritten by the heartbeat every 10-30s for every user who is
 * online, and `online` stays true across all of it. So the roster guard below
 * could never compare the raw timestamp without re-rendering on every poll, and
 * it could not ignore it either: `isUserOnline` treats a present-but-stale
 * timestamp as authoritative over the boolean, so a frozen `last_seen` pins
 * the profile modal to "Offline" while the arena and chat hub — which read
 * fresh server-side presence — say "Online". That was the split brain.
 *
 * Bucketing to 15s is comfortably finer than the 60s freshness window, so no
 * online/offline TRANSITION can fall inside one bucket and be missed, while a
 * busy roster re-renders at most ~4x/min instead of continuously.
 */
const PRESENCE_BUCKET_MS = 15_000;

/** Bucket index for a presence timestamp; 0 when there is no usable one. */
export function presenceBucket(lastSeen?: string | null): number {
  if (!lastSeen) return 0;
  const t = Date.parse(lastSeen);
  return Number.isFinite(t) ? Math.floor(t / PRESENCE_BUCKET_MS) : 0;
}

export function areUsersStructurallyEqual(a: User[], b: User[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ua = a[i], ub = b[i];
    if (ua.id !== ub.id || ua.online !== ub.online || ua.display_name !== ub.display_name) return false;
    if (JSON.stringify(ua.tags || []) !== JSON.stringify(ub.tags || [])) return false;
    if (ua.pfp_url !== ub.pfp_url) return false;
    if (presenceBucket(ua.last_seen) !== presenceBucket(ub.last_seen)) return false;
    for (const field of USER_ECONOMY_FIELDS) {
      // Normalised on BOTH sides: the synthetic self-entry the app injects when
      // the roster omits you carries no `balance`, and a raw comparison against
      // the server's 0 would make every poll look like a change.
      const av = ua[field];
      const bv = ub[field];
      if (typeof av === 'number' || typeof bv === 'number') {
        if (Number(av ?? 0) !== Number(bv ?? 0)) return false;
      } else if (Boolean(av) !== Boolean(bv)) {
        return false;
      }
    }
  }
  return true;
}

export function areAnnouncementsStructurallyEqual(a: { id: string; message: string }[], b: { id: string; message: string }[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].message !== b[i].message) return false;
  }
  return true;
}