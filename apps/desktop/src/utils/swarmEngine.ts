/**
 * The swarm transfer engine — ONE implementation, two transport contexts.
 *
 * Every swarm fetch (the production pipes wired by useP2P, and the isolated
 * `createSwarmSession` peers used by the harness and tests) runs THIS engine:
 * the swarm-v1 offer/key/chunk handshake, chunk authentication, assembly,
 * hash verification, durable persistence and the receipt state machine.
 *
 * The module path and the session path used to be two near-copies that had
 * already drifted (the session twin failed a transfer on the first bad
 * chunk; the module gives the seeder's key a grace period and tracks which
 * indices failed). This file is the one semantics; `p2pSwarm.ts` wires it
 * into the module singleton and the session facade.
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
  SWARM_CHUNK_PAYLOAD,
  SWARM_CHUNK_SIZE,
  SWARM_MAX_CHUNKS,
  SWARM_MAX_CHUNK_BASE64,
  SWARM_MAX_FRAME_BYTES,
  SWARM_MAX_OBJECT_BYTES,
  type ReplicationReceipt,
  type SwarmMessage,
} from '@orbit/protocol'

// ─── Primitives ─────────────────────────────────────────────────────────────

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

function decodeChunk(dataBase64: string): Uint8Array {
  const binaryStr = atob(dataBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

/** SHA-256 hex of a blob's bytes (Web Crypto). Used to VERIFY reassembled
 *  swarm media against the object's content_hash before accepting it —
 *  a peer's chunk stream is not proof the bytes are the real object. */
export async function sha256HexBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f\d]{64}$/i.test(value)
}

function isBoundedChunkFrame(message: SwarmMessage): boolean {
  return message.type !== 'SWARM_CHUNK' || new TextEncoder().encode(JSON.stringify(message)).byteLength <= SWARM_MAX_FRAME_BYTES
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── swarm-v1: end-to-end encrypted chunk transfers ─────────────────────────
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
// Legacy v0 plaintext frames are an explicit opt-in: with the flag off (the
// default) the wire NEVER carries or accepts unencrypted media, and a legacy
// peer's frames are dropped.

interface SwarmKeyCandidate {
  dek: Uint8Array
  senderOrbitId: string
}

export interface TransferOffer {
  transferId: string
  offerPrivHex: string
  offerPubHex: string
  keys: SwarmKeyCandidate[]
  badFrames: number
  createdAt: number
}

const MAX_TRANSFER_KEYS = 4
const MAX_KEY_WRAPPED_LENGTH = 512

/** Grace period for a seeder's SWARM_KEY to arrive on another transport. */
const SWARM_KEY_GRACE_MS = 3000

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

/** Open a SWARM_KEY frame into a candidate DEK for our offer. */
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

export type SwarmChunkFrame = Extract<SwarmMessage, { type: 'SWARM_CHUNK' }>
export type SwarmWantFrame = Extract<SwarmMessage, { type: 'SWARM_WANT' }>

/** A WANT that carries a well-formed swarm-v1 transfer offer. */
function isOfferedWant(msg: SwarmWantFrame): boolean {
  if (typeof msg.transferId !== 'string' || !/^[a-f\d]+$/i.test(msg.transferId) || msg.transferId.length < 8 || msg.transferId.length > 128) return false
  if (typeof msg.offerPub !== 'string' || !/^[a-f\d]{64}$/i.test(msg.offerPub)) return false
  return true
}

/** Shared chunk-envelope validation (every ingest path). */
function validateChunkEnvelope(
  msg: SwarmChunkFrame,
  reqTotal: number,
  reqMime: string,
): void {
  if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > SWARM_MAX_CHUNKS ||
      !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
      typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
      typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > SWARM_MAX_CHUNK_BASE64 ||
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
  if (buffer.byteLength === 0 || buffer.byteLength > SWARM_MAX_OBJECT_BYTES) return
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

// ─── SWARM_CHALLENGE / SWARM_RECEIPT: durable-replication evidence ──────────
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
  /** DISTINCT identities this node has verified holding the object (from
   *  accepted receipts). One identity is never counted twice. */
  holderCount(id: string): number
  holdersOf(id: string): { receiverId: string; confirmedAt: number }[]
  /** Hydration only: insert pre-validated persisted evidence. Callers must
   *  have verified the record themselves — this path skips challenge state.
   *  `holders` carries the persisted distinct-holder list when the row has
   *  one (legacy rows default to the receipt's own receiverId). */
  note(id: string, entry: { receipt: ReplicationReceipt; confirmedAt: number }, holders?: { receiverId: string; confirmedAt: number }[]): void
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
  /** Seeder side: DISTINCT identities proven to durably hold each object we
   *  serve (one map entry per accepted receipt's receiverId, timestamps
   *  refreshed — an identity is never a second holder). Matches the persisted
   *  per-row bound in utils/storage (MAX_HOLDERS_PER_OBJECT). */
  const MAX_HOLDER_IDENTITIES = 8
  const receiptHolders = new Map<string, Map<string, number>>()

  function recordHolder(id: string, receiverId: string, confirmedAt: number): void {
    if (typeof receiverId !== 'string' || !receiverId) return
    let holders = receiptHolders.get(id)
    if (!holders) {
      holders = new Map()
      receiptHolders.set(id, holders)
    }
    holders.set(receiverId, confirmedAt)
    while (holders.size > MAX_HOLDER_IDENTITIES) {
      const oldest = [...holders.entries()].sort((a, b) => a[1] - b[1])[0]
      if (!oldest) break
      holders.delete(oldest[0])
    }
  }

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
      recordHolder(id, valid.receiverId, entry.confirmedAt)
      options.onRecord?.(id, entry)
    },
    getDurableReplication(id) {
      return durableReplications.get(id) ?? null
    },
    holderCount(id) {
      return receiptHolders.get(id)?.size ?? 0
    },
    holdersOf(id) {
      const holders = receiptHolders.get(id)
      if (!holders) return []
      return [...holders.entries()].map(([receiverId, confirmedAt]) => ({ receiverId, confirmedAt }))
    },
    /** Hydration only. `holders` lands pre-validated; a legacy row without
     *  one still records the single receipt's receiverId. */
    note(id, entry, holders) {
      durableReplications.set(id, entry)
      boundMap(durableReplications, MAX_DURABLE_REPLICATIONS)
      if (Array.isArray(holders)) {
        for (const h of holders) {
          if (h && typeof h.receiverId === 'string') recordHolder(id, h.receiverId, h.confirmedAt ?? entry.confirmedAt)
        }
      } else {
        recordHolder(id, entry.receipt.receiverId, entry.confirmedAt)
      }
    },
    reset() {
      outstandingChallenges.clear()
      pendingChallenges.clear()
      recentlyDurablyHeld.clear()
      durableReplications.clear()
      receiptHolders.clear()
    },
  }
}

