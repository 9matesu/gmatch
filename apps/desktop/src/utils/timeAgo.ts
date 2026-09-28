/**
 * Timestamp parsing for SQLite's CURRENT_TIMESTAMP.
 *
 * The API stores/returns "2026-09-28 12:34:56" — UTC, no timezone marker, space
 * separator. `new Date("2026-09-28 12:34:56")` parses that as LOCAL time in
 * every engine we ship, so the raw string renders as a wall-clock time that is
 * wrong by the viewer's UTC offset (and can even land on the previous day).
 * Normalise to an explicit UTC instant before formatting.
 */
export function parseApiTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  // "YYYY-MM-DD HH:MM:SS" (SQLite) -> "YYYY-MM-DDTHH:MM:SSZ" (unambiguous UTC)
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(raw);
  const iso = sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compact relative time ("just now", "4m", "3h", "2d", "5w", then a date).
 * `now` is injectable so callers rendering live lists can re-render on a timer.
 */
export function timeAgo(value: string | null | undefined, now: number = Date.now()): string {
  const d = parseApiTimestamp(value);
  if (!d) return '';
  const seconds = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return d.toLocaleDateString();
}
