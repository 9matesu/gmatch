import { generateDek } from '@orbit/crypto'
import {
  sealGroup,
  openGroup,
  type Envelope,
  type OpenedEnvelope,
} from '@orbit/protocol'
import { MailClient } from './mail-client'
import { scopedKey, type DmStore } from './mail-dm'
import { getSecureItem, setSecureItem } from './secure-storage'
import type { OrbitIdentity } from '@orbit/crypto'

/**
 * Ares-style rooms over the blind courier (plan P3.4).
 *
 * A room is a shared DEK + member list, held ONLY in members' local state.
 * The courier stores nothing but opaque envelopes it fans out per member
 * inbox — it never learns the room, its members, or that the copies relate.
 *
 * Wire (each hop is an ECIES 1:1 mail envelope the MailClient seals/sends):
 *   - invite : body = { t:'room_invite', room }                (1:1, owner->member)
 *   - msg    : body = { t:'room_msg_wire', env } where `env` is a GROUP-sealed
 *              envelope (sealGroup) — so every member opens the SAME inner
 *              envelope with the room DEK; the outer ECIES just routes it to
 *              that member's inbox. (N outer copies, 1 logical message.)
 *   - rewrap : body = { t:'room_invite', room } with epoch+1   (owner->members)
 *
 * Leave: member drops locally + (if not owner) mails owner {t:'room_leave',
 * roomId}; owner mints a fresh DEK (epoch+1), drops the leaver, and re-invites
 * the survivors. The leaver's old DEK stops opening future group envelopes.
 */

export interface Room {
  id: string
  name: string
  dekHex: string
  epoch: number
  ownerId: string
  members: string[] // orbitIds
  createdAt: number
}

export interface RoomMessage {
  id: string
  roomId: string
  senderOrbitId: string
  /**
   * Sender's display name at send time, sealed into the message body.
   *
   * A room is anonymous by construction: the courier stores opaque envelopes
   * and the roster is not guaranteed to contain every member (a member can be
   * offline, or simply absent from the capped /api/users page). Resolving names
   * from the roster at render time is what made every room sender render as
   * "User" / "Unknown User" / blank. Carrying the name in the sealed payload
   * means it needs no lookup at all.
   *
   * Optional: rows written before this field existed have none, and the
   * renderer falls back to the roster for those.
   */
  displayName?: string
  text: string
  ts: number
}

/** Inner (group-sealed) room message payload. */
interface RoomMsgBody {
  id: string
  text: string
  ts: number
  /** Optional so messages sealed by an older client still open. */
  n?: string
}

const ROOMS_KEY = 'orbit_rooms_v1'
const MSGS_KEY = 'orbit_room_messages_v1'
/**
 * Per-room backstop, NOT a retention policy — see the same note on
 * MAX_PER_THREAD in mail-dm.ts. Room history is permanent; this only keeps the
 * secure-storage blob from outgrowing the browser's origin-wide localStorage
 * ceiling, and it drops the OLDEST rows, which is the half anyone would miss.
 */
const MAX_PER_ROOM = 2000

type RoomWire =
  | { t: 'room_invite'; room: Room }
  | { t: 'room_leave'; roomId: string }
  | { t: 'room_msg_wire'; env: Envelope }

function readJson<T>(key: string, fb: T): T {
  try {
    const raw = getSecureItem(key)
    return raw ? (JSON.parse(raw) as T) : fb
  } catch {
    return fb
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    setSecureItem(key, JSON.stringify(v))
  } catch { /* capped; tolerate quota */ }
}
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
function randomHex(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return toHex(b)
}

export interface RoomManagerDeps {
  identity: OrbitIdentity
  mail: MailClient
  peers: Pick<DmStore, 'peerKeys'>
  onChanged?: () => void
  /** Fired for each NEW room message appended (UI notification). */
  onIncoming?: (msg: RoomMessage, room: Room) => void
}

export class RoomManager {
  private readonly roomsKey: string
  private readonly msgsKey: string

