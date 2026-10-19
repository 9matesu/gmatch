import { describe, it, expect } from 'vitest'
import {
  notificationKey,
  parseNotificationData,
  serverRowToAppNotification,
  deriveConversationNotifications,
  mergeNotifications,
  unreadCountOf,
  unreadByTypeOf,
  latestUnread,
  type AppNotification,
} from './notifications'

/**
 * The unified notification model: server rows and derived courier rows must
 * normalize into ONE shape with stable keys, honest counts and a target that
 * names a real destination.
 */

function row(overrides: Partial<Parameters<typeof serverRowToAppNotification>[0]> = {}) {
  return {
    id: 'n1',
    type: 'like',
    title: 'Bob liked your post',
    body: null,
    data: JSON.stringify({ post_id: 'p1', actor_id: 'bob', actor_name: 'Bob' }),
    read: 0,
    created_at: '2026-10-18T10:00:00.000Z',
    ...overrides,
  }
}

describe('notificationKey', () => {
  it('namespaces by source so the two lanes can never collide', () => {
    expect(notificationKey('server', 'x')).toBe('server:x')
    expect(notificationKey('dm', 'orbit123')).toBe('dm:orbit123')
    expect(notificationKey('room', 'r1')).toBe('room:r1')
  })
})

describe('parseNotificationData', () => {
  it('accepts a JSON string and an already-parsed object', () => {
    expect(parseNotificationData('{"a":1}')).toEqual({ a: 1 })
    expect(parseNotificationData({ a: 1 })).toEqual({ a: 1 })
  })

  it('never throws on garbage — a bad row must not blank the list', () => {
    expect(parseNotificationData('{oops')).toEqual({})
    expect(parseNotificationData(null)).toEqual({})
    expect(parseNotificationData(42)).toEqual({})
  })
})

describe('serverRowToAppNotification', () => {
  it('carries the canonical target the click handler needs', () => {
    const item = serverRowToAppNotification(row())
    expect(item.key).toBe('server:n1')
    expect(item.source).toBe('server')
    expect(item.target).toEqual({ postId: 'p1', userId: 'bob' })
    expect(item.actorId).toBe('bob')
    expect(item.actorName).toBe('Bob')
    expect(item.read).toBe(false)
    expect(item.marks).toEqual(['n1'])
  })

  it('reads a reply target (comment id) and a read flag', () => {
    const item = serverRowToAppNotification(
      row({
        id: 'n2',
        type: 'reply',
        read: 1,
        data: JSON.stringify({
          post_id: 'p1',
          comment_id: 'c9',
          parent_comment_id: 'c1',
          actor_id: 'bob',
          actor_name: 'Bob',
        }),
      }),
    )
    expect(item.read).toBe(true)
    expect(item.target.postId).toBe('p1')
    expect(item.target.commentId).toBe('c9')
    expect(item.target.userId).toBe('bob')
  })

  it('falls back to the actor profile for a follow (no subject)', () => {
    const item = serverRowToAppNotification(
      row({ id: 'n3', type: 'follow', data: JSON.stringify({ follower_id: 'bob', actor_name: 'Bob' }) }),
    )
    expect(item.target).toEqual({ userId: 'bob' })
  })

  it('leaves the target empty when the row carries nothing to open', () => {
    const item = serverRowToAppNotification(row({ id: 'n4', type: 'system', data: null }))
    expect(item.target).toEqual({})
    expect(item.actorId).toBeUndefined()
  })
})

