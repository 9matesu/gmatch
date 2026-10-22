import { describe, expect, it, vi } from 'vitest'
import {
  ensureGroupRoom,
  mergeGroupMessages,
  roomIdForGroup,
  type GroupRoomOps,
} from './groupRooms'
import type { Room, RoomMessage } from '../utils/rooms'

const ME = 'me-1'
const ALICE = 'alice-1'
const BOB = 'bob-1'

function opsWith(rooms: Room[] = [], invited: string[] = []): GroupRoomOps & { invited: string[] } {
  const store = [...rooms]
  const invitedList = invited
  const ops = {
    invited: invitedList,
    rooms: () => store,
    createRoom: (name: string, id: string) => {
      const room: Room = { id, name, dekHex: '00'.repeat(32), epoch: 1, ownerId: ME, members: [ME], createdAt: 1 }
      store.push(room)
      return room
    },
    invite: vi.fn(async (roomId: string, peerId: string) => {
      const room = store.find((r) => r.id === roomId)
      if (!room) return false
      room.members = [...new Set([...room.members, peerId])]
      invitedList.push(peerId)
      return true
    }),
    messages: () => [] as RoomMessage[],
    say: vi.fn(async () => 'msg-1'),
  }
  return ops
}

describe('group rooms (sealed group conversation)', () => {
  it('derives the same room id from the group id', () => {
    expect(roomIdForGroup('g-7')).toBe('group_g-7')
    expect(roomIdForGroup('g-7')).toBe(roomIdForGroup('g-7'))
  })

  it('creates the room once and invites the members', async () => {
    const ops = opsWith()
    const first = await ensureGroupRoom(
      { id: 'g-7', name: 'Crew', owner_id: ALICE, member_count: 3, is_member: 1 },
      [{ id: ALICE }, { id: BOB }],
      ops,
      ME,
    )
    expect(first.created).toBe(true)
    expect(first.roomId).toBe('group_g-7')
    expect(first.invited.sort()).toEqual([ALICE, BOB].sort())
    expect(ops.rooms()).toHaveLength(1)

    // Second call: no second room, and the invite is replayed for a member
    // that may have missed the DEK.
    const second = await ensureGroupRoom(
      { id: 'g-7', name: 'Crew', owner_id: ALICE, member_count: 3, is_member: 1 },
      [{ id: ALICE }, { id: BOB }],
      ops,
      ME,
    )
    expect(second.created).toBe(false)
    expect(ops.rooms()).toHaveLength(1)
    expect(ops.invite).toHaveBeenCalledTimes(4)
  })

  it('never invites itself', async () => {
    const ops = opsWith()
    const result = await ensureGroupRoom(
      { id: 'g-7', name: 'Crew', owner_id: ALICE, member_count: 2, is_member: 1 },
      [{ id: ME }, { id: ALICE }],
      ops,
      ME,
    )
    expect(result.invited).toEqual([ALICE])
  })

  it('reports a member it cannot reach instead of pretending', async () => {
    const ops = opsWith()
    ops.invite = vi.fn(async () => false)
    const result = await ensureGroupRoom(
      { id: 'g-7', name: 'Crew', owner_id: ALICE, member_count: 2, is_member: 1 },
      [{ id: ALICE }],
      ops,
      ME,
    )
    expect(result.invited).toEqual([])
    expect(result.unreachable).toEqual([ALICE])
  })

  it('merges the node history with the sealed room rows, without duplicates', () => {
    const nodeRows = [
      { id: 'n1', senderId: ALICE, senderName: 'Alice', text: 'old', timestamp: 10 },
      { id: 'n2', senderId: ME, senderName: 'You', text: 'older', timestamp: 20 },
    ]
    const roomRows: RoomMessage[] = [
      { id: 'r1', roomId: 'group_g-7', senderOrbitId: BOB, text: 'sealed', ts: 30 },
      { id: 'n2', roomId: 'group_g-7', senderOrbitId: ME, text: 'older', ts: 20 },
    ]
    const merged = mergeGroupMessages(nodeRows, roomRows, ME, 'Me')
    expect(merged.map((m) => m.id)).toEqual(['n1', 'n2', 'r1'])
    const sealed = merged[merged.length - 1] as { sealed?: boolean; senderName?: string }
    expect(sealed.sealed).toBe(true)
    expect(sealed.senderName).toBe('Someone')
  })
})
