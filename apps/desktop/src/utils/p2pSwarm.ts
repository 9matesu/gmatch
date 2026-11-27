/**
 * P2P Swarm over WebRTC DataChannel (zero-upload media).
 *
 * This module is the NODE-LEVEL wiring: the RAM cache, the encrypted disk
 * vault, the want list / HAVE protocol, signed social operations and the
 * session facade. The transfer engine itself — the swarm-v1 offer/key/chunk
 * handshake, chunk authentication, assembly, hash verification, persistence
 * and the receipt state machine — lives in `./swarmEngine` and is shared by
 * the production pipes and every `createSwarmSession` peer.
 */

import {
  validateReplicationReceipt,
  SWARM_MAX_OBJECT_BYTES,
  type ReplicationReceipt,
  type SwarmMessage,
} from '@orbit/protocol'
import {
  createSwarmEngine,
  createSwarmReceiptRoles,
  isSha256Hex,
  sha256HexBlob,
  type SwarmFetchOptions,
  type SwarmReceiptIdentity,
  type SwarmReceiptRoles,
} from './swarmEngine'
import { descriptorUrlFromBytes } from './objectDescriptor'

// The wire contract (the frame shapes and their bounds) lives in
// @orbit/protocol: the node's relay allowlist and this engine read the SAME
// rules, so the two ends cannot disagree about what a frame is.
export type { SwarmMessage } from '@orbit/protocol'
export { createSwarmReceiptRoles, sha256HexBlob } from './swarmEngine'
export type {
  SwarmFetchOptions,
  SwarmReceiptIdentity,
  SwarmReceiptRoles,
  SwarmReceiptRolesOptions,
} from './swarmEngine'

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
const RAM_LIMIT_ENTRIES = 256
const RAM_LIMIT_BYTES = 192 * 1024 * 1024
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
export function __localObjectCacheForTests(): { bytes: number; entries: number; keys: string[] } {
  return { bytes: localObjectBytes, entries: localObjects.size, keys: [...localObjects.keys()] }
}

/**
 * Deletion semantics (roadmap P1): a tombstone is not just a hidden feed row.
 * When a validated `post.delete` names content we hold a replica of, the
 * replica goes too: RAM, the durable store (IndexedDB) and the on-disk vault
 * are purged under that content id. Purging is best-effort and idempotent;
 * what it must NOT be is loud. Best-effort is honest here: the AUTHOR's own
 * delete already dropped their copy; a replica holder that is offline keeps
 * resurfacing no tombstone evidence until the next op wave lands (and the
 * next sweep purges then).
 *
 * After a purge the peer stops answering WANTS for the id: a lookup is a
 * miss, and re-hydration on restart cannot resurrect the bytes (they are not
 * in the store anymore). A re-transfer would need a fresh post.create op —
 * which the authorizer refuses to re-accept for the same objectId.
 */
export async function purgeSwarmObject(id: string): Promise<void> {
  if (!id || typeof id !== 'string' || id.length > 256) return
  forgetLocalObject(id)
  try {
    if (typeof window !== 'undefined' && window.gmatch?.vaultRemove) {
      window.gmatch.vaultRemove(id)
    }
  } catch {
    /* the vault may not know this id; the durable path covers the rest */
  }
  try {
    const { deleteObject } = await import('./storage')
    await deleteObject(id)
  } catch {
    /* already gone or storage unavailable */
  }
}

/** Test seam: drop the RAM cache without touching durability. */
export function __resetLocalObjectCacheForTests(): void {
  localObjects.clear()
  localObjectBytes = 0
}

/** Broadcast by useP2P whenever a peer transitions to online (swarm or
 *  roster). Failed P2P tiles listen for it to retry an offline seeder. */
export const PEER_ONLINE_EVENT = 'orbit-peer-online'

/** Peers seen this session. A best-effort hint: an empty set means "no one to
 *  ask", so a swarm fetch can fail fast instead of waiting out its timeout. */
const onlinePeers = new Set<string>()
export function hasSwarmPeers(): boolean {
  return onlinePeers.size > 0
}

/** Emit PEER_ONLINE_EVENT (no-op outside a browser window). */
export function announcePeerOnline(peerId: string): void {
  if (peerId) onlinePeers.add(peerId)
  try {
    if (typeof window !== 'undefined' && peerId) {
      window.dispatchEvent(new CustomEvent(PEER_ONLINE_EVENT, { detail: { peerId } }))
    }
  } catch {
    /* event bus unavailable (tests/SSR) */
  }
}

