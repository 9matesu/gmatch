"use client";

/**
 * Unified notification model (client).
 *
 * Two sources feed ONE header centre:
 *
 *  - **server rows**   — the persistent `Notifications` table (likes, comments,
 *    replies, mentions, follows, card events, match results). Authoritative for
 *    everything that happened while this client had no local copy.
 *  - **derived local** — the sealed courier lanes (DMs, rooms). The courier is
 *    blind and `/api/pm` is retired, so no server ever knows an unread DM
 *    exists. Deriving the notification from the *message store itself* (rather
 *    than persisting a second copy of the same fact) is what keeps the two
 *    systems consistent without coupling them: the notification IS the
 *    conversation's unread count, and reading it is the very `dmSeen` stamp the
 *    chat badge already uses.
 *
 * Nothing here is invented: a derived row exists only when a real inbound
 * message newer than the reader's stamp exists, and it never claims delivery or
 * presence the protocol did not prove.
 *
 * Pure module — no React, no storage. Unit-tested in `notifications.test.ts`.
 */

import { generateFallbackName } from '@orbit/shared'
import { countThreadUnread } from './chatUnread'
import { countMentions, createMentionMatcher } from './mentions'

export type NotificationSource = 'server' | 'local'

/** Where activating a notification should land the player. */
export interface NotificationTarget {
  postId?: string
  commentId?: string
  userId?: string
  conversationId?: string
  messageId?: string
  roomId?: string
  inviteId?: string
  matchId?: string
}

export interface AppNotification {
  /**
   * Stable identity for dedupe + read marking. Built by {@link notificationKey}
   * so both sources can never mint the same key by accident.
   */
  key: string
  /** Underlying subject id (server row id, peer id, room id). */
  id: string
  source: NotificationSource
  /** `like` | `comment` | `reply` | `mention` | `comment_like` | `follow` |
   *  `card_purchase` | `card_received` | `match_invite` | `match_result` |
   *  `babecock_invite` | `babecock_start` | `pm` | `system` | `dm` | `room`. */
  type: string
  title: string
  body: string | null
  /** ISO timestamp. */
  createdAt: string
  read: boolean
  actorId?: string
  actorName?: string
  target: NotificationTarget
  /** Server row ids this item stands for (targeted read marking). */
  marks: string[]
  /** Individual interactions this row aggregates (DM/room message count). */
  count?: number
  /** Of `count`, how many mention the viewer by name. */
  mentions?: number
  data?: Record<string, unknown>
}

