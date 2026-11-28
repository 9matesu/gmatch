// The swarm wire contract.
//
// One module, both ends:
//   - the client BUILDS these frames (apps/desktop/src/utils/p2pSwarm.ts) and
//     NARROWS what arrives (apps/desktop/src/hooks/useP2P.ts);
//   - the node decides WHICH of them it carries
//     (apps/api/src/ws-bus.ts).
//
// Before this module the node re-implemented the allowlist by hand and the
// client cast whatever arrived to `SwarmMessage`, so the two ends could
// disagree about what a frame is: the relay carried a shape the client then
// dropped, and the client accepted a shape the relay had never allowed.
//
// Everything here NARROWS, never coerces: a field of the wrong type is
// DROPPED, and a frame that does not fit its declared shape is refused.

import type { User } from '@orbit/shared'
import type { Envelope } from './envelope'
import { isRecord } from './record'

// ─── The bounds (one rule, both ends) ───

/** Legacy (v0) chunk payload: the raw bytes before base64. */
export const SWARM_CHUNK_SIZE = 5 * 1024
/**
 * swarm-v1 chunk payload: the PLAINTEXT bytes before the AEAD tag and the
 * nonce. Smaller than the legacy size so the base64 envelope stays inside
 * the relay's frame-splitting threshold.
 */
export const SWARM_CHUNK_PAYLOAD = 4 * 1024
/** The largest object one transfer may carry. */
export const SWARM_MAX_OBJECT_BYTES = 64 * 1024 * 1024
/**
 * The largest number of chunks one object may be split into.
 *
 * Counted against the SMALLEST payload (swarm-v1's 4 KiB), so an object at
 * the size limit fits in both encodings: the legacy 5 KiB chunk needs fewer
 * chunks, the sealed one needs more.
 */
export const SWARM_MAX_CHUNKS = Math.ceil(SWARM_MAX_OBJECT_BYTES / SWARM_CHUNK_PAYLOAD)
/** The largest JSON frame the swarm produces. */
export const SWARM_MAX_FRAME_BYTES = 8 * 1024
/** The largest base64 payload one chunk frame may carry. */
export const SWARM_MAX_CHUNK_BASE64 = Math.floor((SWARM_MAX_FRAME_BYTES - 512) / 4) * 4

// ─── The byte-protocol frames ───

/**
 * The frames the swarm's byte protocol speaks.
 *
 * These are the shapes that travel peer-to-peer: a WANT asks for an object, a
 * KEY carries the sealed per-transfer key, a CHUNK carries (sealed) bytes,
 * a HAVE advertises what a peer holds, and the rest carry signed evidence
 * (replication receipts) or signed social operations.
 */
export type SwarmMessage =
  | { type: 'SWARM_HAVE'; ids: string[]; from?: string }
  | { type: 'SWARM_WANT'; id: string; transferId?: string; offerPub?: string; from?: string }
  | { type: 'SWARM_KEY'; id: string; transferId: string; wrapped: string; from?: string }
  | {
      type: 'SWARM_CHUNK'
      id: string
      index: number
      total: number
      mimeType: string
      /** Legacy plaintext payload (v0). Only accepted when legacy ingest is enabled. */
      dataBase64: string
      /** 'swarm-v1': the wire payload is DEK-encrypted, see swarm-chunk.ts. */
      enc?: 'swarm-v1'
      transferId?: string
      nonce?: string
      from?: string
    }
  | { type: 'SWARM_CHALLENGE'; id: string; challenge: string }
  | { type: 'SWARM_RECEIPT'; id: string; receipt: unknown }
  /** A signed social operation travelling between peers. */
  | { type: 'SWARM_OP'; operation: unknown }
  /** Peer reports it durably appended that operation. */
  | { type: 'SWARM_OP_ACK'; operationId: string; actorId: string }
  /**
   * A SEALED 1:1 envelope (Envelope v2) riding the mesh.
   *
   * A direct message is the SAME sealed envelope the courier mailbox carries
   * (utils/mail-dm.ts decodeBody / Envelope v2) — the mesh only moves the
   * ciphertext it cannot open, exactly like the node relay. This lets two
   * NAT'd peers with NO reachable mailbox still chat over a direct
   * DataChannel (or the node's SWARM_FRAME relay when direct ICE fails).
   */
  | { type: 'SWARM_DM'; envelope: Envelope }