  constructor(private readonly deps: RoomManagerDeps) {
    this.roomsKey = scopedKey(ROOMS_KEY, deps.identity.orbitId)
    this.msgsKey = scopedKey(MSGS_KEY, deps.identity.orbitId)
  }

  rooms(): Room[] {
    return readJson(this.roomsKey, [] as Room[])
  }

  messages(roomId: string): RoomMessage[] {
    return readJson(this.msgsKey, {} as Record<string, RoomMessage[]>)[roomId] || []
  }

  private saveRooms(rooms: Room[]): void {
    writeJson(this.roomsKey, rooms)
    this.deps.onChanged?.()
  }

  private appendMessage(msg: RoomMessage): boolean {
    const all = readJson(this.msgsKey, {} as Record<string, RoomMessage[]>)
    const list = all[msg.roomId] || []
    if (list.some((m) => m.id === msg.id)) return false
    all[msg.roomId] = [...list, msg].slice(-MAX_PER_ROOM)
    writeJson(this.msgsKey, all)
    this.deps.onChanged?.()
    return true
  }

  createRoom(name: string): Room {
    const me = this.deps.identity.orbitId
    const room: Room = {
      id: randomHex(16),
      name: name.trim() || 'untitled room',
      dekHex: toHex(generateDek()),
      epoch: 1,
      ownerId: me,
      members: [me],
      createdAt: Date.now(),
    }
    this.saveRooms([...this.rooms(), room])
    return room
  }

  /** Invite a peer whose keys we know: sealed room-state (with DEK) to them. */
  async invite(roomId: string, peerId: string): Promise<boolean> {
    const room = this.rooms().find((r) => r.id === roomId)
    const keys = this.deps.peers.peerKeys(peerId)
    if (!room || !keys?.publicKeyHex || !keys.encryptionPubHex || room.members.includes(peerId)) return false
    const wire: RoomWire = { t: 'room_invite', room }
    try {
      await this.deps.mail.send(JSON.stringify(wire), 'invite', {
        publicKeyHex: keys.publicKeyHex,
        encryptionPubHex: keys.encryptionPubHex,
      })
    } catch {
      return false
    }
    this.saveRooms(this.rooms().map((r) => (r.id === roomId ? { ...r, members: [...r.members, peerId] } : r)))
    return true
  }

  /**
   * Post: group-seal once, then ECIES-copy the group envelope to each member.
   *
   * The sender's display name rides INSIDE the group envelope, so every member
   * renders the author by name with no roster lookup — see RoomMessage.
   */
  async say(roomId: string, text: string, displayName?: string): Promise<string | null> {
    const room = this.rooms().find((r) => r.id === roomId)
    if (!room) return null
    const me = this.deps.identity.orbitId
    const msgId = randomHex(8)
    const now = Date.now()
    const body: RoomMsgBody = { id: msgId, text, ts: now }
    // Only a real name travels; an unset one stays absent so the receiver
    // resolves it from its roster rather than stamping a placeholder over the
    // name that roster already has.
    if (displayName && displayName.trim()) body.n = displayName.trim()
    const groupEnv = sealGroup(JSON.stringify(body), 'announce', this.senderKeys(), room.id, fromHex(room.dekHex))
    for (const memberId of room.members) {
      if (memberId === me) continue
      const keys = this.deps.peers.peerKeys(memberId)
      if (!keys?.publicKeyHex || !keys.encryptionPubHex) continue
      const wire: RoomWire = { t: 'room_msg_wire', env: groupEnv }
      await this.deps.mail.send(JSON.stringify(wire), 'mail', {
        publicKeyHex: keys.publicKeyHex,
        encryptionPubHex: keys.encryptionPubHex,
      }).catch(() => { /* member offline: their box holds it till TTL/next pull */ })
    }
    // Sender echoes into own history (courier never copies back to sender).
    this.appendMessage({
      id: msgId,
      roomId,
      senderOrbitId: me,
      ...(body.n ? { displayName: body.n } : {}),
      text,
      ts: now,
    })
    return msgId
  }