describe('deriveConversationNotifications', () => {
  const threads = {
    peer1: [
      { id: 'm1', text: 'hey', ts: 1000, own: true },
      { id: 'm2', text: 'hello there', ts: 2000 },
      { id: 'm3', text: '@zoe please look', ts: 3000 },
    ],
    peer2: [
      { id: 'm4', text: 'old', ts: 100 },
      { id: 'm5', text: 'gone', ts: 200, deletedTs: 250 },
    ],
  }

  it('aggregates unread per conversation without losing the individual count', () => {
    const items = deriveConversationNotifications({
      threads,
      dmSeen: { peer1: 1000, peer2: 500 },
      selfId: 'self',
      selfName: 'Zoe',
      resolveName: (peerId) => (peerId === 'peer1' ? 'Kenny' : 'Pat'),
    })
    expect(items).toHaveLength(1)
    const [item] = items
    expect(item.key).toBe('dm:peer1')
    expect(item.type).toBe('dm')
    expect(item.count).toBe(2)
    expect(item.title).toBe('Kenny sent you 2 messages')
    expect(item.target).toEqual({ conversationId: 'peer1', userId: 'peer1', messageId: 'm3' })
    expect(item.createdAt).toBe(new Date(3000).toISOString())
  })

  it('counts mentions of the viewer and says so in the body', () => {
    const [item] = deriveConversationNotifications({
      threads,
      dmSeen: { peer1: 1000 },
      selfId: 'self',
      selfName: 'Zoe',
      resolveName: () => 'Kenny',
    })
    expect(item.mentions).toBe(1)
    expect(item.body).toContain('Mentioned you')
  })

  it('does not mention the viewer when the name does not match on a boundary', () => {
    const [item] = deriveConversationNotifications({
      threads: { peer1: [{ id: 'm', text: '@kenny something', ts: 5 }] },
      dmSeen: {},
      selfId: 'self',
      selfName: 'Ken',
      resolveName: () => 'Kenny',
    })
    expect(item.mentions).toBe(0)
  })

  it('ignores a conversation whose inbound messages are all older than the stamp', () => {
    expect(
      deriveConversationNotifications({
        threads,
        dmSeen: { peer1: 9_999_999, peer2: 9_999_999 },
        selfId: 'self',
        resolveName: () => 'Kenny',
      }),
    ).toHaveLength(0)
  })

  it('prefers the sealed payload name over the roster label (payload first)', () => {
    const [item] = deriveConversationNotifications({
      threads: { peer1: [{ id: 'm', text: 'hi', ts: 5, senderName: 'Payload Name' }] },
      dmSeen: {},
      selfId: 'self',
      resolveName: (_peer, payloadName) => payloadName || 'Roster Name',
    })
    expect(item.actorName).toBe('Payload Name')
  })

  it('falls back to the readable handle, never a truncated raw id', () => {
    const peerId = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'
    const [item] = deriveConversationNotifications({
      threads: { [peerId]: [{ id: 'm', text: 'hi', ts: 5 }] },
      dmSeen: {},
      selfId: 'self',
    })
    expect(item.actorName).toBe('User_a1b2c3')
    expect(item.title).toBe('User_a1b2c3 sent you a message')
    // Regression: a slice of the internal hash names nobody.
    expect(item.actorName).not.toBe(peerId.slice(0, 10))
  })

  it('derives a room row from inbound-only messages', () => {
    const items = deriveConversationNotifications({
      rooms: [{ id: 'r1', name: 'Goon Cave' }],
      roomMessages: () => [
        { id: 'a', ts: 500, senderOrbitId: 'peerX', displayName: 'Xena', text: 'yo' },
        { id: 'b', ts: 600, senderOrbitId: 'self', text: 'hi' },
      ],
      roomSeen: {},
      selfId: 'self',
    })
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('room:r1')
    expect(items[0].count).toBe(1)
    expect(items[0].title).toBe('1 new message in Goon Cave')
    expect(items[0].body).toBe('Xena: yo')
    expect(items[0].target).toEqual({ roomId: 'r1', conversationId: 'r1' })
  })

  it('survives a throwing room lookup instead of killing the whole list', () => {
    const items = deriveConversationNotifications({
      threads: { peer1: threads.peer1 },
      dmSeen: {},
      selfId: 'self',
      resolveName: () => 'Kenny',
      rooms: [{ id: 'r1', name: 'X' }],
      roomMessages: () => {
        throw new Error('store exploded')
      },
    })
    expect(items.map((i) => i.key)).toEqual(['dm:peer1'])
  })
})

describe('merge / unread / latest', () => {
  const mk = (key: string, createdAt: string, read = false): AppNotification => ({
    key,
    id: key,
    source: 'server',
    type: 'like',
    title: key,
    body: null,
    createdAt,
    read,
    target: {},
    marks: [],
  })

  it('dedupes by key keeping the newest, newest-first', () => {
    const merged = mergeNotifications(
      [mk('a', '2026-10-18T10:00:00Z'), mk('b', '2026-10-18T12:00:00Z')],
      [mk('a', '2026-10-18T11:00:00Z')],
    )
    expect(merged.map((i) => i.key)).toEqual(['b', 'a'])
    expect(merged.find((i) => i.key === 'a')?.createdAt).toBe('2026-10-18T11:00:00Z')
  })

  it('derives the badge from the items, so badge and list cannot disagree', () => {
    const items = [mk('a', '2026-10-18T10:00:00Z'), mk('b', '2026-10-18T11:00:00Z', true)]
    expect(unreadCountOf(items)).toBe(1)
    expect(latestUnread(items)?.key).toBe('a')
  })

  it('splits unread per type', () => {
    const items: AppNotification[] = [
      { ...mk('a', '2026-10-18T10:00:00Z'), type: 'dm' },
      { ...mk('b', '2026-10-18T10:00:00Z'), type: 'dm' },
      { ...mk('c', '2026-10-18T10:00:00Z'), type: 'like', read: true },
    ]
    expect(unreadByTypeOf(items)).toEqual({ dm: 2 })
  })
})
