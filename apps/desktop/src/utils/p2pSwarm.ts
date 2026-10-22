/**
 * P2P Swarm Engine over WebRTC DataChannel (Zero-Fly Media)
 *
 * Peers in a lobby, arena duel, or chat exchange object chunks directly
 * without routing heavy media blobs through the central server.
 */

import {
  createReplicationReceipt,
  validateReplicationReceipt,
  createSwarmDek,
  createSwarmOffer,
  decryptSwarmChunk,
  encryptSwarmChunk,
  openSwarmKey,
  sealSwarmKey,
  type ReplicationReceipt,
} from '@orbit/protocol'

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
      /** 'swarm-v1': the wire payload is DEK-encrypted, see swarmTransfer below. */
      enc?: 'swarm-v1'
      transferId?: string
      nonce?: string
      from?: string
    }
  | { type: 'SWARM_CHALLENGE'; id: string; challenge: string }
  | { type: 'SWARM_RECEIPT'; id: string; receipt: unknown }
  /** A signed social operation travelling between peers (L4 transport). */
  | { type: 'SWARM_OP'; operation: unknown }
  /** Peer reports it durably appended that operation (L4.3). */
  | { type: 'SWARM_OP_ACK'; operationId: string; actorId: string }

/**
 * RAM cache of swarm bytes.
 *
 * This used to be an unbounded `Map<string, Blob>`: every object the app ever
 * saw (feed, stories, avatars, gallery, own uploads) stayed in the JS heap for
 * the life of the process. After a few minutes of scrolling that is hundreds of
 * megabytes of decoded media, which is exactly the "app eats RAM" symptom.
 *
 * Durable bytes live in the vault (disk) / IndexedDB, so an eviction here only
 * costs one re-read — never data. Bounded by entries AND bytes, oldest first.
 */
const RAM_LIMIT_ENTRIES = 64
const RAM_LIMIT_BYTES = 96 * 1024 * 1024
const localObjects = new Map<string, Blob>()
let localObjectBytes = 0

/** Insert/replace, keeping recency order and evicting oldest over budget. */
function rememberLocalObject(id: string, blob: Blob): void {
  const prev = localObjects.get(id)
  if (prev) {
    localObjectBytes -= prev.size
    localObjects.delete(id)
  }
  localObjects.set(id, blob)
  localObjectBytes += blob.size
  while (
    (localObjects.size > RAM_LIMIT_ENTRIES || localObjectBytes > RAM_LIMIT_BYTES) &&
    localObjects.size > 1
  ) {
    const oldest = localObjects.keys().next().value as string | undefined
    if (oldest === undefined || oldest === id) break
    const victim = localObjects.get(oldest)
    localObjects.delete(oldest)
    if (victim) localObjectBytes -= victim.size
  }
}

/** Read + mark as recently used. Never returns a half-evicted entry. */
function lookupLocalObject(id: string): Blob | null {
  const blob = localObjects.get(id)
  if (!blob) return null
  localObjects.delete(id)
  localObjects.set(id, blob)
  return blob
}

function forgetLocalObject(id: string): void {
  const blob = localObjects.get(id)
  if (!blob) return
  localObjects.delete(id)
  localObjectBytes -= blob.size
}

/** Test seam: cache contents (bytes, entries, keys in recency order). */
export function __localObjectCacheForTests(): { bytes: number; keys: string[] } {
  return { bytes: localObjectBytes, keys: [...localObjects.keys()] }
}

/** Test seam: drop the RAM cache without touching durability. */
export function __resetLocalObjectCacheForTests(): void {
  localObjects.clear()
  localObjectBytes = 0
}

const CHUNK_SIZE = 5 * 1024 // Keep base64 JSON chunk frames below relay splitting.
const MAX_OBJECT_BYTES = 64 * 1024 * 1024
const MAX_CHUNKS = Math.ceil(MAX_OBJECT_BYTES / CHUNK_SIZE)
// Keep the JSON envelope under the relay's 30 KB frame-splitting threshold.
const MAX_SWARM_FRAME_BYTES = 8 * 1024
const MAX_CHUNK_BASE64_LENGTH = Math.floor((MAX_SWARM_FRAME_BYTES - 512) / 4) * 4
/**
 * Plaintext bytes per encrypted wire chunk (swarm-v1). The AEAD adds a 16-byte
 * tag and a 24-byte nonce field to the frame; 4 KiB keeps the base64 envelope
 * inside the relay split threshold (4096 -> 4112 bytes -> 5484 base64 chars).
 */
const SWARM_CHUNK_PAYLOAD = 4 * 1024

/**
 * Base64 for chunk frames.
 *
 * The obvious loop that appends one character at a time dominated the CPU
 * cost of a transfer (4 MiB = 4M string appends). Building the binary string
 * in 32 KiB blocks with `String.fromCharCode.apply` produces the same result
 * an order of magnitude cheaper.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const BLOCK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BLOCK) {
    const end = Math.min(offset + BLOCK, bytes.length)
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(offset, end)))
  }
  return btoa(binary)
}

/** SHA-256 hex of a blob's bytes (Web Crypto). Used to VERIFY reassembled
 *  swarm media against the object's content_hash before accepting it —
 *  a peer's chunk stream is not proof the bytes are the real object. */
export async function sha256HexBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isSha256Hex(value: string): boolean {
  return /^[a-f\d]{64}$/i.test(value)
}

function isBoundedChunkFrame(message: SwarmMessage): boolean {
  return message.type !== 'SWARM_CHUNK' || new TextEncoder().encode(JSON.stringify(message)).byteLength <= MAX_SWARM_FRAME_BYTES
}

/** Broadcast by useP2P whenever a peer transitions to online (swarm or
 *  roster). Failed P2P tiles listen for it to retry an offline seeder. */
export const PEER_ONLINE_EVENT = 'orbit-peer-online'

/** Emit PEER_ONLINE_EVENT (no-op outside a browser window). */
export function announcePeerOnline(peerId: string): void {
  try {
    if (typeof window !== 'undefined' && peerId) {
      window.dispatchEvent(new CustomEvent(PEER_ONLINE_EVENT, { detail: { peerId } }))
    }
  } catch {
    /* event bus unavailable (tests/SSR) */
  }
}

export interface LocalObjectMeta {
  ownerId?: string
  isPublic?: boolean
  isStory?: boolean
  isChat?: boolean
  isAvatar?: boolean
}

async function persistToVault(id: string, blob: Blob, meta: LocalObjectMeta = {}): Promise<boolean> {
  // A swarm fetch is not complete until bytes reach a durable store.
  let buf: ArrayBuffer | null = null
  try {
    buf = await blob.arrayBuffer()
  } catch {
    /* arrayBuffer unavailable */
  }
  if (!buf || buf.byteLength === 0) return false
  // Renderer side: ArrayBuffer crosses IPC cleanly; the main process
  // re-verifies the sha256 before filing it under `id`.
  if (typeof window !== 'undefined' && window.gmatch?.vaultPutBytes) {
    try {
      const result = await window.gmatch.vaultPutBytes(id, blob.type || 'application/octet-stream', buf)
      if (result?.ok) return true
      return false
    } catch {
      return false
    }
  }
  // Browser dev / no bridge: IndexedDB survives reload but is not the app disk.
  try {
    const { saveObject } = await import('./storage')
    await saveObject({
      id,
      name: id,
      mime_type: blob.type || 'application/octet-stream',
      size_bytes: buf.byteLength,
      owner_id: meta.ownerId || '',
      sender_pubkey: '',
      sender_enc_pubkey: '',
      created_at: new Date().toISOString(),
      data: buf,
      is_public: typeof meta.isPublic === 'boolean' ? (meta.isPublic ? 1 : 0) : null,
      is_story: typeof meta.isStory === 'boolean' ? (meta.isStory ? 1 : 0) : null,
      is_chat: typeof meta.isChat === 'boolean' ? (meta.isChat ? 1 : 0) : null,
      is_avatar: typeof meta.isAvatar === 'boolean' ? (meta.isAvatar ? 1 : 0) : null,
    })
    return true
  } catch {
    return false
  }
}

