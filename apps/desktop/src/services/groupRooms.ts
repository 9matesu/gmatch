import type { Room, RoomMessage } from '../utils/rooms'

/**
 * A node group, and the sealed room that carries its conversation (roadmap
 * L6).
 *
 * The node owns the GROUP (who is in it, who may join). The conversation
 * itself does not have to live on the node: a group maps to a room whose DEK
 * is shared 1:1 (sealed) with the members, and every message is group-sealed
 * and fanned out to the members' mailboxes.
 *
 * The room id is DERIVED from the group id, so every member computes the same
 * room without a directory lookup. The DEK cannot be derived (it is the
 * secret), so it is created once and shipped inside the sealed invite — the
 * first member to open the group owns it, and a second creator does NOT
 * overwrite it (the invite merges membership, the DEK of the first room
 * stays).
 */

export interface GroupInfo {
  id: string
  name: string
  owner_id: string
  member_count: number
  is_member: number
}

export interface GroupRoomMember {
  id: string
  display_name?: string | null
}

/** The room that carries a group's conversation. Deterministic on purpose. */
export function roomIdForGroup(groupId: string): string {
  return `group_${groupId}`
}

/** The room operations this service needs (the RoomManager, in the app). */
export interface GroupRoomOps {
  rooms(): Room[]
  createRoom(name: string, id: string): Room
  invite(roomId: string, peerId: string): Promise<boolean>
  messages(roomId: string): RoomMessage[]
  say(roomId: string, text: string, displayName?: string): Promise<string | null>
}

export interface EnsureGroupRoomResult {
  roomId: string
  /** True when this client minted the room (and therefore the DEK). */
  created: boolean
  /** Members the invite reached. */
  invited: string[]
  /** Members this client cannot reach (their keys are unknown). */
  unreachable: string[]
}

/**
 * Make sure a sealed room exists for the group, and invite the members.
 *
 * Idempotent: the room is created once, the invite is re-sent for members
 * that have not joined yet (an invite can be lost — a member was offline).
 */
export async function ensureGroupRoom(
  group: GroupInfo,
  members: GroupRoomMember[],
  ops: GroupRoomOps,
  selfId: string,
): Promise<EnsureGroupRoomResult> {
  const roomId = roomIdForGroup(group.id)
  const existing = ops.rooms().find((r) => r.id === roomId)
  const room = existing ?? ops.createRoom(group.name, roomId)
  const created = !existing

  const invited: string[] = []
  const unreachable: string[] = []
  for (const member of members) {
    if (!member?.id || member.id === selfId) continue
    if (room.members.includes(member.id)) {
      // Already in the room: it may still have missed the DEK (an invite that
      // never landed), so re-invite — the DEK of the first room stays.
      const ok = await ops.invite(roomId, member.id).catch(() => false)
      if (ok) invited.push(member.id)
      continue
    }
    const ok = await ops.invite(roomId, member.id).catch(() => false)
    if (ok) invited.push(member.id)
    else unreachable.push(member.id)
  }
  return { roomId, created, invited, unreachable }
}

/**
 * The conversation of a group: what the node still holds (the history from
 * before the room existed) plus the sealed room's own messages.
 *
 * Deduplicated by id and ordered by time. The node's rows are the past; the
 * room's rows are now. A row the node does not know yet (the sealed lane is
 * faster than the node's poll) is still shown — it is the same conversation.
 */
export function mergeGroupMessages<T extends { id: string; timestamp: number }>(
  nodeRows: readonly T[],
  roomRows: readonly RoomMessage[],
  selfId: string,
  displayName?: string,
): (T | ChatRoomRow)[] {
  const seen = new Set(nodeRows.map((row) => row.id))
  const extra: ChatRoomRow[] = roomRows
    .filter((row) => !seen.has(row.id))
    .map((row) => ({
      id: row.id,
      senderId: row.senderOrbitId,
      senderName: row.displayName?.trim() || (row.senderOrbitId === selfId ? displayName || 'You' : 'Someone'),
      text: row.text,
      timestamp: row.ts,
      sealed: true,
    }))
  return [...nodeRows, ...extra].sort((a, b) => a.timestamp - b.timestamp)
}

/** A room row shaped like the app's chat message. */
export interface ChatRoomRow {
  id: string
  senderId: string
  senderName: string
  text: string
  timestamp: number
  /** True when the row came through the sealed room (not the node). */
  sealed?: boolean
}