/**
 * Broadcast by the receipt roles whenever a NEW durable-custody attestation is
 * recorded for an object we serve. Before this there was no live signal: the
 * receipt landed in an in-memory map that nothing re-read, so the custody
 * count changed silently and a surface showing it would have frozen on its
 * first render. Detail carries the object id.
 */
export const DURABLE_REPLICATION_EVENT = 'orbit-durable-replication'

function emitDurableReplication(id: string): void {
  try {
    if (typeof window !== 'undefined' && id) {
      window.dispatchEvent(new CustomEvent(DURABLE_REPLICATION_EVENT, { detail: { id } }))
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
  // The vault is content-addressed: it only accepts a sha256 hex key
  // (HASH_RE in electron/vault.cjs). Callers may pass a UUID object id,
  // so hash the bytes HERE — a uuid key was silently rejected with
  // bad-hash, which is how an own post lost BOTH its bytes row and its
  // metadata row on the packaged app.
  let hash = ''
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf)
    hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    hash = ''
  }
  // Renderer side: ArrayBuffer crosses IPC cleanly; the main process
  // re-verifies the sha256 before filing it under `id`.
  if (typeof window !== 'undefined' && window.gmatch?.vaultPutBytes && hash) {
    try {
      const result = await window.gmatch.vaultPutBytes(hash, blob.type || 'application/octet-stream', buf)
      if (result?.ok) {
        // The vault holds BYTES only. Without a metadata row the post is
        // invisible after a restart: the gallery rebuild (getAllObjects)
        // never sees it, so an own public post vanished "even for me".
        // Store the row with the vault link as its provider url — the data
        // field carries exactly that URL text, which is the established
        // descriptor-row shape that recoverDescriptorRow repairs on read,
        // so feed AND gallery render from the vault stream with no new
        // render logic.
        const vaultUrl = `vault://f/${result.ref || hash}`
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
            data: new TextEncoder().encode(vaultUrl).buffer as ArrayBuffer,
            source_url: vaultUrl,
            is_public: typeof meta.isPublic === 'boolean' ? (meta.isPublic ? 1 : 0) : null,
            is_story: typeof meta.isStory === 'boolean' ? (meta.isStory ? 1 : 0) : null,
            is_chat: typeof meta.isChat === 'boolean' ? (meta.isChat ? 1 : 0) : null,
            is_avatar: typeof meta.isAvatar === 'boolean' ? (meta.isAvatar ? 1 : 0) : null,
          } as Parameters<typeof saveObject>[0])
        } catch {
          /* metadata row is best-effort; the bytes are already durable */
        }
        return true
      }
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

/**
 * Read verified bytes from the vault (disk) by content hash, else null.
 * Accepts `vault://f/<ref>` descriptors as well as bare hashes.
 */
