"use client";

import { useMemo } from 'react'
import {
  deriveConversationNotifications,
  derivePeerNotifications,
  mergeNotifications,
  serverRowToAppNotification,
  unreadByTypeOf,
  unreadCountOf,
  type AppNotification,
  type DmMessageLike,
  type PeerAttentionEvent,
  type RoomMessageLike,
  type ServerNotificationRow,
} from '../utils/notifications'

/**
 * The notification centre's single source of truth.
 *
 * It merges the lanes the app actually has — server rows (likes, comments,
 * replies, mentions, follows, card/match events), courier-derived rows (DMs,
 * sealed rooms) and peer-lane rows (signed operations about my content: a
 * report, a follow, a like, a comment, a reply) — into one newest-first list,
 * and derives the unread badge from that list. There is deliberately no second
 * unread scalar: the badge cannot
 * disagree with what the open centre shows, which is exactly what broke when the
 * WebSocket frame path updated the list but not the counter.
 *
 * `version` is the caller's room-message clock: `roomMessages` reads a mutable
 * store, so the memo needs an explicit nudge when a room message lands.
 */

export type NotificationServerRow = ServerNotificationRow

export interface NotificationCenterInput {
  rows?: ReadonlyArray<NotificationServerRow> | null
  threads?: Record<string, ReadonlyArray<DmMessageLike> | undefined> | null
  dmSeen?: Record<string, number> | null
  rooms?: ReadonlyArray<{ id: string; name?: string }> | null
  roomMessages?: (roomId: string) => ReadonlyArray<RoomMessageLike> | null | undefined
  roomSeen?: Record<string, number> | null
  selfId?: string | null
  selfName?: string | null
  resolveName?: (peerId: string, payloadName?: string) => string
  /** Monotonic clock for mutable courier stores (rooms/threads). */
  version?: number
  /** Peer-lane events about my own content (signed operations). */
  peerEvents?: ReadonlyArray<PeerAttentionEvent> | null
  /** Durable read ids for the peer lane (`utils/peerNotifications.ts`). */
  peerReadIds?: ReadonlySet<string> | null
}

export interface NotificationCenter {
  /** Merged, newest first — the badge and the list both read THIS. */
  items: AppNotification[]
  serverItems: AppNotification[]
  localItems: AppNotification[]
  /** Peer-lane rows (reports, interactions). Rendered in their own section. */
  peerItems: AppNotification[]
  unreadCount: number
  unreadByType: Record<string, number>
  latest?: AppNotification
}

export function useNotificationCenter(input: NotificationCenterInput): NotificationCenter {
  const {
    rows,
    peerEvents,
    peerReadIds,
    threads,
    dmSeen,
    rooms,
    roomMessages,
    roomSeen,
    selfId,
    selfName,
    resolveName,
    version,
  } = input

  const serverItems = useMemo(
    () => (rows || []).map((row) => serverRowToAppNotification(row)),
    [rows],
  )

  const localItems = useMemo(
    () =>
      deriveConversationNotifications({
        threads,
        dmSeen,
        rooms,
        roomMessages,
        roomSeen,
        selfId,
        selfName,
        resolveName,
      }),
    // `version` is intentional: rooms/threads live in mutable stores read
    // through callbacks, so the caller bumps a clock on every inbound message.
    [threads, dmSeen, rooms, roomMessages, roomSeen, selfId, selfName, resolveName, version],
  )

  // The peer lane: reports, follows, likes, comments and replies about my own
  // content. Kept separate from the conversation lane, but merged into the SAME
  // list — the badge and the list must never tell different stories.
  const peerItems = useMemo(
    () => derivePeerNotifications(peerEvents ?? [], { resolveName, readIds: peerReadIds }),
    [peerEvents, resolveName, peerReadIds],
  )

  const items = useMemo(
    () => mergeNotifications(serverItems, [...localItems, ...peerItems]),
    [serverItems, localItems, peerItems],
  )

  const unreadCount = useMemo(() => unreadCountOf(items), [items])
  const unreadByType = useMemo(() => unreadByTypeOf(items), [items])
  const latest = useMemo(() => items.find((item) => !item.read), [items])

  return { items, serverItems, localItems, peerItems, unreadCount, unreadByType, latest }
}