/** Read verified bytes from the vault (disk) by content hash, else null. */
async function readVaultBlob(id: string): Promise<Blob | null> {
  if (typeof window === 'undefined' || !window.gmatch?.vaultGet) return null
  try {
    const res = await window.gmatch.vaultGet(id)
    if (!res?.local) return null
    const resp = await fetch(res.local)
    if (!resp.ok) return null
    return await resp.blob()
  } catch {
    return null
  }
}

/** Preload persisted swarm bytes into RAM so a restarted seeder can answer
 *  WANTs without first re-viewing each image. Best-effort, capped at the RAM
 *  cache budget: durability lives on disk, so a cache miss only costs a read. */
export async function hydrateLocalObjects(maxBytes = RAM_LIMIT_BYTES): Promise<number> {
  // Vault (disk, content-addressed) is the authoritative durable store; a
  // restarted seeder re-hydrates its own bytes from there. IndexedDB is the
  // dev fallback when no Electron bridge exists.
  if (typeof window !== 'undefined' && window.gmatch?.vaultList) {
    try {
      const objects = await window.gmatch.vaultList()
      let used = 0
      let count = 0
      for (const o of objects) {
        if (used + o.bytes > maxBytes) break
        if (!localObjects.has(o.ref)) {
          const blob = await readVaultBlob(o.ref)
          if (blob) {
            localObjects.set(o.ref, blob)
            used += o.bytes
            count += 1
          }
        }
      }
      return count
    } catch {
      /* fall through to IndexedDB fallback below */
    }
  }
  try {
    const { getObjectsForSwarm } = await import('./storage')
    const all = await getObjectsForSwarm(maxBytes)
    let used = 0
    let count = 0
    for (const o of all) {
      const data = o?.data as ArrayBuffer | undefined
      if (!o?.id || !data || !(data instanceof ArrayBuffer) || data.byteLength === 0) continue
      if (used + data.byteLength > maxBytes) continue
      if (!localObjects.has(o.id)) {
        localObjects.set(o.id, new Blob([data], { type: o.mime_type || 'application/octet-stream' }))
        used += data.byteLength
        count += 1
      }
    }
    return count
  } catch {
    return 0
  }
}

export function registerLocalObject(id: string, blob: Blob, meta: LocalObjectMeta = {}): void {
  if (!id || id.length > 256 || !blob || blob.size === 0 || blob.size > MAX_OBJECT_BYTES) return
  rememberLocalObject(id, blob)
  // We hold it now, so it stops being "wanted".
  wantedObjects.delete(id)
  // Durable bytes go to the encrypted vault first (disk). IndexedDB is the
  // dev fallback. Fire-and-forget so hot paths (swarm assembly, forge) are
  // not blocked; the RAM copy is available immediately.
  void persistToVault(id, blob, meta)
}

/** Register and confirm persistence before reporting an object as received. */
export async function persistLocalObject(id: string, blob: Blob, meta: LocalObjectMeta = {}): Promise<void> {
  if (!id || !blob || blob.size < 1 || blob.size > MAX_OBJECT_BYTES) throw new Error('Invalid local object')
  const previous = localObjects.get(id)
  rememberLocalObject(id, blob)
  wantedObjects.delete(id)
  if (!await persistToVault(id, blob, meta)) {
    if (previous) rememberLocalObject(id, previous)
    else {
      const current = localObjects.get(id)
      if (current) localObjectBytes -= current.size
      localObjects.delete(id)
    }
    throw new Error(`Swarm object ${id} could not be persisted`)
  }
}

export function hasLocalObject(id: string): boolean {
  return !!id && localObjects.has(id)
}

/**
 * Durable-only read (vault then IndexedDB): NEVER the RAM cache. Used by
 * getLocalObject for a durable rehydrate and by the replication-receipt path
 * to prove bytes are really on disk before this node claims durable custody.
 */
async function readDurableObject(id: string): Promise<Blob | null> {
  // Vault (disk, content-addressed): id is the content hash. readVaultBlob
  // verifies the file exists and decrypts it; fetch rehydrates the blob.
  const fromVault = await readVaultBlob(id)
  if (fromVault) return fromVault

  // Fallback: IndexedDB (survives reload; dev-only path)
  try {
    const { getObject } = await import('./storage')
    const stored = await getObject(id)
    const data = stored?.data as ArrayBuffer | undefined
    if (stored && data && data.byteLength > 0) {
      return new Blob([data], { type: stored.mime_type || 'application/octet-stream' })
    }
  } catch {
    /* storage unavailable */
  }

  return null
}

export async function getLocalObject(id: string): Promise<Blob | null> {
  if (!id) return null
  const inRam = lookupLocalObject(id)
  if (inRam) return inRam
  const durable = await readDurableObject(id)
  if (durable) rememberLocalObject(id, durable)
  return durable
}

// ---- Swarm transport: module-level WANT/CHUNK request/response ------------
// The P2P hook (useP2P) wires every available pipe (BroadcastChannel, WS
// relay, PeerJS direct) into one send fan-out; serving peers answer WANTs
// from their local store. This keeps bytes moving peer-to-peer with zero
// server storage.

type SwarmSend = (msg: SwarmMessage) => void
let swarmSend: SwarmSend | null = null

export function setSwarmTransport(send: SwarmSend | null): void {
  swarmSend = send
}

// ---- swarm-v1: end-to-end encrypted chunk transfers (roadmap P0) ---------
// The swarm's fallback transport is the NODE's WebSocket relay, and the relay
// is not trusted: it sees every byte it forwards. The wire therefore carries
// chunks encrypted with a per-transfer DEK sealed to the requester's
// EPHEMERAL key (packages/protocol swarm-chunk.ts):
//   fetcher  → SWARM_WANT { id, transferId, offerPub, from }
//   seeder   → SWARM_KEY  { id, transferId, wrapped: sealed DEK }
//   seeder   → SWARM_CHUNK { ..., enc:'swarm-v1', nonce, dataBase64 = CT }
// The relay (and every other peer on the node) forwards ciphertexts and a
// wrapped key it cannot open; only the requester's ephemeral private key
// decrypts. The AEAD binds every chunk to object id, transfer id, position
// and both sides, so a chunk cannot be moved between transfers or objects and
// a modified ciphertext is rejected instead of silently accepted.
//
// Legacy v0 plaintext frames are a explicit opt-in (` Legacy plaintext
// serving`): with the flag off (the default) the wire NEVER carries or
// accepts unencrypted media, and a legacy peer's frames are dropped.

interface SwarmKeyCandidate {
  dek: Uint8Array
  senderOrbitId: string
}

interface TransferOffer {
  transferId: string
  offerPrivHex: string
  offerPubHex: string
  keys: SwarmKeyCandidate[]
  badFrames: number
  createdAt: number
}

const MAX_TRANSFER_KEYS = 4
const MAX_KEY_WRAPPED_LENGTH = 512

let legacyPlaintextServing = false

