import { useEffect, useState } from 'react'
import { parseApiTimestamp } from '../../utils/timeAgo'
import { formatDate, formatRelativeDate } from '../../utils/formatDate'

/**
 * A post timestamp: relative by default, absolute on hover or click.
 *
 * Both forms come from utils/formatDate (en-US), which reuses timeAgo's parsing
 * for SQLite's zone-less timestamps — `new Date()` would read those as local
 * time and render wrong by the viewer's UTC offset.
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

// The absolute form is pinned to en-US by the shared formatter: a Brazilian
// machine used to render "26 de Out. 2026" here, while the rest of the app is
// English. The formatter instances are module-level, so a long timeline does
// not build one per row.
const absoluteFor = (createdAt: string) => formatDate(createdAt, true)

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
  const label = showAbsolute ? full : formatRelativeDate(createdAt);

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
