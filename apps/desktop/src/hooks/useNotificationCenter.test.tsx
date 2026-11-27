// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNotificationCenter } from './useNotificationCenter'
import type { ServerNotificationRow } from '../utils/notifications'

/**
 * The red dot is derived from the merged list by the hook, not from a second
 * counter. Push one of every notification type and the count must move on the
 * very next render — including when a caller mutates its row array in place.
 */
const ALL_TYPES = [
  'like', 'comment', 'reply', 'mention', 'comment_like', 'follow',
  'match_invite', 'match_result', 'babecock_invite', 'babecock_start',
  'card_received', 'card_purchase', 'pm', 'system', 'post', 'error',
]

function pushed(type: string, i: number): ServerNotificationRow {
  return {
    id: `n-${type}`,
    type,
    title: `${type} ${i}`,
    body: null,
    data: null,
    read: 0,
    created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  }
}

describe('useNotificationCenter — the unread bubble', () => {
  it('raises the count and the dot for one pushed row of every type', () => {
    const rows: ServerNotificationRow[] = []
    const { result, rerender } = renderHook(() => useNotificationCenter({ rows }))
    expect(result.current.unreadCount).toBe(0)

    ALL_TYPES.forEach((type, i) => {
      rows.push(pushed(type, i))
      rerender()
      expect(result.current.unreadCount).toBe(i + 1)
      expect(result.current.latest?.type).toBe(type)
      expect(result.current.unreadByType[type]).toBe(1)
    })
    expect(result.current.items).toHaveLength(ALL_TYPES.length)
  })

  it('keeps the dot until the row is explicitly read — never fabricates one', () => {
    const rows = [pushed('comment', 0)]
    const { result, rerender } = renderHook(() => useNotificationCenter({ rows }))
    expect(result.current.unreadCount).toBe(1)

    // A re-delivered, unread copy of the same row must not clear or re-raise it.
    rows.push({ ...rows[0] })
    rerender()
    expect(result.current.unreadCount).toBe(1)

    rows[0] = { ...rows[0], read: 1 }
    rows.pop()
    rerender()
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.latest).toBeUndefined()
  })
})