/** Explicit opt-in for the legacy plaintext wire (v0 peers). Off by default. */
export function setSwarmLegacyPlaintextEnabled(enabled: boolean): void {
  legacyPlaintextServing = enabled
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Build a fresh transfer offer (or null before an offer was possible). */
function newTransferOffer(): TransferOffer {
  const offer = createSwarmOffer()
  return {
    transferId: randomHex(16),
    offerPrivHex: offer.privateKeyHex,
    offerPubHex: offer.publicKeyHex,
    keys: [],
    badFrames: 0,
    createdAt: Date.now(),
  }
}

/** Open a SWARM_KEY frame into a candidate candidate DEK for our offer. */
function candidateFromKeyFrame(offerPrivHex: string, wrapped: string, from: unknown): SwarmKeyCandidate | null {
  if (typeof wrapped !== 'string' || !wrapped || wrapped.length > MAX_KEY_WRAPPED_LENGTH) return null
  let decoded: Uint8Array
  try {
    decoded = decodeChunk(wrapped)
  } catch {
    return null
  }
  let dek: Uint8Array
  try {
    dek = openSwarmKey(decoded, offerPrivHex)
  } catch {
    return null // wrapped for someone else / tampered / wrong transfer: drop
  }
  return { dek, senderOrbitId: typeof from === 'string' ? from : '' }
}

function chunkContext(
  offer: TransferOffer,
  id: string,
  index: number,
  total: number,
  senderOrbitId: string,
): {
  objectId: string
  index: number
  total: number
  transferId: string
  senderOrbitId: string
  receiverOfferPub: string
} {
  return {
    objectId: id,
    index,
    total,
    transferId: offer.transferId,
    senderOrbitId,
    receiverOfferPub: offer.offerPubHex,
  }
}

type SwarmChunkFrame = Extract<SwarmMessage, { type: 'SWARM_CHUNK' }>

/** A WANT that carries a well-formed swarm-v1 transfer offer. */
function isOfferedWant(msg: SwarmMessage): boolean {
  if (msg.type !== 'SWARM_WANT') return false
  if (typeof msg.transferId !== 'string' || !/^[a-f\d]+$/i.test(msg.transferId) || msg.transferId.length < 8 || msg.transferId.length > 128) return false
  if (typeof msg.offerPub !== 'string' || !/^[a-f\d]{64}$/i.test(msg.offerPub)) return false
  return true
}

/** Shared chunk-envelope validation (both the module and the session path). */
function validateChunkEnvelope(
  msg: SwarmChunkFrame,
  reqTotal: number,
  reqMime: string,
): void {
  if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > MAX_CHUNKS ||
      !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
      typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
      typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > MAX_CHUNK_BASE64_LENGTH ||
      !isBoundedChunkFrame(msg) ||
      (reqTotal !== 0 && reqTotal !== msg.total) ||
      (reqMime !== '' && reqMime !== msg.mimeType)) {
    throw new Error('Invalid swarm chunk metadata')
  }
}

/** Seed chunks of `blob` to one requester's transfer offer (ciphertext only). */
async function serveOfferedObject(
  send: (msg: SwarmMessage) => void,
  id: string,
  blob: Blob,
  transferId: string,
  offerPubHex: string,
  senderOrbitId: string,
): Promise<void> {
  const buffer = await blob.arrayBuffer()
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_OBJECT_BYTES) return
  const dek = createSwarmDek()
  const wrapped = sealSwarmKey(dek, offerPubHex)
  send({
    type: 'SWARM_KEY',
    id,
    transferId,
    wrapped: bytesToBase64(wrapped),
    from: senderOrbitId || undefined,
  })
  const totalChunks = Math.ceil(buffer.byteLength / SWARM_CHUNK_PAYLOAD) || 1
  const mimeType = blob.type || 'application/octet-stream'
  for (let i = 0; i < totalChunks; i++) {
    const slice = new Uint8Array(buffer.slice(i * SWARM_CHUNK_PAYLOAD, Math.min((i + 1) * SWARM_CHUNK_PAYLOAD, buffer.byteLength)))
    const { ciphertext, nonce } = encryptSwarmChunk(dek, slice, {
      objectId: id,
      index: i,
      total: totalChunks,
      transferId,
      senderOrbitId,
      receiverOfferPub: offerPubHex,
    })
    const frame: SwarmMessage = {
      type: 'SWARM_CHUNK',
      id,
      index: i,
      total: totalChunks,
      mimeType,
      enc: 'swarm-v1',
      transferId,
      nonce: bytesToBase64(nonce),
      dataBase64: bytesToBase64(ciphertext),
      from: senderOrbitId || undefined,
    }
    if (!isBoundedChunkFrame(frame)) return
    send(frame)
  }
}

/**
 * Ingest one swarm-v1 chunk. Returns true when the transfer may continue.
 * A chunk that fails every candidate DEK is dropped (never silently
 * accepted); a flood of such frames fails the fetch outright, so a hostile
 * relay cannot spin the fetcher until timeout for free.
 */
function handleEncryptedChunkFrame(msg: SwarmChunkFrame, req: PendingFetch): boolean {
  const offer = req.offer
  if (!offer || msg.transferId !== offer.transferId) return true
  if (typeof msg.nonce !== 'string') return true
  let nonce: Uint8Array | null = null
  try { nonce = decodeChunk(msg.nonce) } catch { nonce = null }
  if (!nonce || nonce.length !== 24) return true
  let ciphertext: Uint8Array | null = null
  try { ciphertext = decodeChunk(msg.dataBase64) } catch { ciphertext = null }
  if (!ciphertext || !ciphertext.byteLength) return true
  let plaintext: Uint8Array | null = null
  for (const candidate of offer.keys) {
    try {
      plaintext = decryptSwarmChunk(
        candidate.dek,
        nonce,
        ciphertext,
        chunkContext(offer, msg.id, msg.index, msg.total, candidate.senderOrbitId),
      )
      break
    } catch {
      plaintext = null
    }
  }
  if (!plaintext) {
    req.offer!.badFrames += 1
    if (req.offer!.badFrames > MAX_TRANSFER_KEYS * Math.max(1, msg.total || 1) + 8) {
      failFetch(msg.id, req, new Error('Swarm transfer failed authenticated-chunk checks'))
    }
    return true
  }
  try {
    validateChunkEnvelope(msg, req.total, req.mimeType)
    // Duplicate re-delivery (relay/transport replay) is an idempotent
    // no-op, never a fetch failure: we already hold that index.
    if (req.chunks.has(msg.index)) return true
    const isLast = msg.index === msg.total - 1
    if (!plaintext.byteLength || plaintext.byteLength > SWARM_CHUNK_PAYLOAD ||
        (!isLast && plaintext.byteLength !== SWARM_CHUNK_PAYLOAD) ||
        req.receivedBytes + plaintext.byteLength > MAX_OBJECT_BYTES) {
      throw new Error('Invalid swarm chunk length')
    }
    req.chunks.set(msg.index, plaintext)
    req.receivedBytes += plaintext.byteLength
    req.total = msg.total
    req.mimeType = msg.mimeType
  } catch (error) {
    failFetch(msg.id, req, error instanceof Error ? error : new Error('Invalid swarm chunk'))
  }
  return true
}

// ---- SWARM_CHALLENGE / SWARM_RECEIPT: durable-replication evidence -------
// Protocol proposal v1 (roadmap L2). A serving peer mints a fresh challenge
// per served object; the FETCHING peer — after it verified the assembled
// bytes, persisted them, and read them back from its durable store — signs a
// replication receipt bound to that challenge. The seeder only records the
// receipt when the challenge matches its outstanding one, so replayed or
// unsolicited receipts are ignored. A HAVE message or a completed send is
// never evidence; only a valid receipt marks an object as held on another
// node (roles.getDurableReplication).
// Limitation (deliberate, v1): challenges/receipts exist only for
// content-addressed ids (the id IS the sha256), and manifest-less legacy
// objects bind manifestHash = objectCid (the content hash is the integrity
// anchor; v1-manifest objects will bind the real manifest hash).

export interface SwarmReceiptIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

