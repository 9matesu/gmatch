import { describe, it, expect } from 'vitest'
import { formatCount, formatDate, formatRelativeDate, formatTime } from './formatDate'

const ISO = '2026-10-26T12:00:00.000Z'
const SQLITE = '2026-10-26 12:00:00'

describe('formatDate', () => {
  it('formats an absolute date in English, never the device locale', () => {
    expect(formatDate(ISO)).toBe('Oct 26, 2026')
    expect(formatDate(SQLITE)).toBe('Oct 26, 2026')
    expect(formatDate(new Date(ISO))).toBe('Oct 26, 2026')
    expect(formatDate(Date.parse(ISO))).toBe('Oct 26, 2026')
  })

  it('appends the time only when the surface asks for it', () => {
    expect(formatDate(ISO, true)).toMatch(/Oct 26, 2026,?\s/)
    expect(formatTime(ISO)).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
  })

  it('never fabricates a date from an empty or broken stamp', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate('not a date')).toBe('')
    expect(formatTime(null)).toBe('')
  })

  it('keeps relative time English, including the old-post fallback', () => {
    const now = Date.parse('2026-10-26T12:00:00.000Z')
    expect(formatRelativeDate(ISO, now)).toBe('just now')
    expect(formatRelativeDate('2026-10-26T11:58:00.000Z', now)).toBe('2m')
    expect(formatRelativeDate('2026-10-25T12:00:00.000Z', now)).toBe('1d')
    // Past five weeks the device-locale date used to leak in ("26 de Out.").
    expect(formatRelativeDate('2026-08-01T12:00:00.000Z', now)).toBe('Aug 1, 2026')
  })

  it('groups counts with the English separator', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})
