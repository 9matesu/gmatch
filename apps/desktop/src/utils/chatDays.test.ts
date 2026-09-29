import { describe, expect, it } from 'vitest'
import { dayKey, daySeparatorLabel, groupMessagesByDay } from './chatDays'
import type { ChatMessage } from '../hooks/useP2P'

/**
 * Day separators in a message stream.
 *
 * Without them, a conversation that has been running for three days renders as
 * one undifferentiated wall of text, and a message from three days ago looks
 * like it was just sent. The per-message clock (HH:MM) actively hides the age,
 * because 14:32 is equally true of last Tuesday.
 */

const msg = (id: string, timestamp: number): ChatMessage => ({
  id,
  senderId: 'a',
  senderName: 'A',
  text: id,
  timestamp,
})

/** Local-noon, so a ±1h timezone offset cannot move the day. */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min, 0).getTime()

describe('dayKey', () => {
  it('is the local calendar day, not the UTC one', () => {
    // 23:30 local on the 9th is the 10th in UTC for UTC+ timezones. A chat
    // "Today" must mean today where the reader is, so the key is local.
    const late = new Date(2026, 2, 9, 23, 30).getTime()
    expect(dayKey(late)).toBe('2026-03-09')
    expect(dayKey(new Date(2026, 2, 10, 0, 15).getTime())).toBe('2026-03-10')
  })

  it('distinguishes different days', () => {
    expect(dayKey(at(2026, 3, 1))).not.toBe(dayKey(at(2026, 3, 2)))
  })
})

describe('daySeparatorLabel', () => {
  const now = at(2026, 3, 10, 12)

  it('says Today and Yesterday', () => {
    expect(daySeparatorLabel(now, now)).toBe('Today')
    expect(daySeparatorLabel(at(2026, 3, 9, 23), now)).toBe('Yesterday')
  })

  it('says how many days ago, which is what the reader is missing', () => {
    expect(daySeparatorLabel(at(2026, 3, 8, 23), now)).toBe('2 days ago')
    expect(daySeparatorLabel(at(2026, 3, 5, 12), now)).toBe('5 days ago')
  })

  it('falls back to a real date once "N days ago" stops being useful', () => {
    const old = daySeparatorLabel(at(2026, 1, 5, 12), now)
    expect(old).not.toMatch(/ago$/)
    expect(old).toMatch(/2026/)
  })

  it('a later-timestamped message is still Today, never "in the future"', () => {
    // Clock skew between clients is normal. Saying "-1 days ago" would be
    // nonsense; clamping to Today is the honest reading.
    expect(daySeparatorLabel(now + 60_000, now)).toBe('Today')
  })
})

describe('groupMessagesByDay', () => {
  const now = at(2026, 3, 10, 12)

  it('inserts a separator before the first message of each day', () => {
    const rows = groupMessagesByDay(
      [
        msg('old-1', at(2026, 3, 8, 10, 0)),
        msg('old-2', at(2026, 3, 8, 10, 2)), // same author, 2 min apart -> one block
        msg('new-1', at(2026, 3, 10, 9)),
      ],
      now,
    )
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'day', 'message'])
    expect(rows[0]).toMatchObject({ kind: 'day', label: '2 days ago' })
  })

  it('does not repeat a separator within the same day', () => {
    const rows = groupMessagesByDay(
      [msg('a', at(2026, 3, 10, 9)), msg('b', at(2026, 3, 10, 10)), msg('c', at(2026, 3, 10, 11))],
      now,
    )
    expect(rows.filter((r) => r.kind === 'day')).toHaveLength(1)
  })

  it('groups consecutive same-author messages into one block', () => {
    const rows = groupMessagesByDay([msg('a', now - 3000), msg('b', now - 2000)], now)
    // One separator, then a single block holding both.
    expect(rows).toHaveLength(2)
    expect(rows[1].kind).toBe('message')
    if (rows[1].kind === 'message') expect(rows[1].messages).toHaveLength(2)
  })

  it('starts a new block when the author changes', () => {
    const other: ChatMessage = { ...msg('b', now - 2000), senderId: 'b' }
    const rows = groupMessagesByDay([msg('a', now - 3000), other], now)
    expect(rows.filter((r) => r.kind === 'message')).toHaveLength(2)
  })

  it('returns nothing for an empty stream', () => {
    expect(groupMessagesByDay([], now)).toEqual([])
  })

  it('keeps message order stable', () => {
    const rows = groupMessagesByDay(
      [msg('1', at(2026, 3, 8, 10)), msg('2', at(2026, 3, 9, 10)), msg('3', now)],
      now,
    )
    const ids = rows.filter((r) => r.kind === 'message').flatMap((r) => r.messages.map((m) => m.id))
    expect(ids).toEqual(['1', '2', '3'])
  })
})