const MAX_OUTSTANDING_CHALLENGES = 64
const MAX_PENDING_CHALLENGES = 64
const MAX_DURABLE_REPLICATIONS = 256
const MAX_RECENTLY_DURABLE = 256

export interface SwarmReceiptRolesOptions {
  send: (msg: SwarmMessage) => void
  /** Durable read-back: prove the bytes are really on disk before attesting. */
  readBack: (id: string) => Promise<boolean>
  /** This node's signing identity for receipts it issues as a FETCHER. */
  identity: () => SwarmReceiptIdentity | null
  /** Optional: called with each freshly accepted receipt (module-level
   *  persistence uses this; sessions stay pure). */
  onRecord?: (id: string, entry: { receipt: ReplicationReceipt; confirmedAt: number }) => void
}

export interface SwarmReceiptRoles {
  /** Seeder: mint + send a fresh challenge after serving an object. */
  mintChallengeFor(id: string): void
  /** Fetcher: a fetch's bytes just reached the durable store. */
  noteDurablePersist(id: string): void
  /** Inbound: a seeder challenged us to attest durable custody. */
  handleChallenge(id: string, challenge: string): void
  /** Inbound: a fetcher claims durable custody of an object we serve. */
  handleReceipt(id: string, receipt: unknown): void
  getDurableReplication(id: string): { receipt: ReplicationReceipt; confirmedAt: number } | null
  /** Hydration only: insert pre-validated persisted evidence. Callers must
   *  have verified the record themselves — this path skips challenge state. */
  note(id: string, entry: { receipt: ReplicationReceipt; confirmedAt: number }): void
  reset(): void
}

function boundMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value as K | undefined
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/**
 * One receipt state machine per transport context: the module singleton owns
 * the production pipes; each `createSwarmSession` peer owns an isolated one,
 * which is what makes the two-peer handshake testable in-process.
 */
export function createSwarmReceiptRoles(options: SwarmReceiptRolesOptions): SwarmReceiptRoles {
  /** Seeder side: id -> the challenge it most recently minted for that object. */
  const outstandingChallenges = new Map<string, { challenge: string; mintedAt: number }>()
  /** Fetcher side: id -> challenge awaiting a durable persist to answer. */
  const pendingChallenges = new Map<string, string>()
  /** Fetcher side: ids durably persisted (late-challenge path). */
  const recentlyDurablyHeld = new Map<string, number>()
  /** Seeder side: recorded valid receipts (bounded, latest per object). */
  const durableReplications = new Map<string, { receipt: ReplicationReceipt; confirmedAt: number }>()

  async function signAndSendReceipt(id: string, challenge: string): Promise<void> {
    const identity = options.identity()
    if (!identity) return
    if (!await options.readBack(id)) return // honest: no read-back, no receipt
    try {
      const receipt = createReplicationReceipt({
        protocol: 'gmatch-social',
        version: 1,
        receiverId: identity.orbitId,
        receiverKey: identity.publicKeyHex,
        objectCid: id,
        manifestHash: id, // manifest-less legacy objects: see block comment above
        durable: true,
        challenge,
        createdAt: Date.now(),
      }, identity.privateKeyHex)
      options.send({ type: 'SWARM_RECEIPT', id, receipt })
    } catch {
      /* cannot attest: stay silent, the seeder simply never records us */
    }
  }

  function attest(id: string, challenge: string): void {
    void signAndSendReceipt(id, challenge)
  }

  return {
    mintChallengeFor(id) {
      if (!isSha256Hex(id)) return
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      const challenge = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
      outstandingChallenges.set(id, { challenge, mintedAt: Date.now() })
      boundMap(outstandingChallenges, MAX_OUTSTANDING_CHALLENGES)
      try {
        options.send({ type: 'SWARM_CHALLENGE', id, challenge })
      } catch {
        /* transport hiccup: no receipt will validate, correct failure mode */
      }
    },
    noteDurablePersist(id) {
      recentlyDurablyHeld.set(id, Date.now())
      boundMap(recentlyDurablyHeld, MAX_RECENTLY_DURABLE)
      const challenge = pendingChallenges.get(id)
      if (challenge) {
        pendingChallenges.delete(id)
        attest(id, challenge)
      }
    },
    handleChallenge(id, challenge) {
      if (!isSha256Hex(id) || !isSha256Hex(challenge)) return
      pendingChallenges.set(id, challenge)
      boundMap(pendingChallenges, MAX_PENDING_CHALLENGES)
      // The challenge may arrive after our persist already completed.
      if (recentlyDurablyHeld.has(id)) {
        pendingChallenges.delete(id)
        attest(id, challenge)
      }
    },
    handleReceipt(id, receipt) {
      // Consume silently unless it matches our outstanding challenge and
      // fully validates (signature, identity binding, freshness, durability).
      const outstanding = outstandingChallenges.get(id)
      if (!outstanding || !isSha256Hex(id)) return
      if (validateReplicationReceipt(receipt)) return
      const valid = receipt as ReplicationReceipt
      if (valid.challenge !== outstanding.challenge) return // replay/stale
      if (valid.objectCid !== id) return
      outstandingChallenges.delete(id)
      const entry = { receipt: valid, confirmedAt: Date.now() }
      durableReplications.set(id, entry)
      boundMap(durableReplications, MAX_DURABLE_REPLICATIONS)
      options.onRecord?.(id, entry)
    },
    getDurableReplication(id) {
      return durableReplications.get(id) ?? null
    },
    note(id, entry) {
      durableReplications.set(id, entry)
      boundMap(durableReplications, MAX_DURABLE_REPLICATIONS)
    },
    reset() {
      outstandingChallenges.clear()
      pendingChallenges.clear()
      recentlyDurablyHeld.clear()
      durableReplications.clear()
    },
  }
}

let receiptIdentity: SwarmReceiptIdentity | null = null
/** This node's signing identity for receipts it issues as a FETCHER. */
export function setSwarmReceiptIdentity(identity: SwarmReceiptIdentity | null): void {
  receiptIdentity = identity
}

/**
 * Durable custody proof for the FETCHER's side: re-read the bytes from the
 * durable store (never RAM) and re-verify the content hash before this node
 * is allowed to claim durable custody in a receipt.
 */
async function confirmDurableHold(id: string): Promise<boolean> {
  if (typeof __durableReadBackForTests === 'function') return __durableReadBackForTests(id)
  try {
    const blob = await readDurableObject(id)
    if (!blob || !isSha256Hex(id)) return false
    return (await sha256HexBlob(blob)) === id
  } catch {
    return false
  }
}

const moduleReceiptRoles = createSwarmReceiptRoles({
  send: (msg) => { try { swarmSend?.(msg) } catch { /* transport hiccup */ } },
  readBack: confirmDurableHold,
  identity: () => receiptIdentity,
  onRecord: (id, entry) => {
    // Best-effort durable evidence: the session map keeps the receipt either
    // way; a failed write only costs restart survival, never correctness.
    void (async () => {
      try {
        const { saveSwarmReceipt } = await import('./storage')
        await saveSwarmReceipt({ objectCid: id, receipt: entry.receipt as unknown as Record<string, unknown>, confirmedAt: entry.confirmedAt })
      } catch {
        /* quota/IDB unavailable: receipt stays session-only */
      }
    })()
  },
})

/**
 * Reload persisted durable-replication evidence into the session map.
 * Called on boot next to hydrateLocalObjects. Each stored record is
 * re-validated (shape, signature, identity binding — using its own
 * confirmed-at time, since freshness was enforced when it was accepted);
 * tampered or corrupt rows are skipped, never loaded.
 */
