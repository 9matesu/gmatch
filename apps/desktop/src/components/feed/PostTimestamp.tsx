import { useEffect, useState } from 'react'
import { timeAgo, parseApiTimestamp } from '../../utils/timeAgo'

/**
 * A post timestamp: relative by default, absolute on hover or click.
 *
 * Reuses utils/timeAgo rather than owning date logic — that module already
 * handles SQLite's zone-less timestamps, which `new Date()` silently reads as
 * local time and renders wrong by the viewer's UTC offset.
 *
 * The absolute value is ALWAYS in the DOM (the `title` and the accessible
 * name), so this is not a hover-only affordance: keyboard and screen-reader
 * users get the exact time, and the relative form is the compact default.
 *
 * Click latches, because a hover-only timestamp cannot be read at all on touch
 * and re-hovering to check a date is the wrong interaction for it.
 */

const KEY = 'gmatch.show_absolute_dates'

function readSticky(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Absolute formatting is expensive: `toLocaleString` with dateStyle/timeStyle
 * builds a formatter every call, and a 300-row timeline asks for it on every
 * render of every row (the CPU profile put PostTimestamp at ~4% of samples,
 * above every other component). The value only depends on (timestamp, locale),
 * so it is computed once per distinct timestamp.
 */
const absoluteCache = new Map<string, string>()

function absoluteFor(createdAt: string): string {
  const cached = absoluteCache.get(createdAt)
  if (cached !== undefined) return cached
  const parsed = parseApiTimestamp(createdAt)
  const value = parsed ? parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''
  // Bounded: a feed holds hundreds of rows, not the app's whole history.
  if (absoluteCache.size > 2000) absoluteCache.clear()
  absoluteCache.set(createdAt, value)
  return value
}

export function PostTimestamp({
  createdAt,
  className = 'text-xs text-retro-muted leading-tight',
  onToggle,
}: {
  createdAt: string;
  className?: string;
  onToggle?: (absolute: boolean) => void;
}) {
  const [absolute, setAbsolute] = useState(readSticky);
  const [hovered, setHovered] = useState(false);

  // One shared preference, so the choice made on one post holds everywhere.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setAbsolute(readSticky());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const parsed = parseApiTimestamp(createdAt);
  const full = absoluteFor(createdAt);
  const showAbsolute = absolute || hovered;
  const label = showAbsolute ? full : timeAgo(createdAt);

  return (
    <time
      dateTime={parsed ? parsed.toISOString() : createdAt}
      title={full || undefined}
      aria-label={full ? `Posted ${full}` : undefined}
      // Hover previews the exact date; click latches it (touch has no hover).
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`${className} shrink-0`}
    >
      <button
        type="button"
        onClick={() => {
          const next = !absolute;
          setAbsolute(next);
          try {
            localStorage.setItem(KEY, next ? '1' : '0');
          } catch { /* private mode: the choice just does not persist */ }
          onToggle?.(next);
        }}
        className="cursor-pointer"
      >
        {label}
      </button>
    </time>
  );
}