// ─── The engine ─────────────────────────────────────────────────────────────

export interface SwarmFetchOptions {
  /** Content hash the assembled bytes must match, else the transfer is rejected. */
  expectedHash?: string
  /** Called per received chunk with (received, total). */
  onProgress?: (received: number, total: number) => void
}

export interface SwarmEngineOptions {
  /** Outbound pipe (one engine per transport context). */
  send: (msg: SwarmMessage) => void
  /** When present, a fetch is refused up front when it returns false. */
  canSend?: () => boolean
  /** Local/durable read for WANT serving. */
  readLocal: (id: string) => Promise<Blob | null>
  /** Synchronous store peek for a fetch's cached-hit path: checked before any
   *  network activity, so pending-fetch registration and the WANT send stay
   *  synchronous (an inbound chunk must never race the request itself). */
  peekLocal?: (id: string) => Blob | null
  /** Durable persistence for assembled bytes — awaited before the fetch resolves. */
  persist: (id: string, blob: Blob) => Promise<void>
  /** This context's receipt state machine. */
  receiptRoles: SwarmReceiptRoles
  /** This node's orbit id (the wire `from` label). */
  senderOrbitId?: () => string
  /** Legacy v0 plaintext opt-in getter (default deny). */
  legacyPlaintext?: () => boolean
  /** Timeout side-effect (the module path keeps the id on its want list). */
  onTimeout?: (id: string) => void
}

export interface SwarmEngine {
  /** Route one inbound frame. True when consumed; false for a chunk with no
   *  pending fetch and for unknown frames. */
  handleMessage(msg: SwarmMessage): Promise<boolean>
  requestObject(id: string, timeoutMs?: number, opts?: SwarmFetchOptions): Promise<Blob>
  cancelObject(id: string): boolean
  /** A fetch for this id is currently in flight. */
  isPending(id: string): boolean
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
  /** Chunk indices that arrived but never authenticated. */
  badIndices: Set<number>
  /** Grace timer: fires when no chunk has authenticated yet (see the AEAD path). */
  badFrameTimer?: ReturnType<typeof setTimeout>
}

/**
 * Create one swarm engine over one transport context. The production module
 * and every `createSwarmSession` peer get the SAME semantics from THIS file.
 */