export async function hydrateDurableReplications(): Promise<number> {
  const { getAllSwarmReceipts } = await import('./storage')
  const rows = await getAllSwarmReceipts().catch(() => [])
  let loaded = 0
  for (const row of rows) {
    if (!row?.objectCid || !row.receipt) continue
    const receipt = row.receipt as unknown as ReplicationReceipt
    if (validateReplicationReceipt(receipt, receipt.createdAt)) continue
    moduleReceiptRoles.note(row.objectCid, { receipt, confirmedAt: row.confirmedAt ?? Date.now() })
    loaded += 1
  }
  return loaded
}

/** Latest valid durable-replication receipt recorded for an object we serve. */
export function getDurableReplication(id: string): { receipt: ReplicationReceipt; confirmedAt: number } | null {
  return moduleReceiptRoles.getDurableReplication(id)
}

// ---- SWARM_OP: signed social operations riding the same channel ---------
// The frame is untrusted transport: the injected handler (wired by useP2P to
// acceptInboundOperation) re-validates everything before anything is stored.

let swarmOperationHandler: ((operation: unknown) => Promise<void>) | null = null
export function setSwarmOperationHandler(handler: ((operation: unknown) => Promise<void>) | null): void {
  swarmOperationHandler = handler
}

// Inbound acks: a peer confirming it durably appended one of our operations.
// Validation (shape, known id, actor match) lives in the injected handler.
let swarmOperationAckHandler: ((ack: unknown) => void) | null = null
export function setSwarmOperationAckHandler(handler: ((ack: unknown) => void) | null): void {
  swarmOperationAckHandler = handler
}

/** Fire one frame out over every wired transport pipe. Best-effort. */
export function sendSwarmFrame(msg: SwarmMessage): boolean {
  if (!swarmSend) return false
  try {
    swarmSend(msg)
    return true
  } catch {
    return false
  }
}

/** Test seam for the durable read-back (node tests have no vault). */
let __durableReadBackForTests: ((id: string) => Promise<boolean>) | null = null
export function __setDurableReadBackForTests(fn: ((id: string) => Promise<boolean>) | null): void {
  __durableReadBackForTests = fn
}

/** Test seam: wipe challenge/receipt state (durable bytes untouched). */
export function __resetReceiptStateForTests(): void {
  moduleReceiptRoles.reset()
  receiptIdentity = null
}

interface PendingFetch {
  resolve: (blob: Blob) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  chunks: Map<number, Uint8Array>
  receivedBytes: number
  total: number
  mimeType: string
  expectedHash?: string
  onProgress?: (received: number, total: number) => void
  /** swarm-v1: this fetch's ephemeral offer. Absent = no offer was possible. */
  offer?: TransferOffer
}
const pendingFetches = new Map<string, PendingFetch>()

// ---- SWARM_HAVE: what a peer holds, and what we still need ---------------
// A HAVE is an advertisement, not a mandate: downloading everything a peer
// lists would pull the whole world. We only ask for ids this session already
// wants (a fetch that timed out, or a tile that failed and asked to be
// retried), we never re-ask for one we hold or have in flight, and the wave is
// capped so one peer's announcement can't become a download stampede.
const wantedObjects = new Set<string>()
const MAX_WANTED_IDS = 128
const MAX_HAVE_CONCURRENCY = 3
let haveFetchActive = 0
/** Bound on ids per HAVE broadcast / request wave. */
export const SWARM_HAVE_LIMIT = 64

/** Remember that this session still needs `id` (bounded, oldest dropped). */
export function wantSwarmObject(id: string): void {
  if (!id || typeof id !== 'string') return
  if (localObjects.has(id) || pendingFetches.has(id)) return
  if (wantedObjects.size >= MAX_WANTED_IDS) {
    const oldest = wantedObjects.values().next().value as string | undefined
    if (oldest !== undefined) wantedObjects.delete(oldest)
  }
  wantedObjects.add(id)
}

/** Ids this session asked for and did not get (for a later HAVE). */
export function wantedSwarmObjectIds(): string[] {
  return [...wantedObjects]
}

/** Test seam: forget the want registry (durability is untouched). */
export function __resetWantedObjectsForTests(): void {
  wantedObjects.clear()
  haveFetchActive = 0
}

/** Ids whose bytes this session currently holds, most recent first. */
export function heldSwarmObjectIds(limit = SWARM_HAVE_LIMIT): string[] {
  const keys = [...localObjects.keys()]
  const recent = keys.reverse()
  return recent.slice(0, Math.max(0, limit))
}

/**
 * Tell the swarm which objects we can serve. Called when a peer comes online
 * (and after boot hydration), so a peer that failed a fetch learns it can ask
 * us instead of waiting for a broadcast it never saw.
 */
export function announceHeldObjects(limit = SWARM_HAVE_LIMIT): number {
  if (!swarmSend) return 0
  const ids = heldSwarmObjectIds(limit)
  if (ids.length === 0) return 0
  try {
    swarmSend({ type: 'SWARM_HAVE', ids })
    return ids.length
  } catch {
    return 0
  }
}

/**
 * Answer a peer's HAVE: fetch only what we already want, bounded and with
 * per-id settlement (one slow id never blocks the rest, and a failure stays
 * wanted for the next announcement).
 */
function fetchWantedFromHave(ids: unknown[]): void {
  if (!swarmSend) return
  for (const raw of ids) {
    if (typeof raw !== 'string' || !raw) continue
    if (localObjects.has(raw)) {
      wantedObjects.delete(raw)
      continue
    }
    if (pendingFetches.has(raw) || !wantedObjects.has(raw)) continue
    if (haveFetchActive >= MAX_HAVE_CONCURRENCY) break
    haveFetchActive++
    void requestSwarmObject(raw)
      .then(() => wantedObjects.delete(raw))
      .catch(() => {
        /* still wanted: the next HAVE re-tries */
      })
      .finally(() => {
        haveFetchActive--
      })
  }
}