// ─── The announcement frames ───

/**
 * The announcement envelopes: an object's metadata and its provider link,
 * never bytes. They ride the same relay envelope as the byte protocol, so
 * the node's allowlist has to know them too.
 */
export type SwarmAnnounceType =
  | 'IMAGE_ANNOUNCE'
  | 'MESSAGE'
  | 'STORY_ANNOUNCE'
  | 'CHAT'
  | 'PRESENCE'

/** Every announcement type, in one place. */
export const SWARM_ANNOUNCE_TYPES: readonly SwarmAnnounceType[] = [
  'IMAGE_ANNOUNCE',
  'MESSAGE',
  'STORY_ANNOUNCE',
  'CHAT',
  'PRESENCE',
]

/** Narrow a value to an announcement type. */
export function isSwarmAnnounceType(value: unknown): value is SwarmAnnounceType {
  return typeof value === 'string' && (SWARM_ANNOUNCE_TYPES as readonly string[]).includes(value)
}

/**
 * The chat line an announcement carries.
 *
 * The swarm's chat wire shape — the six fields a peer announces. The app's
 * own chat model is richer (receipts, edits, reactions); those live in the
 * sealed courier lanes, not in a peer announcement.
 */
export interface SwarmChatLine {
  id: string
  senderId: string
  senderName: string
  text: string
  timestamp: number
  channel?: string
}

/**
 * The object an announcement describes: metadata and a provider link, never
 * bytes.
 *
 * The announcing peer describes the row it forged; the receiver stores the
 * description and fetches the bytes over the swarm. Every field here is
 * self-reported by that peer.
 */
export interface SwarmAnnouncedObject {
  id: string
  owner_id: string
  size_bytes: number
  mime_type: string
  created_at: string
  sender_pubkey?: string
  sender_enc_pubkey?: string
  caption?: string
  post_caption?: string
  /** The provider link (never the bytes). */
  content_url?: string
  display_name?: string
  tags?: string[] | string | null
  author_name?: string
  sender_name?: string
  location?: string
  comments?: unknown[] | null
  likes_count?: number
  like_count?: number
  comment_count?: number
  is_public?: number
  is_story?: number
  is_chat?: number
  is_avatar?: number
}

/**
 * The announcement envelope: an object's metadata and its provider link,
 * never bytes.
 */
export interface SwarmAnnounce {
  type: SwarmAnnounceType
  /** The announcing peer, as it describes itself. */
  user: User
  /** The announced object (an IMAGE_ANNOUNCE / MESSAGE). */
  payload?: SwarmAnnouncedObject
  /** The announced chat line (a CHAT). */
  chatMessage?: SwarmChatLine
  channel?: string
  timestamp: number
  /** The sender the relay PROVED (a relay socket stamps it). */
  relayedBy?: string
}

// ─── The relay allowlist ───

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

const ENVELOPE_KINDS: readonly string[] = ['mail', 'signal', 'announce', 'invite', 'report', 'api_req']

/** Narrow one sealed Envelope v2 (the DM mesh payload). A field of the wrong
 *  type is dropped, never coerced; a malformed envelope is refused. */
export function parseEnvelope(raw: unknown): Envelope | null {
  if (!isRecord(raw)) return null
  if (raw.v !== 2) return null
  if (typeof raw.kind !== 'string' || !ENVELOPE_KINDS.includes(raw.kind)) return null
  if (!bounded(raw.to, 256) || !bounded(raw.id, 128) || !bounded(raw.sealed, 32 * 1024)) return null
  const env: Envelope = {
    v: 2,
    kind: raw.kind as Envelope['kind'],
    to: raw.to,
    id: raw.id,
    sealed: raw.sealed,
  }
  if (bounded(raw.fromEph, 128)) env.fromEph = raw.fromEph
  if (typeof raw.exp === 'number' && Number.isFinite(raw.exp)) env.exp = raw.exp
  return env
}

/**
 * May the node carry this frame?
 *
 * This is the ONE allowlist. The relay moves peer traffic and refuses to
 * invent server events (audit A2): a frame that looks like a server event
 * (`feed`, `user_banned`, ...) must never shadow one, and an unbounded frame
 * is an amplification vector — one sender, N copies.
 *
 * The relay never opens a payload: a KEY body is sealed to the fetcher's
 * ephemeral offer key, a receipt is a signature, an operation carries its
 * own author signature. The RECEIVER's authorizer decides; the relay only
 * moves bytes.
 */
