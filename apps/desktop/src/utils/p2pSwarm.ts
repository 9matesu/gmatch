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

const localObjects = new Map<string, Blob>()
const CHUNK_SIZE = 64 * 1024 // 64KB per WebRTC DataChannel chunk

/** SHA-256 hex of a blob's bytes (Web Crypto). Used to VERIFY reassembled
 *  swarm media against the object's content_hash before accepting it —
 *  a peer's chunk stream is not proof the bytes are the real object. */
export async function sha256HexBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
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

async function persistToVault(id: string, blob: Blob, meta: LocalObjectMeta = {}): Promise<void> {
  // arrayBuffer() is not available on every Blob implementation (e.g. jsdom).
  // When it is missing, the RAM copy is still registered; disk persistence is
  // best-effort and must never throw.
  let buf: ArrayBuffer | null = null
  try {
    buf = await blob.arrayBuffer()
  } catch {
    /* arrayBuffer unavailable — skip durable write, RAM copy stands */
  }
  if (!buf || buf.byteLength === 0) return
  // Renderer side: ArrayBuffer crosses IPC cleanly; the main process
  // re-verifies the sha256 before filing it under `id`.
  if (typeof window !== 'undefined' && window.gmatch?.vaultPutBytes) {
    try {
      await window.gmatch.vaultPutBytes(id, blob.type || 'application/octet-stream', buf)
      return // durable on disk; nothing more to do
    } catch {
      /* fall through to IndexedDB fallback below */
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
    }).catch(() => {})
  } catch {
    /* storage unavailable (tests/SSR/quota) */
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
 *  WANTs without first re-viewing each image. Best-effort, capped. */
export async function hydrateLocalObjects(maxBytes = 256 * 1024 * 1024): Promise<number> {
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
    const { getAllObjects } = await import('./storage')
    const all = await getAllObjects()
    let used = 0
    let count = 0
    for (const o of all) {
      const data = o?.data as ArrayBuffer | undefined
      if (!o?.id || !data || !(data instanceof ArrayBuffer) || data.byteLength === 0) continue
      if (used + data.byteLength > maxBytes) break
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
  if (!id || !blob) return
  localObjects.set(id, blob)
  // Durable bytes go to the encrypted vault first (disk). IndexedDB is the
  // dev fallback. Fire-and-forget so hot paths (swarm assembly, forge) are
  // not blocked; the RAM copy is available immediately.
  void persistToVault(id, blob, meta)
}

export function hasLocalObject(id: string): boolean {
  return localObjects.has(id)
}

export async function getLocalObject(id: string): Promise<Blob | null> {
  if (!id) return null
  if (localObjects.has(id)) return localObjects.get(id)!

  // Vault (disk, content-addressed): id is the content hash. readVaultBlob
  // verifies the file exists and decrypts it; fetch rehydrates the blob.
  const fromVault = await readVaultBlob(id)
  if (fromVault) {
    localObjects.set(id, fromVault)
    return fromVault
  }

  // Fallback: IndexedDB (survives reload; dev-only path)
  try {
    const { getObject } = await import('./storage')
    const stored = await getObject(id)
    const data = stored?.data as ArrayBuffer | undefined
    if (stored && data && data.byteLength > 0) {
      const blob = new Blob([data], { type: stored.mime_type || 'application/octet-stream' })
      localObjects.set(id, blob)
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
  total: number
  mimeType: string
  expectedHash?: string
  onProgress?: (received: number, total: number) => void
}
const pendingFetches = new Map<string, PendingFetch>()

function decodeChunk(dataBase64: string): Uint8Array {
  const binaryStr = atob(dataBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function finishFetch(id: string, req: PendingFetch): Promise<void> {
  clearTimeout(req.timer)
  pendingFetches.delete(id)
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
    void sha256HexBlob(assembled).then((got) => {
      if (got !== req.expectedHash) {
        req.reject(new Error(`Swarm object ${id} failed hash verification`))
        return
      }
      registerLocalObject(id, assembled)
      req.resolve(assembled)
    }).catch(() => req.reject(new Error(`Swarm object ${id} verification failed`)))
    return
  }
  registerLocalObject(id, assembled)
  req.resolve(assembled)
}

/** Route an inbound swarm message. Returns true when consumed. */
export async function handleSwarmMessage(msg: SwarmMessage): Promise<boolean> {
  if (!msg || typeof msg !== 'object') return false
  if (msg.type === 'SWARM_WANT') {
    const blob = localObjects.get(msg.id) || (await getLocalObject(msg.id))
    if (!blob || !swarmSend) return true
    try {
      const buffer = await blob.arrayBuffer()
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1
      const mimeType = blob.type || 'application/octet-stream'
      for (let i = 0; i < totalChunks; i++) {
        const slice = new Uint8Array(buffer.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buffer.byteLength)))
        let binaryStr = ''
        for (let j = 0; j < slice.length; j++) binaryStr += String.fromCharCode(slice[j])
        swarmSend({ type: 'SWARM_CHUNK', id: msg.id, index: i, total: totalChunks, mimeType, dataBase64: btoa(binaryStr) })
      }
    } catch {
      /* read failed */
    }
    return true
  }
  if (msg.type === 'SWARM_CHUNK') {
    const req = pendingFetches.get(msg.id)
    if (!req) return false
    req.chunks.set(msg.index, decodeChunk(msg.dataBase64))
    req.total = msg.total
    req.mimeType = msg.mimeType
    try {
      req.onProgress?.(req.chunks.size, req.total)
    } catch {
      /* progress listener must never break assembly */
    }
    if (req.chunks.size === req.total) void finishFetch(msg.id, req)
    return true
  }
  if (msg.type === 'SWARM_HAVE') return true
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
  const cached = localObjects.get(id)
  if (cached) return Promise.resolve(cached)
  if (!swarmSend) return Promise.reject(new Error('swarm transport unavailable'))
  const existing = pendingFetches.get(id)
  if (existing) {
    // A second waiter joins the in-flight fetch and shares its integrity
    // contract: it may add an expectation, never contradict one.
    if (opts.expectedHash) {
      if (existing.expectedHash && existing.expectedHash !== opts.expectedHash) {
        return Promise.reject(new Error(`Swarm object ${id} requested with conflicting hashes`))
      }
      existing.expectedHash = opts.expectedHash
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
      reject(new Error(`Timed out waiting for swarm object ${id}`))
    }, timeoutMs)
    pendingFetches.set(id, { resolve, reject, timer, chunks: new Map(), total: 0, mimeType: '', expectedHash: opts.expectedHash, onProgress: opts.onProgress })
    try {
      swarmSend!({ type: 'SWARM_WANT', id })
    } catch (err) {
      clearTimeout(timer)
      pendingFetches.delete(id)
      reject(err instanceof Error ? err : new Error('swarm send failed'))
    }
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
      mimeType: string
      expectedHash?: string
    }
  >()

  async function handleMessage(msg: SwarmMessage): Promise<void> {
    if (msg.type === 'SWARM_WANT') {
      const blob = sessionStore.get(msg.id) || (await getLocalObject(msg.id))
      if (!blob) return

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

        options.send({
          type: 'SWARM_CHUNK',
          id: msg.id,
          index: i,
          total: totalChunks,
          mimeType,
          dataBase64,
        })
      }
      return
    }

    if (msg.type === 'SWARM_CHUNK') {
      const req = pendingRequests.get(msg.id)
      if (!req) return

      // Decode base64 chunk
      const binaryStr = atob(msg.dataBase64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }

      req.chunks.set(msg.index, bytes)
      req.total = msg.total
      req.mimeType = msg.mimeType

      if (req.chunks.size === req.total) {
        clearTimeout(req.timer)
        pendingRequests.delete(msg.id)

        // Assemble all chunks in order
        const parts: Uint8Array[] = []
        for (let i = 0; i < req.total; i++) {
          const chunk = req.chunks.get(i)
          if (chunk) parts.push(chunk)
        }

        const assembledBlob = new Blob(parts as BlobPart[], { type: req.mimeType })
        if (req.expectedHash) {
          void sha256HexBlob(assembledBlob).then((got) => {
            if (got !== req.expectedHash) {
              req.reject(new Error(`Swarm object ${msg.id} failed hash verification`))
              return
            }
            registerLocalObject(msg.id, assembledBlob)
            req.resolve(assembledBlob)
          }).catch(() => req.reject(new Error(`Swarm object ${msg.id} verification failed`)))
        } else {
          registerLocalObject(msg.id, assembledBlob)
          req.resolve(assembledBlob)
        }
      }
    }
  }

  function requestObject(id: string, timeoutMs = 15000, expectedHash?: string): Promise<Blob> {
    // Immediate local session hit
    if (sessionStore.has(id)) {
      return Promise.resolve(sessionStore.get(id)!)
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
        total: 0,
        mimeType: '',
        expectedHash,
      })

      options.send({ type: 'SWARM_WANT', id })
    })
  }

  return {
    handleMessage,
    requestObject,
    registerLocalObject: (id: string, blob: Blob) => sessionStore.set(id, blob),
  }
}