function decodeChunk(dataBase64: string): Uint8Array {
  const binaryStr = atob(dataBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

/** Fetcher-side bookkeeping after a fetch's bytes reached the durable store:
 *  answer any outstanding challenge with a signed durable-custody receipt. */
function noteDurableFetchComplete(id: string): void {
  moduleReceiptRoles.noteDurablePersist(id)
}

async function finishFetch(id: string, req: PendingFetch): Promise<void> {
  clearTimeout(req.timer)
    const parts: Uint8Array[] = []
  for (let i = 0; i < req.total; i++) {
    const chunk = req.chunks.get(i)
    if (chunk) parts.push(chunk)
  }
  // Verify content hash (when the object advertises one) BEFORE registering:
  // a chunk stream from an arbitrary peer is untrusted transport, and a
  // hash-mismatched blob must never enter the durable local store.
  const assembled = new Blob(parts as BlobPart[], { type: req.mimeType || 'application/octet-stream' })
  if (req.expectedHash) {
    if (pendingFetches.get(id) !== req) return
    void sha256HexBlob(assembled).then(async (got) => {
      if (got !== req.expectedHash) {
        forgetLocalObject(id)
        failFetch(id, req, new Error(`Swarm object ${id} failed hash verification`))
        return
      }
      if (pendingFetches.get(id) !== req) return
      try {
        await persistLocalObject(id, assembled)
        if (pendingFetches.get(id) === req) pendingFetches.delete(id)
        noteDurableFetchComplete(id)
        req.resolve(assembled)
      } catch (error) {
        failFetch(id, req, error instanceof Error ? error : new Error('Object persistence failed'))
      }
    }).catch(() => failFetch(id, req, new Error(`Swarm object ${id} verification failed`)))
    return
  }
  if (pendingFetches.get(id) !== req) return
  try {
    await persistLocalObject(id, assembled)
    if (pendingFetches.get(id) === req) pendingFetches.delete(id)
    noteDurableFetchComplete(id)
    req.resolve(assembled)
  } catch (error) {
    failFetch(id, req, error instanceof Error ? error : new Error('Object persistence failed'))
  }
}

function failFetch(id: string, req: PendingFetch, error: Error): void {
  clearTimeout(req.timer)
  if (pendingFetches.get(id) !== req) return
  pendingFetches.delete(id)
  req.reject(error)
}

/** Route an inbound swarm message. Returns true when consumed. */
export async function handleSwarmMessage(msg: SwarmMessage): Promise<boolean> {
  if (!msg || typeof msg !== 'object') return false
  if (msg.type === 'SWARM_WANT') {
    const blob = lookupLocalObject(msg.id) || (await getLocalObject(msg.id))
    if (!blob || !swarmSend) return true
    // swarm-v1: an offered WANT gets an end-to-end encrypted transfer. The
    // seeder learns nothing it can read: it seals a per-transfer DEK to the
    // requester's ephemeral public key and ships ciphertext.
    const offerOk = isOfferedWant(msg)
    if (offerOk && msg.transferId && msg.offerPub) {
      try {
        await serveOfferedObject(swarmSend, msg.id, blob, msg.transferId, msg.offerPub, receiptIdentity?.orbitId ?? '')
        // v1 replication evidence: challenge the fetcher to attest durable
        // custody once it lands the bytes (content-addressed ids only).
        moduleReceiptRoles.mintChallengeFor(msg.id)
      } catch {
        /* cannot seal to that offer: the fetcher times out, never plaintext */
      }
      return true
    }
    if (!legacyPlaintextServing) return true
    try {
      const buffer = await blob.arrayBuffer()
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_OBJECT_BYTES) return true
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'
      for (let i = 0; i < totalChunks; i++) {
        const slice = new Uint8Array(buffer.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buffer.byteLength)))
        const frame: SwarmMessage = { type: 'SWARM_CHUNK', id: msg.id, index: i, total: totalChunks, mimeType, dataBase64: bytesToBase64(slice) }
        if (!isBoundedChunkFrame(frame)) return true
        swarmSend(frame)
      }
      moduleReceiptRoles.mintChallengeFor(msg.id)
    } catch {
      /* read failed */
    }
    return true
  }
  if (msg.type === 'SWARM_KEY') {
    const req = pendingFetches.get(msg.id)
    if (!req?.offer) return true
    if (msg.transferId !== req.offer.transferId) return true
    if (req.offer.keys.length >= MAX_TRANSFER_KEYS) return true
    const candidate = candidateFromKeyFrame(req.offer.offerPrivHex, msg.wrapped, msg.from)
    if (candidate) req.offer.keys.push(candidate)
    return true
  }
  if (msg.type === 'SWARM_CHUNK') {
    const req = pendingFetches.get(msg.id)
    if (!req) return false
    if (msg.enc === 'swarm-v1') {
      if (!handleEncryptedChunkFrame(msg, req)) return true
    } else {
      // v0 plaintext media is refused by default: no seeder after the flag
      // flips is expected to send it, and accepting bytes through a frame we
      // cannot authenticate would put unverified media into the vault.
      if (!legacyPlaintextServing) return true
      try {
        if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > MAX_CHUNKS ||
            !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
            typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
            typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > MAX_CHUNK_BASE64_LENGTH || !isBoundedChunkFrame(msg) ||
            (req.total !== 0 && req.total !== msg.total) ||
            (req.mimeType !== '' && req.mimeType !== msg.mimeType)) {
          throw new Error('Invalid swarm chunk metadata')
        }
        let bytes: Uint8Array
        try {
          bytes = decodeChunk(msg.dataBase64)
        } catch {
          throw new Error('Invalid swarm chunk encoding')
        }
        // Duplicate re-delivery (relay/transport replay) is an idempotent
        // no-op, never a fetch failure: we already hold that index.
        if (req.chunks.has(msg.index)) return true
        const isLast = msg.index === msg.total - 1
        if (!bytes.byteLength || bytes.byteLength > CHUNK_SIZE || (!isLast && bytes.byteLength !== CHUNK_SIZE) ||
            req.receivedBytes + bytes.byteLength > MAX_OBJECT_BYTES) {
          throw new Error('Invalid swarm chunk length')
        }
        req.chunks.set(msg.index, bytes)
        req.receivedBytes += bytes.byteLength
        req.total = msg.total
        req.mimeType = msg.mimeType
      } catch (error) {
        failFetch(msg.id, req, error instanceof Error ? error : new Error('Invalid swarm chunk'))
        return true
      }
    }
    try {
      req.onProgress?.(req.chunks.size, req.total)
    } catch {
      /* progress listener must never break assembly */
    }
    if (req.chunks.size === req.total) void finishFetch(msg.id, req).catch((error) => {
      failFetch(msg.id, req, error instanceof Error ? error : new Error('Swarm assembly failed'))
    })
    return true
  }
  if (msg.type === 'SWARM_HAVE') {
    fetchWantedFromHave(Array.isArray(msg.ids) ? msg.ids : [])
    return true
  }
  if (msg.type === 'SWARM_CHALLENGE') {
    moduleReceiptRoles.handleChallenge(msg.id, msg.challenge)
    return true
  }
  if (msg.type === 'SWARM_RECEIPT') {
    moduleReceiptRoles.handleReceipt(msg.id, msg.receipt)
    return true
  }
  if (msg.type === 'SWARM_OP') {
    // Untrusted transport: validation lives in the injected handler.
    void swarmOperationHandler?.(msg.operation)
    return true
  }
  if (msg.type === 'SWARM_OP_ACK') {
    swarmOperationAckHandler?.({ operationId: msg.operationId, actorId: msg.actorId })
    return true
  }
  return false
}

export interface SwarmFetchOptions {
  /** Content hash the assembled bytes must match, else the transfer is rejected. */
  expectedHash?: string
  /** Called per received chunk with (received, total). */
  onProgress?: (received: number, total: number) => void
}

/** Ask the swarm for an object by id (or content_hash alias). When
 *  `expectedHash` is given, the assembled bytes must hash to it or the
 *  transfer is rejected (never registered). */
export function requestSwarmObject(id: string, timeoutMs = 15000, opts: SwarmFetchOptions = {}): Promise<Blob> {
  if (!id || id.length > 256 || (opts.expectedHash && !isSha256Hex(opts.expectedHash))) {
    return Promise.reject(new Error('Invalid swarm object request'))
  }
  const expectedHash = opts.expectedHash?.toLowerCase()
  const cached = lookupLocalObject(id)
  if (cached) {
    if (!expectedHash) return Promise.resolve(cached)
    return sha256HexBlob(cached).then((actualHash) => {
      if (actualHash === expectedHash) return cached
      return Promise.reject(new Error(`Cached swarm object ${id} failed hash verification`))
    }, () => {
      return Promise.reject(new Error(`Cached swarm object ${id} verification failed`))
    })
  }
  return fetchVerifiedPeerObject(id, timeoutMs, opts, expectedHash)
}