/** Canonical, collision-free event key. */
export function notificationKey(kind: 'server' | 'dm' | 'room' | 'local', subject: string): string {
  return `${kind}:${subject}`
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Server `data` is a JSON string on the wire, an object once parsed by a
 * proxy/older client. Tolerate both — a throw here would blank the whole list.
 */
export function parseNotificationData(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

export interface ServerNotificationRow {
  id: string
  type: string
  title: string
  body?: string | null
  data?: unknown
  read?: number | boolean
  created_at: string
}

/** Normalize one server row into the unified shape. */
export function serverRowToAppNotification(row: ServerNotificationRow): AppNotification {
  const d = parseNotificationData(row.data)
  const actorId =
    asString(d.actor_id) ??
    asString(d.actor) ??
    asString(d.liker_id) ??
    asString(d.buyer_id) ??
    asString(d.sender_id) ??
    asString(d.follower_id)

  const target: NotificationTarget = {}
  const postId = asString(d.post_id) ?? asString(d.object_id)
  const commentId = asString(d.comment_id)
  const conversationId = asString(d.peer_id) ?? asString(d.conversation_id)
  const roomId = asString(d.room_id)
  const inviteId = asString(d.invite_id)
  const matchId = asString(d.match_id)
  if (postId) target.postId = postId
  if (commentId) target.commentId = commentId
  if (conversationId) target.conversationId = conversationId
  if (roomId) target.roomId = roomId
  if (inviteId) target.inviteId = inviteId
  if (matchId) target.matchId = matchId
  // A follow/engagement row has no subject but the actor — the profile is the
  // only honest destination. A missing actor leaves the target empty and the
  // UI falls back to "open the centre" instead of navigating nowhere.
  if (actorId) target.userId = actorId

  return {
    key: notificationKey('server', row.id),
    id: row.id,
    source: 'server',
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    createdAt: row.created_at,
    read: Boolean(row.read),
    ...(actorId ? { actorId } : {}),
    ...(asString(d.actor_name) ? { actorName: asString(d.actor_name) as string } : {}),
    target,
    marks: [row.id],
    data: d,
  }
}

/** Structural shapes the derivation needs (keeps this module free of cycles). */
export interface DmMessageLike {
  id: string
  text?: string
  ts: number
  own?: boolean
  deletedTs?: number
  senderName?: string
}

export interface RoomMessageLike {
  id: string
  ts: number
  text?: string
  senderOrbitId?: string
  displayName?: string
  deletedTs?: number
}

export interface ConversationNotificationArgs {
  /** peerId → courier DM thread. */
  threads?: Record<string, ReadonlyArray<DmMessageLike> | undefined> | null
  dmSeen?: Record<string, number> | null
  rooms?: ReadonlyArray<{ id: string; name?: string }> | null
  roomMessages?: (roomId: string) => ReadonlyArray<RoomMessageLike> | null | undefined
  roomSeen?: Record<string, number> | null
  selfId?: string | null
  selfName?: string | null
  /** Peer display label (sealed payload name wins, then the roster). */
  resolveName?: (peerId: string, payloadName?: string) => string
}

/**
 * Newest message that is genuinely inbound: not a tombstone, not ours. Used for
 * the row's preview and timestamp so a row never reads "…sent you 2 messages"
 * above your own last line.
 */
function newestInbound<T extends { ts: number; deletedTs?: number; own?: boolean; senderOrbitId?: string }>(
  messages: ReadonlyArray<T>,
  selfId?: string | null,
): T | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (!m || m.deletedTs) continue
    if (m.own) continue
    if (selfId && m.senderOrbitId === selfId) continue
    return m
  }
  return undefined
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function previewOf(text: string | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 90)
}

/**
 * One aggregated row per unread conversation / room. Aggregation never loses an
 * interaction: the individual count (and how many of them mention the viewer)
 * travels on the row and is what the reader sees.
 */
export function deriveConversationNotifications(
  args: ConversationNotificationArgs,
): AppNotification[] {
  const { threads, dmSeen, rooms, roomMessages, roomSeen, selfId, selfName } = args
  // No name anywhere: show the app's readable handle (`User_abc123`, the same
  // fallback courier presence and the lobby use), never a truncated raw id —
  // a slice of an internal hash names nobody, while the handle at least stays
  // consistent with every other surface that renders an unknown peer.
  const resolveName =
    args.resolveName ??
    ((peerId: string, payloadName?: string) => payloadName?.trim() || generateFallbackName(peerId))
  const matcher = createMentionMatcher({ displayName: selfName, orbitId: selfId })
  const out: AppNotification[] = []

  for (const [peerId, thread] of Object.entries(threads ?? {})) {
    if (!thread || thread.length === 0) continue
    const unread = countThreadUnread(thread, dmSeen?.[peerId], selfId)
    if (unread <= 0) continue
    const last = newestInbound(thread, selfId)
    const name = resolveName(peerId, last?.senderName)
    // Same helper the chat badge uses, so the "Mentioned you" note and the
    // chat's per-thread mention count can never tell different stories.
    const mentions = countMentions(thread, matcher, dmSeen?.[peerId] ?? 0)
    const preview = previewOf(last?.text)
    const body = [mentions > 0 ? `Mentioned you${preview ? ': ' : ''}` : '', preview]
      .filter(Boolean)
      .join('')
    out.push({
      key: notificationKey('dm', peerId),
      id: peerId,
      source: 'local',
      type: 'dm',
      title:
        unread === 1
          ? `${name} sent you a message`
          : `${name} sent you ${unread} messages`,
      body: body || null,
      createdAt: new Date(last?.ts ?? Date.now()).toISOString(),
      read: false,
      actorId: peerId,
      actorName: name,
      target: {
        conversationId: peerId,
        userId: peerId,
        ...(last ? { messageId: last.id } : {}),
      },
      marks: [],
      count: unread,
      mentions,
    })
  }

  if (rooms && roomMessages) {
    for (const room of rooms) {
      let messages: ReadonlyArray<RoomMessageLike> | null | undefined
      try {
        messages = roomMessages(room.id)
      } catch {
        continue // one bad room must never kill the whole list
      }
      if (!messages || messages.length === 0) continue
      const unread = countThreadUnread(messages, roomSeen?.[room.id], selfId)
      if (unread <= 0) continue
      const last = newestInbound(messages, selfId)
      const senderName =
        asString(last?.displayName) ?? (last?.senderOrbitId ? resolveName(last.senderOrbitId) : undefined)
      const roomName = room.name?.trim() || 'a room'
      out.push({
        key: notificationKey('room', room.id),
        id: room.id,
        source: 'local',
        type: 'room',
        title: `${unread} new ${plural(unread, 'message', 'messages')} in ${roomName}`,
        body: [senderName, previewOf(last?.text)].filter(Boolean).join(': ') || null,
        createdAt: new Date(last?.ts ?? Date.now()).toISOString(),
        read: false,
        target: { roomId: room.id, conversationId: room.id },
        marks: [],
        count: unread,
      })
    }
  }

  return out
}

