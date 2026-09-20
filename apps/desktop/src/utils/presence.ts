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