function fetchVerifiedPeerObject(id: string, timeoutMs: number, opts: SwarmFetchOptions, expectedHash?: string): Promise<Blob> {
  if (!swarmSend) return Promise.reject(new Error('swarm transport unavailable'))
  const existing = pendingFetches.get(id)
  if (existing) {
    // A second waiter joins the in-flight fetch and shares its integrity
    // contract: it may add an expectation, never contradict one.
    if (expectedHash) {
      if (existing.expectedHash && existing.expectedHash !== expectedHash) {
        return Promise.reject(new Error(`Swarm object ${id} requested with conflicting hashes`))
      }
      existing.expectedHash = expectedHash
    }
    if (opts.onProgress) {
      const prev = existing.onProgress
      existing.onProgress = prev
        ? (r, t) => { try { prev(r, t) } catch { /* ignore */ } opts.onProgress!(r, t) }
        : opts.onProgress
    }
    return new Promise<Blob>((resolve, reject) => {
      const prevResolve = existing.resolve
      const prevReject = existing.reject
      existing.resolve = (b) => { prevResolve(b); resolve(b) }
      existing.reject = (e) => { prevReject(e); reject(e) }
    })
  }
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingFetches.delete(id)
      // Nobody answered: keep the id on the want list so the next SWARM_HAVE
      // from a peer that holds it can serve us without a fresh request.
      wantSwarmObject(id)
      reject(new Error(`Timed out waiting for swarm object ${id}`))
    }, timeoutMs)
    const request = () => {
      // Every fetch opens with a fresh transfer offer: without one no seeder
      // can serve us anything we can decrypt, and silently falling back to
      // plaintext media would defeat the transport layer. Reject instead.
      let offer: TransferOffer
      try {
        offer = newTransferOffer()
      } catch (err) {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error('swarm transfer offer unavailable'))
        return
      }
      pendingFetches.set(id, { resolve, reject, timer, chunks: new Map(), receivedBytes: 0, total: 0, mimeType: '', expectedHash, onProgress: opts.onProgress, offer })
      try {
        swarmSend!({
          type: 'SWARM_WANT',
          id,
          transferId: offer.transferId,
          offerPub: offer.offerPubHex,
          from: receiptIdentity?.orbitId,
        })
      }
      catch (err) {
        clearTimeout(timer)
        pendingFetches.delete(id)
        reject(err instanceof Error ? err : new Error('swarm send failed'))
      }
    }
    request()
  })
}

/** Cancel an in-flight swarm fetch. Partial chunks are dropped, never kept. */
export function cancelSwarmObject(id: string): boolean {
  const req = pendingFetches.get(id)
  if (!req) return false
  clearTimeout(req.timer)
  pendingFetches.delete(id)
  req.reject(new Error('swarm fetch cancelled'))
  return true
}

export interface SwarmSessionOptions {
  send: (msg: SwarmMessage) => void
  localStore?: Map<string, Blob>
  /** Signing identity for durable-custody receipts this session issues.
   *  Its orbitId is also the swarm-v1 sender/receiver wire label. */
  receiptIdentity?: SwarmReceiptIdentity | null
  /** Test override for the session's durable read-back. */
  durableReadBack?: (id: string) => Promise<boolean>
  /** Optional persistence hook for each accepted receipt (see roles options). */
  onRecord?: (id: string, entry: { receipt: ReplicationReceipt; confirmedAt: number }) => void
  /**
   * Hermetic persistence sink (roadmap L3 harness): when present, fetched
   * bytes are AWAITED into this sink (failure rejects the fetch, mirroring
   * the module path's persist-before-resolve contract) and the module-level
   * store is never touched. Absent = legacy behavior (module
   * registerLocalObject, fire-and-forget).
   */
  persist?: (id: string, blob: Blob) => Promise<void>
  /**
   * Explicit opt-in for the legacy v0 plaintext wire (WANT without offer and
   * chunk frames without `enc`). Off by default: the session neither serves
   * nor ingests unauthenticated media without this.
   */
  legacyPlaintext?: boolean
}

export interface SwarmSession {
  handleMessage: (msg: SwarmMessage) => Promise<void>
  requestObject: (id: string, timeoutMs?: number, expectedHash?: string) => Promise<Blob>
  registerLocalObject: (id: string, blob: Blob) => void
  cancelObject: (id: string) => boolean
  /** This session's receipt state machine (two-peer tests + future transports). */
  receiptRoles: SwarmReceiptRoles
}

