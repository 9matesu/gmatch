"use client";

interface InboundMessageLike {
  ts: number;
  senderOrbitId?: string;
  own?: boolean;
  /** Deletion tombstone: the row survives, the message does not count. */
  deletedTs?: number;
}

/**
 * Client-derived chat unread (courier-only DMs: the legacy /api/pm unread
 * endpoints are dead by directive, so the server can never count sealed
 * local DMs). Counts NEW INBOUND MESSAGES newer than their thread/room
 * seen-stamp. Pure — unit-tested, no React.
 */
export function countThreadUnread(
  messages: ReadonlyArray<InboundMessageLike> | undefined | null,
  seenAt: number | undefined | null,
  selfId?: string | null,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const seen = typeof seenAt === 'number' && Number.isFinite(seenAt) ? seenAt : 0;
  let n = 0;
  for (const m of messages) {
    if (!m || typeof m.ts !== 'number' || !Number.isFinite(m.ts)) continue;
    if (m.ts <= seen) continue;
    if (m.own) continue;
    if (m.deletedTs) continue;
    if (selfId && m.senderOrbitId === selfId) continue;
    n += 1;
  }
  return n;
}

export function countChatUnread(args: {
  /** peerId -> courier DM thread. */
  threads?: Record<string, ReadonlyArray<InboundMessageLike>> | null;
  dmSeen?: Record<string, number> | null;
  /** Room ids to include. */
  roomIds?: string[] | null;
  roomMessages?: (roomId: string) => ReadonlyArray<InboundMessageLike>;
  roomSeen?: Record<string, number> | null;
  selfId?: string | null;
  /** Legacy server lane (nonzero only on old self-hosts). */
  serverUnread?: number | null;
}): number {
  const { threads, dmSeen, roomIds, roomMessages, roomSeen, selfId, serverUnread } = args;
  let total = 0;
  if (threads) {
    for (const peerId of Object.keys(threads)) {
      total += countThreadUnread(threads[peerId], dmSeen?.[peerId], selfId);
    }
  }
  if (roomIds && roomMessages) {
    for (const roomId of roomIds) {
      try {
        total += countThreadUnread(roomMessages(roomId), roomSeen?.[roomId], selfId);
      } catch {
        /* one bad room never kills the badge */
      }
    }
  }
  if (typeof serverUnread === 'number' && Number.isFinite(serverUnread) && serverUnread > 0) {
    total += Math.floor(serverUnread);
  }
  return total;
}
