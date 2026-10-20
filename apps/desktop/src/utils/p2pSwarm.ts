/**
 * P2P Swarm Engine over WebRTC DataChannel (Zero-Fly Media)
 *
 * Peers in a lobby, arena duel, or chat exchange object chunks directly
 * without routing heavy media blobs through the central server.
 */

export type SwarmMessage =
  | { type: 'SWARM_HAVE'; ids: string[] }
  | { type: 'SWARM_WANT'; id: string }
  | {
      type: 'SWARM_CHUNK'
      id: string
      index: number
      total: number
      mimeType: string
      dataBase64: string
    }

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

export async function getLocalObject(id: string): Promise<Blob | null> {
  if (!id) return null
  const inRam = lookupLocalObject(id)
  if (inRam) return inRam

  // Vault (disk, content-addressed): id is the content hash. readVaultBlob
  // verifies the file exists and decrypts it; fetch rehydrates the blob.
  const fromVault = await readVaultBlob(id)
  if (fromVault) {
    rememberLocalObject(id, fromVault)
    return fromVault
  }

  // Fallback: IndexedDB (survives reload; dev-only path)
  try {
    const { getObject } = await import('./storage')
    const stored = await getObject(id)
    const data = stored?.data as ArrayBuffer | undefined
    if (stored && data && data.byteLength > 0) {
      const blob = new Blob([data], { type: stored.mime_type || 'application/octet-stream' })
      rememberLocalObject(id, blob)
      return blob
    }
  } catch {
    /* storage unavailable */
  }

  return null
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
    try {
      const buffer = await blob.arrayBuffer()
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_OBJECT_BYTES) return true
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'
      for (let i = 0; i < totalChunks; i++) {
        const slice = new Uint8Array(buffer.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buffer.byteLength)))
        let binaryStr = ''
        for (let j = 0; j < slice.length; j++) binaryStr += String.fromCharCode(slice[j])
        const frame: SwarmMessage = { type: 'SWARM_CHUNK', id: msg.id, index: i, total: totalChunks, mimeType, dataBase64: btoa(binaryStr) }
        if (!isBoundedChunkFrame(frame)) return true
        swarmSend(frame)
      }
    } catch {
      /* read failed */
    }
    return true
  }
  if (msg.type === 'SWARM_CHUNK') {
    const req = pendingFetches.get(msg.id)
    if (!req) return false
    try {
      if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > MAX_CHUNKS ||
          !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
          typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
          typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > MAX_CHUNK_BASE64_LENGTH || !isBoundedChunkFrame(msg) ||
          (req.total !== 0 && req.total !== msg.total) ||
          (req.mimeType !== '' && req.mimeType !== msg.mimeType) ||
          req.chunks.has(msg.index)) {
        throw new Error('Invalid swarm chunk metadata')
      }
      let bytes: Uint8Array
      try {
        bytes = decodeChunk(msg.dataBase64)
      } catch {
        throw new Error('Invalid swarm chunk encoding')
      }
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
    return sha256HexBlob(cached).then(async (actualHash) => {
      if (actualHash === expectedHash) return cached
      return fetchVerifiedPeerObject(id, timeoutMs, opts, expectedHash)
    }, async () => {
      return fetchVerifiedPeerObject(id, timeoutMs, opts, expectedHash)
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
      pendingFetches.set(id, { resolve, reject, timer, chunks: new Map(), receivedBytes: 0, total: 0, mimeType: '', expectedHash, onProgress: opts.onProgress })
      try { swarmSend!({ type: 'SWARM_WANT', id }) }
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
}

export interface SwarmSession {
  handleMessage: (msg: SwarmMessage) => Promise<void>
  requestObject: (id: string, timeoutMs?: number, expectedHash?: string) => Promise<Blob>
  registerLocalObject: (id: string, blob: Blob) => void
  cancelObject: (id: string) => boolean
}

export function createSwarmSession(options: SwarmSessionOptions): SwarmSession {
  const sessionStore = options.localStore || new Map<string, Blob>()
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
    }
  >()

  async function handleMessage(msg: SwarmMessage): Promise<void> {
    if (msg.type === 'SWARM_WANT') {
      const blob = sessionStore.get(msg.id) || (await getLocalObject(msg.id))
      if (!blob) return

      if (blob.size === 0 || blob.size > MAX_OBJECT_BYTES) return
      const buffer = await blob.arrayBuffer()
      const totalBytes = buffer.byteLength
      const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalBytes)
        const slice = new Uint8Array(buffer.slice(start, end))

        // Convert slice to base64
        let binaryStr = ''
        for (let j = 0; j < slice.length; j++) {
          binaryStr += String.fromCharCode(slice[j])
        }
        const dataBase64 = btoa(binaryStr)

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
      return
    }

    if (msg.type === 'SWARM_CHUNK') {
      const req = pendingRequests.get(msg.id)
      if (!req) return

      let bytes: Uint8Array
      try {
        if (!Number.isSafeInteger(msg.total) || msg.total < 1 || msg.total > MAX_CHUNKS ||
            !Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index >= msg.total ||
            typeof msg.mimeType !== 'string' || msg.mimeType.length > 128 ||
            typeof msg.dataBase64 !== 'string' || msg.dataBase64.length > MAX_CHUNK_BASE64_LENGTH || !isBoundedChunkFrame(msg) ||
            (req.total !== 0 && req.total !== msg.total) ||
            (req.mimeType !== '' && req.mimeType !== msg.mimeType) || req.chunks.has(msg.index)) {
          throw new Error('Invalid swarm chunk metadata')
        }
        bytes = decodeChunk(msg.dataBase64)
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
          void sha256HexBlob(assembledBlob).then((got) => {
            if (pendingRequests.get(msg.id) !== req) return
            if (got !== req.expectedHash) {
              clearTimeout(req.timer)
              pendingRequests.delete(msg.id)
              req.reject(new Error(`Swarm object ${msg.id} failed hash verification`))
              return
            }
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            registerLocalObject(msg.id, assembledBlob)
            req.resolve(assembledBlob)
          }).catch(() => {
            if (pendingRequests.get(msg.id) !== req) return
            clearTimeout(req.timer)
            pendingRequests.delete(msg.id)
            req.reject(new Error(`Swarm object ${msg.id} verification failed`))
          })
        } else {
          if (pendingRequests.get(msg.id) !== req) return
          clearTimeout(req.timer)
          pendingRequests.delete(msg.id)
          registerLocalObject(msg.id, assembledBlob)
          req.resolve(assembledBlob)
        }
      }
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

      pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        chunks: new Map(),
        receivedBytes: 0,
        total: 0,
        mimeType: '',
        expectedHash,
      })

      try {
        options.send({ type: 'SWARM_WANT', id })
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