export function isRelayableSwarmFrame(inner: unknown): boolean {
  if (!isRecord(inner)) return false
  const type = inner.type

  if (isSwarmAnnounceType(type)) return true

  switch (type) {
    case 'SWARM_WANT':
      return bounded(inner.id, 256)
    case 'SWARM_HELLO':
      // A signed HELLO: the transcript covers both DTLS fingerprints + nonces.
      return (
        typeof inner.v === 'number' &&
        bounded(inner.orbitId, 64) &&
        bounded(inner.pubKeyHex, 128) &&
        bounded(inner.sig, 256) &&
        bounded(inner.fp, 128) &&
        bounded(inner.nonce, 64)
      )
    case 'SWARM_PEX':
      // Verified peers only; the client caps the list.
      return Array.isArray(inner.peers) && inner.peers.length <= 32
    case 'SWARM_HAVE_SUMMARY':
      // Availability summary: how many objects, not which ones.
      return typeof inner.count === 'number' && inner.count >= 0 && inner.count <= 1_000_000
    case 'SWARM_HAVE':
      return Array.isArray(inner.ids) && inner.ids.every((id) => bounded(id, 256))
    case 'SWARM_CHUNK':
      return (
        bounded(inner.id, 256) &&
        typeof inner.index === 'number' &&
        Number.isSafeInteger(inner.index) &&
        inner.index >= 0 &&
        typeof inner.total === 'number' &&
        Number.isSafeInteger(inner.total) &&
        inner.total >= 1 &&
        inner.total <= SWARM_MAX_CHUNKS &&
        inner.index < inner.total &&
        typeof inner.mimeType === 'string' &&
        inner.mimeType.length <= 128 &&
        typeof inner.dataBase64 === 'string' &&
        inner.dataBase64.length <= SWARM_MAX_CHUNK_BASE64
      )
    case 'SWARM_KEY':
      // swarm-v1 transfer key: the per-transfer DEK, sealed to the FETCHER's
      // ephemeral offer key. The relay cannot open it (it holds no private
      // key), so forwarding it leaks nothing — but WITHOUT this frame the
      // relay path could never decrypt a chunk, which silently broke the
      // "guaranteed fallback" for every peer that cannot punch a direct
      // WebRTC hole.
      return bounded(inner.id, 256) && bounded(inner.transferId, 128) && bounded(inner.wrapped, 1024)
    case 'SWARM_CHALLENGE':
      // Durable-replication evidence: the seeder's challenge.
      return bounded(inner.id, 256) && bounded(inner.challenge, 1024)
    case 'SWARM_RECEIPT':
      // The fetcher's signed receipt (challenge-bound, read-back verified).
      return bounded(inner.id, 256) && !!inner.receipt && typeof inner.receipt === 'object'
    case 'SWARM_OP':
      // A signed social operation; the receiver's authorizer decides.
      return !!inner.operation && typeof inner.operation === 'object'
    case 'SWARM_OP_ACK':
      return bounded(inner.operationId, 256) && bounded(inner.actorId, 256)
    case 'SWARM_DM':
      // A sealed envelope: the relay moves ciphertext it cannot open (the
      // recipient's private key is the only thing that opens it), exactly like
      // the mailbox path. Without this the guaranteed relay fallback could
      // never carry a DM between two peers that cannot punch a direct hole.
      return parseEnvelope(inner.envelope) !== null
    default:
      return false
  }
}

// ─── Narrowing ───

/**
 * The user fields an announcement may carry.
 *
 * The announcing peer describes ITSELF, so every field here is
 * self-reported. The whitelist is deliberately short: the relay never reads
 * an announcement, and the client only needs the fields the roster shows.
 */
function parseAnnounceUser(raw: unknown): User | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null
  const user: User = {
    id,
    publicKey: typeof raw.publicKey === 'string' ? raw.publicKey : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  }
  if (typeof raw.encryptionPubKey === 'string') user.encryptionPubKey = raw.encryptionPubKey
  if (typeof raw.display_name === 'string') user.display_name = raw.display_name
  if (typeof raw.pfp_url === 'string') user.pfp_url = raw.pfp_url
  if (typeof raw.last_seen === 'string') user.last_seen = raw.last_seen
  if (Array.isArray(raw.tags)) user.tags = raw.tags.filter((t): t is string => typeof t === 'string')
  if (typeof raw.online === 'boolean') user.online = raw.online
  if (typeof raw.score === 'number' && Number.isFinite(raw.score)) user.score = raw.score
  return user
}