/**
 * Merge sources into one list: newest first, deduped by {@link AppNotification.key}
 * (the newest row for a key wins, so a repeated delivery cannot double-render).
 */
/**
 * Reports about MY content (peer lane).
 *
 * In a mesh there is no central moderator: a report travels as a signed
 * operation to the peers, and the AUTHOR of the content is the one who can
 * act on it. So the report shows up in the author's notification centre —
 * not as "an admin will handle it" (nobody is an admin of a mesh).
 */
export function derivePeerReportNotifications(
  reports: ReadonlyArray<{ operationId: string; targetType: 'post' | 'comment'; targetId: string; reason: string; reporterId: string; createdAt: number }>,
  args: { resolveName?: (peerId: string, payloadName?: string) => string } = {},
): AppNotification[] {
  const resolveName =
    args.resolveName ??
    ((peerId: string, payloadName?: string) => payloadName?.trim() || generateFallbackName(peerId))
  return reports.map((report) => {
    const name = resolveName(report.reporterId)
    return {
      key: notificationKey('local', `report-${report.operationId}`),
      id: report.operationId,
      source: 'local',
      type: 'report',
      title: `${name} reported your ${report.targetType}`,
      body: report.reason.trim() || null,
      createdAt: new Date(report.createdAt).toISOString(),
      read: false,
      actorId: report.reporterId,
      actorName: name,
      target: report.targetType === 'post'
        ? { postId: report.targetId }
        : { commentId: report.targetId },
      marks: [],
    }
  })
}

export function mergeNotifications(
  ...groups: ReadonlyArray<ReadonlyArray<AppNotification>>
): AppNotification[] {
  const byKey = new Map<string, AppNotification>()
  for (const group of groups) {
    for (const item of group) {
      const prev = byKey.get(item.key)
      if (!prev || Date.parse(item.createdAt) >= Date.parse(prev.createdAt)) {
        byKey.set(item.key, item)
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  )
}

/**
 * Unread derives from the ITEMS, never from a second scalar — the header badge
 * and the list it labels can therefore never disagree. (The server list is
 * capped at 50 per fetch; that cap is the badge's cap too, which is honest
 * about what the centre can actually show.)
 */
export function unreadCountOf(items: ReadonlyArray<AppNotification>): number {
  let n = 0
  for (const item of items) if (!item.read) n += 1
  return n
}

/** Unread split per type, for the per-row badges and the summary line. */
export function unreadByTypeOf(items: ReadonlyArray<AppNotification>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    if (item.read) continue
    out[item.type] = (out[item.type] || 0) + 1
  }
  return out
}

/** The newest unread item, for the header's collapsed preview line. */
export function latestUnread(
  items: ReadonlyArray<AppNotification>,
): AppNotification | undefined {
  return items.find((item) => !item.read)
}
