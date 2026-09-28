import { describe, expect, it } from 'vitest'
import { parseApiTimestamp, timeAgo } from './timeAgo'

describe('parseApiTimestamp', () => {
  it('reads SQLite CURRENT_TIMESTAMP as UTC, not local time', () => {
    // Regression: the raw string parses as LOCAL, shifting every timestamp by
    // the viewer's offset.
    const d = parseApiTimestamp('2026-09-28 12:34:56')
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe('2026-09-28T12:34:56.000Z')
  })

  it('leaves a real ISO timestamp alone', () => {
    expect(parseApiTimestamp('2026-09-28T12:34:56.000Z')!.toISOString())
      .toBe('2026-09-28T12:34:56.000Z')
  })

  it('returns null for junk and empties', () => {
    expect(parseApiTimestamp('')).toBeNull()
    expect(parseApiTimestamp(null)).toBeNull()
    expect(parseApiTimestamp('Just now')).toBeNull()
    expect(parseApiTimestamp('not a date')).toBeNull()
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z')

  it('collapses the last minute to "just now"', () => {
    expect(timeAgo('2026-09-28 11:59:30', now)).toBe('just now')
  })

  it('scales through minutes, hours, days and weeks', () => {
    expect(timeAgo('2026-09-28 11:45:00', now)).toBe('15m')
    expect(timeAgo('2026-09-28 09:00:00', now)).toBe('3h')
    expect(timeAgo('2026-09-27 12:00:00', now)).toBe('1d')
    expect(timeAgo('2026-09-14 12:00:00', now)).toBe('2w')
  })

  it('never goes negative on clock skew', () => {
    expect(timeAgo('2026-09-28 13:00:00', now)).toBe('just now')
  })

  it('falls back to a date past a month, and to empty for junk', () => {
    expect(timeAgo('2026-01-01 00:00:00', now)).toMatch(/\d/)
    expect(timeAgo('nonsense', now)).toBe('')
  })
})