  async leave(roomId: string): Promise<void> {
    const room = this.rooms().find((r) => r.id === roomId)
    if (!room) return
    const me = this.deps.identity.orbitId
    if (room.ownerId === me) {
      this.saveRooms(this.rooms().filter((r) => r.id !== roomId))
      return
    }
    const owner = this.deps.peers.peerKeys(room.ownerId)
    if (owner?.publicKeyHex && owner.encryptionPubHex) {
      const wire: RoomWire = { t: 'room_leave', roomId }
      await this.deps.mail.send(JSON.stringify(wire), 'mail', {
        publicKeyHex: owner.publicKeyHex,
        encryptionPubHex: owner.encryptionPubHex,
      }).catch(() => { /* best effort */ })
    }
    this.saveRooms(this.rooms().filter((r) => r.id !== roomId))
  }

  /**
   * Inbound hook. Returns true if the opened mail body was a room wire (the
   * DM layer must then NOT treat it as a DM). `opened.body` is the outer
   * ECIES-decrypted JSON.
   */
  handleOpened(opened: OpenedEnvelope): boolean {
    let wire: RoomWire
    try {
      wire = JSON.parse(opened.body) as RoomWire
    } catch {
      return false
    }
    if (!wire || typeof (wire as { t?: unknown }).t !== 'string') return false
    const me = this.deps.identity.orbitId

    if (wire.t === 'room_invite') {
      const room = wire.room
      const existing = this.rooms().find((r) => r.id === room.id)
      if (existing) {
        if (room.epoch >= existing.epoch) {
          this.saveRooms(this.rooms().map((r) => (r.id === room.id ? { ...room, members: [...new Set([...room.members, me])] } : r)))
        }
      } else {
        this.saveRooms([...this.rooms(), { ...room, members: [...new Set([...room.members, me])] }])
      }
      return true
    }

    if (wire.t === 'room_leave') {
      const room = this.rooms().find((r) => r.id === wire.roomId)
      if (!room || room.ownerId !== me) return true // only the owner re-wraps
      const survivors = room.members.filter((m) => m !== opened.senderOrbitId)
      const next: Room = { ...room, dekHex: toHex(generateDek()), epoch: room.epoch + 1, members: survivors }
      this.saveRooms(this.rooms().map((r) => (r.id === room.id ? next : r)))
      for (const m of survivors) {
        if (m === me) continue
        void this.reinvite(next, m)
      }
      return true
    }

    if (wire.t === 'room_msg_wire') {
      const room = this.rooms().find((r) => r.id === wire.env.to)
      if (!room) return true // group envelope for a room we don't hold — consume, ignore
      try {
        const inner = openGroup(wire.env, fromHex(room.dekHex))
        const body = JSON.parse(inner.body) as RoomMsgBody
        const msg: RoomMessage = {
          id: body.id,
          roomId: room.id,
          senderOrbitId: inner.senderOrbitId,
          // Older clients sealed no name; leaving it undefined lets the renderer
          // fall back to its roster instead of showing an empty author.
          ...(body.n ? { displayName: body.n } : {}),
          text: body.text,
          ts: body.ts,
        }
        if (this.appendMessage(msg)) this.deps.onIncoming?.(msg, room)
      } catch {
        // Stale DEK (epoch we haven't re-wrapped): ignore; a re-invite fixes it.
      }
      return true
    }

    return false
  }

  private async reinvite(room: Room, peerId: string): Promise<void> {
    const keys = this.deps.peers.peerKeys(peerId)
    if (!keys?.publicKeyHex || !keys.encryptionPubHex) return
    const wire: RoomWire = { t: 'room_invite', room }
    await this.deps.mail.send(JSON.stringify(wire), 'invite', {
      publicKeyHex: keys.publicKeyHex,
      encryptionPubHex: keys.encryptionPubHex,
    }).catch(() => { /* re-wrapped again next leave */ })
  }

  private senderKeys() {
    const id = this.deps.identity
    return {
      privateKeyHex: id.privateKeyHex,
      publicKeyHex: id.publicKeyHex,
      encryptionPrivHex: id.encryptionPrivHex,
      encryptionPubHex: id.encryptionPubHex,
    }
  }
}
