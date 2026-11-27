/**
 * The one English timestamp formatter for chat and posts.
 *
 * `toLocaleString()` follows the DEVICE's locale, so the same post reads
 * "Oct 26, 2026" here and "26 de Out. 2026" on a Brazilian machine. Every
 * formatter here pins `en-US` explicitly and is built once at module load —
 * a timeline asks for one per row per render.
 *
 * Parsing is shared with utils/timeAgo (SQLite's zone-less UTC stamps are NOT
 * local wall-clock time); this module never invents a date from a bad value.
 */

import { parseApiTimestamp } from './timeAgo'

export type TimestampInput = string | number | Date

const FULL = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
})
const FULL_WITH_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const COUNT = new Intl.NumberFormat('en-US')

function asDate(value: TimestampInput | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return parseApiTimestamp(value)
}

/** `Oct 26, 2026` — with the clock appended only where the surface shows it. */
export function formatDate(value: TimestampInput | null | undefined, withTime = false): string {
  const d = asDate(value)
  if (!d) return ''
  return (withTime ? FULL_WITH_TIME : FULL).format(d)
}

/** `3:28 PM`, always en-US. Chat clocks and thread previews use this. */
export function formatTime(value: TimestampInput | null | undefined): string {
  const d = asDate(value)
  return d ? CLOCK.format(d) : ''
}

/**
 * English relative time with the same thresholds as utils/timeAgo, but the
 * old-post fallback goes through `formatDate` instead of the machine locale.
 * `now` is injectable so rendered lists can pin their clock in tests.
 */
export function formatRelativeDate(value: TimestampInput | null | undefined, now: number = Date.now()): string {
  const d = asDate(value)
  if (!d) return ''
  const seconds = Math.max(0, Math.floor((now - d.getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  return formatDate(d)
}

/** Grouped counts in an English app must not follow the device locale either. */
export function formatCount(value: number): string {
  return COUNT.format(value)
}