export function createSwarmEngine(options: SwarmEngineOptions): SwarmEngine {
  const pendingFetches = new Map<string, PendingFetch>()

  function clearBadFrameTimer(req: PendingFetch): void {
    if (req.badFrameTimer) {
      clearTimeout(req.badFrameTimer)
      req.badFrameTimer = undefined
    }
  }

  function failFetch(id: string, req: PendingFetch, error: Error): void {
    clearTimeout(req.timer)
    clearBadFrameTimer(req)
    if (pendingFetches.get(id) !== req) return
    pendingFetches.delete(id)
    req.reject(error)
  }

  /** Validate + store one authenticated (or legacy) chunk. Throws on bad frames. */
  function ingestChunkBytes(msg: SwarmChunkFrame, req: PendingFetch, bytes: Uint8Array, fullChunkSize: number): void {
    validateChunkEnvelope(msg, req.total, req.mimeType)
    // Duplicate re-delivery (relay/transport replay) is an idempotent
    // no-op, never a fetch failure: we already hold that index.
    if (req.chunks.has(msg.index)) return
    // This index DID authenticate, so it is not missing after all (a hostile
    // peer may have injected garbage for it first).
    req.badIndices.delete(msg.index)
    const isLast = msg.index === msg.total - 1
    if (!bytes.byteLength || bytes.byteLength > fullChunkSize ||
        (!isLast && bytes.byteLength !== fullChunkSize) ||
        req.receivedBytes + bytes.byteLength > SWARM_MAX_OBJECT_BYTES) {
      throw new Error('Invalid swarm chunk length')
    }
    req.chunks.set(msg.index, bytes)
    req.receivedBytes += bytes.byteLength
    req.total = msg.total
    req.mimeType = msg.mimeType
  }

  /**
   * Ingest one swarm-v1 chunk. A chunk that fails every candidate DEK is
   * dropped (never silently accepted); a flood of such frames fails the fetch
   * outright, so a hostile relay cannot spin the fetcher until timeout for
   * free. A legit transfer whose SWARM_KEY arrives late survives: unauthenticated
   * frames are dropped, not fatal, and a re-delivered stream completes.
   */
  function handleEncryptedChunkFrame(msg: SwarmChunkFrame, req: PendingFetch): void {
    const offer = req.offer
    if (!offer || msg.transferId !== offer.transferId) return
    if (typeof msg.nonce !== 'string') return
    let nonce: Uint8Array | null = null
    try { nonce = decodeChunk(msg.nonce) } catch { nonce = null }
    if (!nonce || nonce.length !== 24) return
    let ciphertext: Uint8Array | null = null
    try { ciphertext = decodeChunk(msg.dataBase64) } catch { ciphertext = null }
    if (!ciphertext || !ciphertext.byteLength) return
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
      // Remember WHICH index failed. The declared size is NOT taken from this
      // frame: an unauthenticated peer must never be able to poison the
      // transfer's shape (a bogus `total` would make the legitimate seeder's
      // chunks look inconsistent and abort the fetch).
      if (Number.isSafeInteger(msg.index) && msg.index >= 0 && msg.index < SWARM_MAX_CHUNKS) {
        // Only count an index as missing when it is not already stored: a
        // hostile peer may inject garbage for an index the seeder already
        // delivered, and the two must not be counted twice.
        if (!req.chunks.has(msg.index)) req.badIndices.add(msg.index)
      }
      // The seeder sends exactly `total` chunks and `total` is only known from
      // an AUTHENTICATED frame. Once every index of the transfer has been seen
      // and one of them never authenticated, the seeder is done and this
      // transfer can never complete: fail now with an honest error instead of
      // waiting out the whole timeout.
      if (req.total > 0 && req.badIndices.size > 0 && req.chunks.size + req.badIndices.size >= req.total) {
        failFetch(
          msg.id,
          req,
          new Error(`Swarm chunk for ${msg.id} failed authenticated decryption`),
        )
        return
      }
      // A chunk that fails every candidate key is dropped, never accepted. When
      // NOTHING has authenticated yet, the seeder's SWARM_KEY may still be in
      // flight on another transport — so give it a short grace and then fail
      // with an honest error instead of hanging until the whole timeout.
      if (req.chunks.size === 0 && !req.badFrameTimer) {
        req.badFrameTimer = setTimeout(() => {
          req.badFrameTimer = undefined
          if (pendingFetches.get(msg.id) !== req) return
          if (req.chunks.size > 0) return
          failFetch(
            msg.id,
            req,
            new Error(`Swarm chunk for ${msg.id} failed authenticated decryption`),
          )
        }, SWARM_KEY_GRACE_MS)
      }
      if (req.offer!.badFrames > MAX_TRANSFER_KEYS * Math.max(1, msg.total || 1) + 8) {
        failFetch(msg.id, req, new Error('Swarm transfer failed authenticated-chunk checks'))
      }
      return
    }
    clearBadFrameTimer(req)
    try {
      ingestChunkBytes(msg, req, plaintext, SWARM_CHUNK_PAYLOAD)
    } catch (error) {
      failFetch(msg.id, req, error instanceof Error ? error : new Error('Invalid swarm chunk'))
    }
  }

  function handleChunk(msg: SwarmChunkFrame): boolean {
    const req = pendingFetches.get(msg.id)
    if (!req) return false
    if (msg.enc === 'swarm-v1') {
      handleEncryptedChunkFrame(msg, req)
    } else {
      // v0 plaintext media is refused by default: no seeder after the flag
      // flips is expected to send it, and accepting bytes through a frame we
      // cannot authenticate would put unverified media into the vault.
      if (!options.legacyPlaintext?.()) return true
      try {
        let bytes: Uint8Array
        try {
          bytes = decodeChunk(msg.dataBase64)
        } catch {
          throw new Error('Invalid swarm chunk encoding')
        }
        ingestChunkBytes(msg, req, bytes, SWARM_CHUNK_SIZE)
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
    // Assembly is complete only when the transfer declared a size AND every
    // index arrived. `req.total` starts at 0, so a bare size comparison would
    // fire on the FIRST frame — even one that failed its AEAD check — and
    // assemble an empty blob.
    if (req.total > 0 && req.chunks.size === req.total) {
      void finishFetch(msg.id, req).catch((error) => {
        failFetch(msg.id, req, error instanceof Error ? error : new Error('Swarm assembly failed'))
      })
      return true
    }
    // The seeder sends exactly `total` chunks. Once every index has been seen
    // and one of them never authenticated, the seeder is done and this
    // transfer can never complete: fail with an honest error now.
    if (req.badIndices.size > 0 && req.total > 0 && req.chunks.size + req.badIndices.size >= req.total) {
      failFetch(
        msg.id,
        req,
        new Error(`Swarm chunk for ${msg.id} failed authenticated decryption`),
      )
    }
    return true
  }

  async function handleWant(msg: SwarmWantFrame): Promise<void> {
    const blob = await options.readLocal(msg.id)
    if (!blob) return
    if (options.canSend && !options.canSend()) return
    // swarm-v1: an offered WANT gets an end-to-end encrypted transfer. The
    // seeder learns nothing it can read: it seals a per-transfer DEK to the
    // requester's ephemeral public key and ships ciphertext.
    if (isOfferedWant(msg) && msg.transferId && msg.offerPub) {
      try {
        await serveOfferedObject(options.send, msg.id, blob, msg.transferId, msg.offerPub, options.senderOrbitId?.() ?? '')
        // v1 replication evidence: challenge the fetcher to attest durable
        // custody once it lands the bytes (content-addressed ids only).
        options.receiptRoles.mintChallengeFor(msg.id)
      } catch {
        /* cannot seal to that offer: the fetcher times out, never plaintext */
      }
      return
    }
    if (!options.legacyPlaintext?.()) return
    try {
      const buffer = await blob.arrayBuffer()
      if (buffer.byteLength === 0 || buffer.byteLength > SWARM_MAX_OBJECT_BYTES) return
      const totalChunks = Math.ceil(buffer.byteLength / SWARM_CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'
      for (let i = 0; i < totalChunks; i++) {
        const slice = new Uint8Array(buffer.slice(i * SWARM_CHUNK_SIZE, Math.min((i + 1) * SWARM_CHUNK_SIZE, buffer.byteLength)))
        const frame: SwarmMessage = { type: 'SWARM_CHUNK', id: msg.id, index: i, total: totalChunks, mimeType, dataBase64: bytesToBase64(slice) }
        if (!isBoundedChunkFrame(frame)) return
        options.send(frame)
      }
      options.receiptRoles.mintChallengeFor(msg.id)
    } catch {
      /* read failed */
    }
  }

  async function finishFetch(id: string, req: PendingFetch): Promise<void> {
    clearTimeout(req.timer)
    clearBadFrameTimer(req)
    const parts: Uint8Array[] = []
    for (let i = 0; i < req.total; i++) {
      const chunk = req.chunks.get(i)
      if (chunk) parts.push(chunk)
    }
    // An assembly with no bytes is never a valid object. It happens when the
    // transfer's chunks were all dropped (e.g. the seeder's SWARM_KEY never
    // arrived, so every chunk failed its AEAD check) — report THAT honestly
    // instead of handing an empty blob to the durable store.
    if (parts.length === 0) {
      failFetch(id, req, new Error(`Swarm object ${id} assembled no bytes`))
      return
    }
    // Verify content hash (when the object advertises one) BEFORE persisting:
    // a chunk stream from an arbitrary peer is untrusted transport, and a
    // hash-mismatched blob must never enter the durable local store.
    const assembled = new Blob(parts as BlobPart[], { type: req.mimeType || 'application/octet-stream' })
    if (req.expectedHash) {
      if (pendingFetches.get(id) !== req) return
      let got: string
      try {
        got = await sha256HexBlob(assembled)
      } catch {
        failFetch(id, req, new Error(`Swarm object ${id} verification failed`))
        return
      }
      if (got !== req.expectedHash) {
        failFetch(id, req, new Error(`Swarm object ${id} failed hash verification`))
        return
      }
      if (pendingFetches.get(id) !== req) return
    }
    if (pendingFetches.get(id) !== req) return
    try {
      await options.persist(id, assembled)
    } catch (error) {
      failFetch(id, req, error instanceof Error ? error : new Error('Object persistence failed'))
      return
    }
    if (pendingFetches.get(id) === req) pendingFetches.delete(id)
    // The fetch's bytes reached the durable store: answer any outstanding
    // challenge with a signed durable-custody receipt.
    options.receiptRoles.noteDurablePersist(id)
    req.resolve(assembled)
  }

  async function handleMessage(msg: SwarmMessage): Promise<boolean> {
    if (!msg || typeof msg !== 'object') return false
    if (msg.type === 'SWARM_WANT') {
      await handleWant(msg)
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
      return handleChunk(msg)
    }
    if (msg.type === 'SWARM_CHALLENGE') {
      options.receiptRoles.handleChallenge(msg.id, msg.challenge)
      return true
    }
    if (msg.type === 'SWARM_RECEIPT') {
      options.receiptRoles.handleReceipt(msg.id, msg.receipt)
      return true
    }
    return false
  }

  function requestObject(id: string, timeoutMs = 15000, opts: SwarmFetchOptions = {}): Promise<Blob> {
    if (!id || id.length > 256 || (opts.expectedHash && !isSha256Hex(opts.expectedHash))) {
      return Promise.reject(new Error('Invalid swarm object request'))
    }
    const expectedHash = opts.expectedHash?.toLowerCase()
    // Cached bytes are checked synchronously: a fetch never opens the wire
    // for bytes already held, and registration + the WANT send stay
    // synchronous (an inbound chunk must never race the request itself).
    const cached = options.peekLocal?.(id) ?? null
    if (cached) {
      if (!expectedHash) return Promise.resolve(cached)
      // Cached bytes are verified like fetched ones: a stale or corrupted
      // entry is never returned under a hash it does not match.
      return sha256HexBlob(cached).then((actualHash) => {
        if (actualHash === expectedHash) return cached
        throw new Error(`Cached swarm object ${id} failed hash verification`)
      }, () => {
        throw new Error(`Cached swarm object ${id} verification failed`)
      })
    }
    if (options.canSend && !options.canSend()) {
      return Promise.reject(new Error('swarm transport unavailable'))
    }
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
        const pending = pendingFetches.get(id)
        if (pending?.badFrameTimer) {
          clearTimeout(pending.badFrameTimer)
          pending.badFrameTimer = undefined
        }
        pendingFetches.delete(id)
        // Nobody answered: the caller may keep the id on its want list so the
        // next SWARM_HAVE from a peer that holds it can serve us.
        options.onTimeout?.(id)
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
        pendingFetches.set(id, { resolve, reject, timer, chunks: new Map(), receivedBytes: 0, total: 0, mimeType: '', expectedHash, onProgress: opts.onProgress, offer, badIndices: new Set() })
        try {
          options.send({
            type: 'SWARM_WANT',
            id,
            transferId: offer.transferId,
            offerPub: offer.offerPubHex,
            from: options.senderOrbitId?.() || undefined,
          })
        } catch (err) {
          clearTimeout(timer)
          pendingFetches.delete(id)
          reject(err instanceof Error ? err : new Error('swarm send failed'))
        }
      }
      request()
    })
  }

  function cancelObject(id: string): boolean {
    const req = pendingFetches.get(id)
    if (!req) return false
    clearTimeout(req.timer)
    clearBadFrameTimer(req)
    pendingFetches.delete(id)
    req.reject(new Error('swarm fetch cancelled'))
    return true
  }

  return { handleMessage, requestObject, cancelObject, isPending: (id) => pendingFetches.has(id) }
}