/** Narrow the announced object. */
function parseAnnounceObject(raw: unknown): SwarmAnnouncedObject | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null
  const object: SwarmAnnouncedObject = {
    id,
    owner_id: typeof raw.owner_id === 'string' ? raw.owner_id : '',
    size_bytes: typeof raw.size_bytes === 'number' && Number.isFinite(raw.size_bytes) ? raw.size_bytes : 0,
    mime_type: typeof raw.mime_type === 'string' ? raw.mime_type : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
  }
  for (const field of ['sender_pubkey', 'sender_enc_pubkey', 'caption', 'post_caption', 'content_url', 'display_name', 'author_name', 'sender_name', 'location'] as const) {
    const value = raw[field]
    if (typeof value === 'string') object[field] = value
  }
  for (const field of ['is_story', 'is_public', 'is_chat', 'is_avatar', 'likes_count', 'like_count', 'comment_count'] as const) {
    const value = raw[field]
    if (typeof value === 'number' && Number.isFinite(value)) object[field] = value
  }
  if (Array.isArray(raw.tags)) object.tags = raw.tags.filter((t): t is string => typeof t === 'string')
  else if (typeof raw.tags === 'string') object.tags = raw.tags
  if (Array.isArray(raw.comments)) object.comments = raw.comments
  return object
}

/** Narrow the announced chat line. */
function parseAnnounceChat(raw: unknown): SwarmChatLine | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const text = typeof raw.text === 'string' ? raw.text : ''
  if (!id || !text) return null
  const line: SwarmChatLine = {
    id,
    senderId: typeof raw.senderId === 'string' ? raw.senderId : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName : '',
    text,
    timestamp: typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
  }
  if (typeof raw.channel === 'string') line.channel = raw.channel
  return line
}

/**
 * Narrow one announcement.
 *
 * The relay moves an announcement without reading it; only the client knows
 * what it carries, and a peer can send anything. The fields the handler
 * reads are checked here: an announcement without a user id, or a chat line
 * without text, is dropped instead of crashing the handler.
 *
 * When the frame came through the relay, the relay PROVED the sender
 * (`relayedBy`). A self-described user id that disagrees with the proven
 * sender is an impersonation attempt and is dropped — the same rule the
 * object path already applies (`resolveClaimedOwner`).
 */
export function parseSwarmAnnounce(
  type: SwarmAnnounceType,
  payload: Record<string, unknown>,
  relayedBy?: string,
): SwarmAnnounce | null {
  const user = parseAnnounceUser(payload.user)
  if (!user) return null
  if (relayedBy && relayedBy !== user.id) return null

  const announce: SwarmAnnounce = {
    type,
    user,
    timestamp: typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) ? payload.timestamp : 0,
  }
  if (relayedBy) announce.relayedBy = relayedBy
  if (typeof payload.channel === 'string') announce.channel = payload.channel

  if (payload.payload !== undefined && payload.payload !== null) {
    const object = parseAnnounceObject(payload.payload)
    if (!object) return null
    announce.payload = object
  }
  if (payload.chatMessage !== undefined && payload.chatMessage !== null) {
    const line = parseAnnounceChat(payload.chatMessage)
    if (!line) return null
    announce.chatMessage = line
  }
  return announce
}

/**
 * Narrow one byte-protocol frame.
 *
 * Returns null for anything that is not a frame the swarm speaks. A field of
 * the wrong type is DROPPED, never coerced.
 */