export function createSwarmSession(options: SwarmSessionOptions): SwarmSession {
  const sessionStore = options.localStore || new Map<string, Blob>()
  const receiptRoles = createSwarmReceiptRoles({
    send: options.send,
    identity: () => options.receiptIdentity ?? null,
    onRecord: options.onRecord,
    readBack: options.durableReadBack ?? (async (id) => {
      // A session's durable store is its sessionStore: the read-back hashes
      // the stored bytes against the content-addressed id.
      const blob = sessionStore.get(id)
      if (!blob || !isSha256Hex(id)) return false
      try {
        return (await sha256HexBlob(blob)) === id
      } catch {
        return false
      }
    }),
  })
  const pendingRequests = new Map<
    string,
    {
      resolve: (blob: Blob) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
      chunks: Map<number, Uint8Array>
        total: number
        receivedBytes: number
        mimeType: string
      expectedHash?: string
      /** swarm-v1: this fetch's ephemeral offer. */
      offer?: TransferOffer
    }
  >()
  const sessionSenderOrbitId = options.receiptIdentity?.orbitId ?? ''

  /**
   * Session-local twin of handleEncryptedChunkFrame: the sandboxed session's
   * fetch state lives in a different map, so the decrypt + assemble logic is
   * repeated here with the session's own failure path.
   */
  function handleSessionEncryptedChunk(
    msg: SwarmChunkFrame,
    req: {
      chunks: Map<number, Uint8Array>
      receivedBytes: number
      total: number
      mimeType: string
      offer?: TransferOffer
      timer: ReturnType<typeof setTimeout>
      reject: (err: Error) => void
    },
  ): boolean {
    const offer = req.offer
    if (!offer || msg.transferId !== offer.transferId) return false
    if (typeof msg.nonce !== 'string') return false
    let nonce: Uint8Array | null = null
    try { nonce = decodeChunk(msg.nonce) } catch { nonce = null }
    if (!nonce || nonce.length !== 24) return false
    let ciphertext: Uint8Array | null = null
    try { ciphertext = decodeChunk(msg.dataBase64) } catch { ciphertext = null }
    if (!ciphertext || !ciphertext.byteLength) return false
    let plaintext: Uint8Array | null = null
    for (const candidate of offer.keys) {
      try {
        plaintext = decryptSwarmChunk(
          candidate.dek,
          nonce,
          ciphertext,
          chunkContext(offer, msg.id, msg.index, msg.total, candidate.senderOrbitId),
        )
        break
      } catch {
        plaintext = null
      }
    }
    if (!plaintext) {
      clearTimeout(req.timer)
      pendingRequests.delete(msg.id)
      req.reject(new Error(`Swarm chunk for ${msg.id} failed authenticated decryption`))
      return false
    }
    try {
      validateChunkEnvelope(msg, req.total, req.mimeType)
      if (req.chunks.has(msg.index)) return false
      const isLast = msg.index === msg.total - 1
      if (!plaintext.byteLength || plaintext.byteLength > SWARM_CHUNK_PAYLOAD ||
          (!isLast && plaintext.byteLength !== SWARM_CHUNK_PAYLOAD) ||
          req.receivedBytes + plaintext.byteLength > MAX_OBJECT_BYTES) {
        throw new Error('Invalid swarm chunk length')
      }
      req.chunks.set(msg.index, plaintext)
      req.receivedBytes += plaintext.byteLength
      req.total = msg.total
      req.mimeType = msg.mimeType
    } catch (error) {
      clearTimeout(req.timer)
      pendingRequests.delete(msg.id)
      req.reject(error instanceof Error ? error : new Error('Invalid swarm chunk'))
      return false
    }
    return true
  }

  async function handleMessage(msg: SwarmMessage): Promise<void> {
    if (msg.type === 'SWARM_WANT') {
      const blob = sessionStore.get(msg.id) || (await getLocalObject(msg.id))
      if (!blob) return

      // swarm-v1: an offered WANT gets ciphertext only.
      if (isOfferedWant(msg) && msg.transferId && msg.offerPub) {
        try {
          await serveOfferedObject(options.send, msg.id, blob, msg.transferId, msg.offerPub, sessionSenderOrbitId)
          receiptRoles.mintChallengeFor(msg.id)
        } catch {
          /* cannot seal: the request times out, never plaintext */
        }
        return
      }
      if (!options.legacyPlaintext) return
      if (blob.size === 0 || blob.size > MAX_OBJECT_BYTES) return
      const buffer = await blob.arrayBuffer()
      const totalBytes = buffer.byteLength
      const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalBytes)
        const slice = new Uint8Array(buffer.slice(start, end))

        // Convert slice to base64 (block-wise: see bytesToBase64).
        const dataBase64 = bytesToBase64(slice)

        const frame: SwarmMessage = {
          type: 'SWARM_CHUNK',
          id: msg.id,
          index: i,
          total: totalChunks,
          mimeType,
          dataBase64,
        }
        if (!isBoundedChunkFrame(frame)) return
        options.send(frame)
      }
      receiptRoles.mintChallengeFor(msg.id)
      return
    }

    if (msg.type === 'SWARM_KEY') {
      const req = pendingRequests.get(msg.id)
      if (!req?.offer) return
      if (msg.transferId !== req.offer.transferId) return
      if (req.offer.keys.length >= MAX_TRANSFER_KEYS) return
      const candidate = candidateFromKeyFrame(req.offer.offerPrivHex, msg.wrapped, msg.from)
      if (candidate) req.offer.keys.push(candidate)
      return
    }

    if (msg.type === 'SWARM_CHUNK') {
      const req = pendingRequests.get(msg.id)
      if (!req) return

      if (msg.enc === 'swarm-v1') {
        if (!handleSessionEncryptedChunk(msg, req)) return
      } else {
        if (!options.legacyPlaintext) return
        let bytes: Uint8Array
        try {
          if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > MAX_CHUNKS ||
              !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
              typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
              typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > MAX_CHUNK_BASE64_LENGTH || !isBoundedChunkFrame(msg) ||
              (req.total !== 0 && req.total !== msg.total) ||
              (req.mimeType !== '' && req.mimeType !== msg.mimeType)) {
            throw new Error('Invalid swarm chunk metadata')
          }
          bytes = decodeChunk(msg.dataBase64)
          // Duplicate re-delivery: idempotent no-op (see module handler note).
          if (req.chunks.has(msg.index)) return
          const last = msg.index === msg.total - 1
          if (!bytes.byteLength || bytes.byteLength > CHUNK_SIZE || (!last && bytes.byteLength !== CHUNK_SIZE) ||
              req.receivedBytes + bytes.byteLength > MAX_OBJECT_BYTES) {
            throw new Error('Invalid swarm chunk length')
          }
        } catch (error) {
          clearTimeout(req.timer)
          pendingRequests.delete(msg.id)
          req.reject(error instanceof Error ? error : new Error('Invalid swarm chunk'))
          return
        }

        req.chunks.set(msg.index, bytes)
        req.receivedBytes += bytes.byteLength
        req.total = msg.total
        req.mimeType = msg.mimeType
      }

      if (req.chunks.size === req.total) {
        // Assemble all chunks in order
        const parts: Uint8Array[] = []
        for (let i = 0; i < req.total; i++) {
          const chunk = req.chunks.get(i)
          if (chunk) parts.push(chunk)
        }

        const assembledBlob = new Blob(parts as BlobPart[], { type: req.mimeType })
        if (req.expectedHash) {
          if (!isSha256Hex(req.expectedHash)) {
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            req.reject(new Error('Invalid expected swarm hash'))
            return
          }
          void sha256HexBlob(assembledBlob).then(async (got) => {
            if (pendingRequests.get(msg.id) !== req) return
            if (got !== req.expectedHash) {
              clearTimeout(req.timer)
              pendingRequests.delete(msg.id)
              req.reject(new Error(`Swarm object ${msg.id} failed hash verification`))
              return
            }
            try {
              if (options.persist) await options.persist(msg.id, assembledBlob)
            } catch (error) {
              clearTimeout(req.timer)
              pendingRequests.delete(msg.id)
              req.reject(error instanceof Error ? error : new Error('session persist failed'))
              return
            }
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            sessionStore.set(msg.id, assembledBlob)
            if (!options.persist) registerLocalObject(msg.id, assembledBlob)
            receiptRoles.noteDurablePersist(msg.id)
            req.resolve(assembledBlob)
          }).catch(() => {
            if (pendingRequests.get(msg.id) !== req) return
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            req.reject(new Error(`Swarm object ${msg.id} verification failed`))
          })
        } else {
          if (pendingRequests.get(msg.id) !== req) return
          try {
            if (options.persist) await options.persist(msg.id, assembledBlob)
          } catch (error) {
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            req.reject(error instanceof Error ? error : new Error('session persist failed'))
            return
          }
          clearTimeout(req.timer)
          pendingRequests.delete(msg.id)
          sessionStore.set(msg.id, assembledBlob)
          if (!options.persist) registerLocalObject(msg.id, assembledBlob)
          receiptRoles.noteDurablePersist(msg.id)
          req.resolve(assembledBlob)
        }
      }
    }

    if (msg.type === 'SWARM_CHALLENGE') {
      receiptRoles.handleChallenge(msg.id, msg.challenge)
      return
    }
    if (msg.type === 'SWARM_RECEIPT') {
      receiptRoles.handleReceipt(msg.id, msg.receipt)
      return
    }
  }

  function requestObject(id: string, timeoutMs = 15000, expectedHash?: string): Promise<Blob> {
    if (!id || id.length > 256 || (expectedHash && !isSha256Hex(expectedHash))) {
      return Promise.reject(new Error('Invalid swarm object request'))
    }
    expectedHash = expectedHash?.toLowerCase()
    // Immediate local session hit
    if (sessionStore.has(id)) {
      return Promise.resolve(sessionStore.get(id)!)
    }

    const existing = pendingRequests.get(id)
    if (existing) {
      if (expectedHash && existing.expectedHash && expectedHash !== existing.expectedHash) {
        return Promise.reject(new Error('Conflicting expected swarm hashes'))
      }
      if (expectedHash) existing.expectedHash = expectedHash
      return new Promise<Blob>((resolve, reject) => {
        const oldResolve = existing.resolve
        const oldReject = existing.reject
        existing.resolve = (blob) => { oldResolve(blob); resolve(blob) }
        existing.reject = (error) => { oldReject(error); reject(error) }
      })
    }

    return new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`Timed out waiting for swarm object ${id}`))
      }, timeoutMs)

      let offer: TransferOffer
      try {
        offer = newTransferOffer()
      } catch (error) {
        reject(error instanceof Error ? error : new Error('swarm transfer offer unavailable'))
        return
      }

      pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        chunks: new Map(),
        receivedBytes: 0,
        total: 0,
        mimeType: '',
        expectedHash,
        offer,
      })

      try {
        options.send({
          type: 'SWARM_WANT',
          id,
          transferId: offer.transferId,
          offerPub: offer.offerPubHex,
          from: sessionSenderOrbitId || undefined,
        })
      } catch (error) {
        clearTimeout(timer)
        pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error('swarm send failed'))
      }
    })
  }

  return {
    handleMessage,
    requestObject,
    registerLocalObject: (id: string, blob: Blob) => sessionStore.set(id, blob),
    receiptRoles,
    cancelObject(id: string) {
      const req = pendingRequests.get(id)
      if (!req) return false
      clearTimeout(req.timer)
      pendingRequests.delete(id)
      req.reject(new Error('swarm fetch cancelled'))
      return true
    },
  }
}