async function readVaultBlob(id: string): Promise<Blob | null> {
  if (typeof window === 'undefined' || !window.gmatch?.vaultGet) return null
  const ref = id.startsWith('vault://f/') ? id.slice('vault://f/'.length) : id
  if (!ref) return null
  try {
    const res = await window.gmatch.vaultGet(ref)
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

      // A legacy descriptor row stores its provider URL in `data` instead of
      // bytes. If that URL is a vault address, resolve it to real bytes here;
      // otherwise skip it so the descriptor text is never rehydrated as media.
      const descriptorUrl = descriptorUrlFromBytes(data)
      if (descriptorUrl) {
        if (!descriptorUrl.startsWith('vault://f/')) continue
        const ref = descriptorUrl.slice('vault://f/'.length)
        if (used + 74 > maxBytes) continue
        if (!localObjects.has(o.id)) {
          const blob = await readVaultBlob(ref)
          if (blob) {
            localObjects.set(o.id, blob)
            used += blob.size
            count += 1
          }
        }
        continue
      }

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
  if (!id || id.length > 256 || !blob || blob.size === 0 || blob.size > SWARM_MAX_OBJECT_BYTES) return
  rememberLocalObject(id, blob)
  // We hold it now, so it stops being "wanted".
  wantedObjects.delete(id)
  // Durable bytes go to the encrypted vault first (disk). IndexedDB is the
  // dev fallback. Fire-and-forget so hot paths (swarm assembly, forge) are
  // not blocked; the RAM copy is available immediately.
  void persistToVault(id, blob, meta)
}

/** Register and confirm persistence before reporting an object as received. */
async function persistLocalObject(id: string, blob: Blob, meta: LocalObjectMeta = {}): Promise<void> {
  if (!id || !blob || blob.size < 1 || blob.size > SWARM_MAX_OBJECT_BYTES) throw new Error('Invalid local object')
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
    const { getObject, getAllObjects } = await import('./storage')
    let stored = await getObject(id)
    // A legacy magnet btih is the 40-hex PREFIX of the sha256 the row is keyed
    // by. Only a miss pays for the scan, and the store is small.
    if (!stored && /^[0-9a-f]{40}$/i.test(id)) {
      const all = await getAllObjects()
      const hit = all.find((o) => String(o.id).toLowerCase().startsWith(id.toLowerCase()))
      if (hit) stored = hit
    }
    const data = stored?.data as ArrayBuffer | undefined
    if (stored && data && data.byteLength > 0) {
      const descriptorUrl = descriptorUrlFromBytes(data)
      if (descriptorUrl) {
        if (!descriptorUrl.startsWith('vault://f/')) return null
        return await readVaultBlob(descriptorUrl.slice('vault://f/'.length))
      }
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
// relay, and courierSignaling) into one send fan-out; serving peers answer
// WANTs from their local store. This keeps bytes moving peer-to-peer with
// zero server storage.

type SwarmSend = (msg: SwarmMessage) => void
let swarmSend: SwarmSend | null = null

export function setSwarmTransport(send: SwarmSend | null): void {
  swarmSend = send
}

/** Explicit opt-in for the legacy plaintext wire (v0 peers). Off by default. */
let legacyPlaintextServing = false

export function setSwarmLegacyPlaintextEnabled(enabled: boolean): void {
  legacyPlaintextServing = enabled
}

// ---- Receipts: the module singleton's state machine ------------------------

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
    // A new custody attestation landed: tell any surface that shows the
    // custody of this object (the count is otherwise read-once).
    emitDurableReplication(id)
    // Best-effort durable evidence: the session map keeps the receipt either
    // way; a failed write only costs restart survival, never correctness.
    // The distinct-holder list rides the same row (one row per object).
    void (async () => {
      try {
        const { saveSwarmReceipt } = await import('./storage')
        await saveSwarmReceipt({
          objectCid: id,
          receipt: entry.receipt as unknown as Record<string, unknown>,
          confirmedAt: entry.confirmedAt,
          holders: holdersOf(id),
        })
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
    moduleReceiptRoles.note(row.objectCid, { receipt, confirmedAt: row.confirmedAt ?? Date.now() }, row.holders ?? undefined)
    loaded += 1
  }
  return loaded
}

/** Latest valid durable-replication receipt recorded for an object we serve. */
export function getDurableReplication(id: string): { receipt: ReplicationReceipt; confirmedAt: number } | null {
  return moduleReceiptRoles.getDurableReplication(id)
}

/** DISTINCT verified custody identities for an object we serve, plus this
 *  node itself (we hold the bytes we serve — verified by read-back at
 *  serve/accept time, not assumed). Used for replication targeting. */
export function durableCustodyHolders(id: string): number {
  return moduleReceiptRoles.holderCount(id) + 1
}

/** Distinct custody identities (without the implicit self) an object we
 *  serve has receipts from. */
export function holdersOf(id: string): { receiverId: string; confirmedAt: number }[] {
  return moduleReceiptRoles.holdersOf(id)
}

/** Durable-custody holders below the replication target (the objects whose
 *  HAVE advertisement should win when a peer comes online). */
export const SWARM_REPLICATION_TARGET = 3

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

/** Test seam: wipe challenge/receipt state (durable bytes untouched). */
export function __resetReceiptStateForTests(): void {
  moduleReceiptRoles.reset()
  receiptIdentity = null
}

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
  if (localObjects.has(id) || moduleEngine.isPending(id)) return
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
 * Replication-targeting view of a held-id list: ids whose DISTINCT verified
 * custody holders are below the target come first (most recent first within
 * each partition), so a peer that comes online is advertised what actually
 * needs a holder before what is already fully replicated. One identity is
 * never counted twice (the holder map is keyed by receiverId), and the
 * seeder itself counts as one holder.
 */
export function prioritizeUnderReplicated(ids: string[], target = SWARM_REPLICATION_TARGET): string[] {
  const starving: string[] = []
  const fed: string[] = []
  for (const id of ids) {
    if (durableCustodyHolders(id) < target) starving.push(id)
    else fed.push(id)
  }
  return [...starving, ...fed]
}

/**
 * Tell the swarm which objects we can serve. Called when a peer comes online
 * (and after boot hydration), so a peer that failed a fetch learns it can ask
 * us instead of waiting for a broadcast it never saw. The wave is
 * replication-targeting: objects under the custody target are advertised
 * first, so the HAVE-retrigger re-considers exactly what needs a holder.
 */
export function announceHeldObjects(limit = SWARM_HAVE_LIMIT): number {
  if (!swarmSend) return 0
  // The RAM held-cache is bounded, so the full list is small; prioritize the
  // WHOLE held set and only then apply the wave's bounded slice.
  const ids = prioritizeUnderReplicated(heldSwarmObjectIds(SWARM_HAVE_LIMIT))
    .slice(0, Math.max(0, limit))
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
    if (moduleEngine.isPending(raw) || !wantedObjects.has(raw)) continue
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

// ---- The module engine: the production transport context -------------------

/**
 * The production engine. Its `persist` is the vault path (RAM + encrypted
 * disk, awaited — a fetch resolves only once bytes are durable); its
 * `onTimeout` keeps the id on the want list for the next HAVE wave.
 */
const moduleEngine = createSwarmEngine({
  send: (msg) => {
    if (!swarmSend) throw new Error('swarm transport unavailable')
    swarmSend(msg)
  },
  canSend: () => !!swarmSend,
  readLocal: async (id) => lookupLocalObject(id) ?? (await getLocalObject(id)),
  peekLocal: (id) => lookupLocalObject(id),
  persist: (id, blob) => persistLocalObject(id, blob),
  receiptRoles: moduleReceiptRoles,
  senderOrbitId: () => receiptIdentity?.orbitId ?? '',
  legacyPlaintext: () => legacyPlaintextServing,
  onTimeout: (id) => wantSwarmObject(id),
})

/** Route an inbound swarm message. Returns true when consumed. */
export async function handleSwarmMessage(msg: SwarmMessage): Promise<boolean> {
  if (!msg || typeof msg !== 'object') return false
  if (msg.type === 'SWARM_HAVE') {
    fetchWantedFromHave(Array.isArray(msg.ids) ? msg.ids : [])
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
  // WANT / KEY / CHUNK / CHALLENGE / RECEIPT: the shared engine.
  return moduleEngine.handleMessage(msg)
}

/** Ask the swarm for an object by id (or content_hash alias). When
 *  `expectedHash` is given, the assembled bytes must hash to it or the
 *  transfer is rejected (never registered). */
export function requestSwarmObject(id: string, timeoutMs = 15000, opts: SwarmFetchOptions = {}): Promise<Blob> {
  return moduleEngine.requestObject(id, timeoutMs, opts)
}

/** Cancel an in-flight swarm fetch. Partial chunks are dropped, never kept. */
export function cancelSwarmObject(id: string): boolean {
  return moduleEngine.cancelObject(id)
}

// ---- Sessions: isolated engine contexts (harness, tests) -------------------

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

/**
 * A session is the SAME engine as the production pipes, over an isolated
 * transport context: its own store, its own receipt state machine, its own
 * pending-fetch map. There is no second implementation to drift.
 */
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
  const engine = createSwarmEngine({
    send: options.send,
    readLocal: async (id) => sessionStore.get(id) ?? (await getLocalObject(id)),
    peekLocal: (id) => sessionStore.get(id) ?? null,
    persist: async (id, blob) => {
      // The session's store is always updated (the harness durable map may BE
      // the session store); the module RAM cache only when no persist hook
      // owns durability (the legacy fire-and-forget behavior).
      if (options.persist) {
        await options.persist(id, blob)
        sessionStore.set(id, blob)
      } else {
        sessionStore.set(id, blob)
        registerLocalObject(id, blob)
      }
    },
    receiptRoles,
    senderOrbitId: () => options.receiptIdentity?.orbitId ?? '',
    legacyPlaintext: () => !!options.legacyPlaintext,
  })
  return {
    handleMessage: async (msg) => { await engine.handleMessage(msg) },
    requestObject: (id, timeoutMs = 15000, expectedHash) => engine.requestObject(id, timeoutMs, { expectedHash }),
    registerLocalObject: (id, blob) => { sessionStore.set(id, blob) },
    cancelObject: (id) => engine.cancelObject(id),
    receiptRoles,
  }
}
