export interface PresenceSubject {
  id?: string;
  last_seen?: string | null;
  online?: boolean;
}

const SEEN_FRESH_MS = 60_000;
const MAX_CLOCK_SKEW_MS = 15_000;

/**
 * Normalizes UTC dates from SQLite (which lack trailing 'Z') and parses to milliseconds.
 * Pure — unit-tested.
 */
export function parseSeenMs(v?: string | null): number {
  if (!v) return 0;
  const s = typeof v === 'string' && !v.endsWith('Z') && !v.includes('+')
    ? (v.includes('T') ? `${v}Z` : `${v.replace(' ', 'T')}Z`)
    : v;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Single source of truth for user presence across the entire application.
 * - Sighting timestamp is sole authority when present (survives lagging flags).
 * - Enforces canonical 60-second window.
 * - Protects against negative offset / timezone leaks (SQLite UTC interpreted as local time).
 */
export function isUserOnline(user?: PresenceSubject | null, referenceNow = Date.now()): boolean {
  if (!user) return false;

  const seenMs = parseSeenMs(user.last_seen);
  if (seenMs <= 0) return Boolean(user.online);

  const delta = referenceNow - seenMs;
  return delta >= -MAX_CLOCK_SKEW_MS && delta < SEEN_FRESH_MS;
}

/**
 * Pick the record with the most recent sighting.
 *
 * The profile modal is opened from several places that each hand it a
 * differently-fresh user object: the chat hub builds one from a 30s dashboard
 * poll, the arena builds one carrying only an `online` flag, and App hands the
 * modal a roster entry whose `last_seen` is only as fresh as the last roster
 * poll. Taking `roster ?? subject` blindly meant a stale roster entry always
 * won over fresher data the caller had already fetched, which is how the same
 * person showed "Online" in the chat list and "Offline" in their profile.
 *
 * Ranked by sighting, then by whether the record carries a presence flag at
 * all: a record with no usable `last_seen` scores 0, so a real sighting always
 * beats a presence-less one, and when neither has a sighting the one that
 * actually says "online" wins instead of silently degrading to offline.
 */
export function fresherPresence<T extends PresenceSubject>(
  subject: T | undefined | null,
  roster: T | undefined | null,
): T | undefined {
  if (!subject) return roster ?? undefined;
  if (!roster) return subject;
  const rank = (r: T) => {
    const seen = parseSeenMs(r.last_seen);
    // +1s so a real sighting always outranks a presence-less record even when
    // both resolve to 0.
    return (seen > 0 ? seen + 1 : 0) + (r.online ? 1 : 0);
  };
  return rank(roster) > rank(subject) ? roster : subject;
}