export function parseSwarmFrame(inner: unknown): SwarmMessage | null {
  if (!isRecord(inner)) return null
  const type = inner.type
  switch (type) {
    case 'SWARM_HAVE': {
      if (!Array.isArray(inner.ids)) return null
      const ids = inner.ids.filter((id): id is string => typeof id === 'string')
      if (ids.length !== inner.ids.length) return null
      const frame: SwarmMessage = { type, ids }
      if (typeof inner.from === 'string') frame.from = inner.from
      return frame
    }
    case 'SWARM_WANT': {
      if (typeof inner.id !== 'string' || !inner.id) return null
      const frame: SwarmMessage = { type, id: inner.id }
      if (typeof inner.transferId === 'string') frame.transferId = inner.transferId
      if (typeof inner.offerPub === 'string') frame.offerPub = inner.offerPub
      if (typeof inner.from === 'string') frame.from = inner.from
      return frame
    }
    case 'SWARM_KEY': {
      if (typeof inner.id !== 'string' || typeof inner.transferId !== 'string' || typeof inner.wrapped !== 'string') return null
      const frame: SwarmMessage = { type, id: inner.id, transferId: inner.transferId, wrapped: inner.wrapped }
      if (typeof inner.from === 'string') frame.from = inner.from
      return frame
    }
    case 'SWARM_CHUNK': {
      if (typeof inner.id !== 'string') return null
      if (typeof inner.index !== 'number' || !Number.isSafeInteger(inner.index)) return null
      if (typeof inner.total !== 'number' || !Number.isSafeInteger(inner.total)) return null
      if (typeof inner.mimeType !== 'string') return null
      if (typeof inner.dataBase64 !== 'string') return null
      const frame: SwarmMessage = {
        type,
        id: inner.id,
        index: inner.index,
        total: inner.total,
        mimeType: inner.mimeType,
        dataBase64: inner.dataBase64,
      }
      if (inner.enc === 'swarm-v1') frame.enc = 'swarm-v1'
      if (typeof inner.transferId === 'string') frame.transferId = inner.transferId
      if (typeof inner.nonce === 'string') frame.nonce = inner.nonce
      if (typeof inner.from === 'string') frame.from = inner.from
      return frame
    }
    case 'SWARM_CHALLENGE': {
      if (typeof inner.id !== 'string' || typeof inner.challenge !== 'string') return null
      return { type, id: inner.id, challenge: inner.challenge }
    }
    case 'SWARM_RECEIPT': {
      if (typeof inner.id !== 'string') return null
      return { type, id: inner.id, receipt: inner.receipt }
    }
    case 'SWARM_OP':
      return { type, operation: inner.operation }
    case 'SWARM_OP_ACK': {
      if (typeof inner.operationId !== 'string' || typeof inner.actorId !== 'string') return null
      return { type, operationId: inner.operationId, actorId: inner.actorId }
    }
    case 'SWARM_DM': {
      const envelope = parseEnvelope(inner.envelope)
      if (!envelope) return null
      return { type, envelope }
    }
    default:
      return null
  }
}

/** The relay envelope every client-to-client frame rides in. */
export type SwarmEnvelope =
  | { kind: 'swarm'; frame: SwarmMessage; relayedBy?: string }
  | { kind: 'announce'; announce: SwarmAnnounce }

/**
 * Narrow one inbound relay envelope.
 *
 * The relay wraps every client-to-client frame in `SWARM_FRAME` (a bare
 * `type` key could shadow a server-published event, audit A2), so both the
 * byte protocol and the announcements arrive wrapped.
 */
export function parseSwarmEnvelope(raw: unknown): SwarmEnvelope | null {
  if (!isRecord(raw)) return null
  if (raw.type !== 'SWARM_FRAME') return null
  const inner = raw.swarm
  if (!isRecord(inner)) return null
  const relayedBy = typeof raw.relayedBy === 'string' && raw.relayedBy ? raw.relayedBy : undefined

  const frame = parseSwarmFrame(inner)
  if (frame) return relayedBy ? { kind: 'swarm', frame, relayedBy } : { kind: 'swarm', frame }

  if (isSwarmAnnounceType(inner.type)) {
    const announce = parseSwarmAnnounce(inner.type, inner, relayedBy)
    return announce ? { kind: 'announce', announce } : null
  }
  return null
}

/**
 * Narrow one BARE announcement.
 *
 * The direct mesh path and the local-tab channel carry announcements
 * unwrapped — the relay's audit-A2 rule is about the relay, and those pipes
 * have no server event to shadow.
 */
export function parseBareSwarmAnnounce(raw: unknown): SwarmAnnounce | null {
  if (!isRecord(raw)) return null
  if (!isSwarmAnnounceType(raw.type)) return null
  return parseSwarmAnnounce(raw.type, raw, undefined)
}
