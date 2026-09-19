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

function persistToDisk(id: string, blob: Blob): void {
  // Fire-and-forget: IndexedDB write so seeded bytes survive reload in the
  // packaged app (Chromium storage lives under userData). Must await the
  // ArrayBuffer — storing the Promise itself silently breaks reload reads.
  try {
    void (async () => {
      try {
        const buf = await blob.arrayBuffer()
        if (!buf || buf.byteLength === 0) return
        const { saveObject } = await import('./storage')
        await saveObject({
          id,
          name: id,
          mime_type: blob.type || 'application/octet-stream',
          size_bytes: buf.byteLength,
          owner_id: '',
          sender_pubkey: '',
          sender_enc_pubkey: '',
          created_at: new Date().toISOString(),
          data: buf,
        }).catch(() => {})
      } catch {
        /* storage unavailable (tests/SSR/quota) */
      }
    })()
  } catch {
    /* storage unavailable (tests/SSR) */
  }
}

/** Preload persisted swarm bytes into RAM so a restarted seeder can answer
 *  WANTs without first re-viewing each image. Best-effort, capped. */
export async function hydrateLocalObjects(maxBytes = 256 * 1024 * 1024): Promise<number> {
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

export function registerLocalObject(id: string, blob: Blob): void {
  if (!id || !blob) return
  localObjects.set(id, blob)
  persistToDisk(id, blob)
}

export function hasLocalObject(id: string): boolean {
  return localObjects.has(id)
}

export async function getLocalObject(id: string): Promise<Blob | null> {
  if (!id) return null
  if (localObjects.has(id)) return localObjects.get(id)!

  // Fallback: check Electron vault if available
  if (typeof window !== 'undefined' && window.gmatch?.vaultGet) {
    try {
      const res = await window.gmatch.vaultGet(`local://${id}`)
      if (res?.local) {
        const resp = await fetch(res.local)
        if (resp.ok) {
          const blob = await resp.blob()
          localObjects.set(id, blob)
          return blob
        }
      }
    } catch {
      /* vault read failed */
    }
  }

  // Fallback: IndexedDB (survives reload)
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
}
const pendingFetches = new Map<string, PendingFetch>()

function decodeChunk(dataBase64: string): Uint8Array {
  const binaryStr = atob(dataBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

function finishFetch(id: string, req: PendingFetch): void {
  clearTimeout(req.timer)
  pendingFetches.delete(id)
  const parts: Uint8Array[] = []
  for (let i = 0; i < req.total; i++) {
    const chunk = req.chunks.get(i)
    if (chunk) parts.push(chunk)
  }
  const assembled = new Blob(parts as BlobPart[], { type: req.mimeType || 'application/octet-stream' })
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
    if (req.chunks.size === req.total) finishFetch(msg.id, req)
    return true
  }
  if (msg.type === 'SWARM_HAVE') return true
  return false
}

/** Ask the swarm for an object by id (or content_hash alias). */
export function requestSwarmObject(id: string, timeoutMs = 15000): Promise<Blob> {
  const cached = localObjects.get(id)
  if (cached) return Promise.resolve(cached)
  if (!swarmSend) return Promise.reject(new Error('swarm transport unavailable'))
  const existing = pendingFetches.get(id)
  if (existing) {
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
    pendingFetches.set(id, { resolve, reject, timer, chunks: new Map(), total: 0, mimeType: '' })
    try {
      swarmSend!({ type: 'SWARM_WANT', id })
    } catch (err) {
      clearTimeout(timer)
      pendingFetches.delete(id)
      reject(err instanceof Error ? err : new Error('swarm send failed'))
    }
  })
}

export interface SwarmSessionOptions {
  send: (msg: SwarmMessage) => void
  localStore?: Map<string, Blob>
}

export interface SwarmSession {
  handleMessage: (msg: SwarmMessage) => Promise<void>
  requestObject: (id: string, timeoutMs?: number) => Promise<Blob>
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
        registerLocalObject(msg.id, assembledBlob)
        req.resolve(assembledBlob)
      }
    }
  }

  function requestObject(id: string, timeoutMs = 15000): Promise<Blob> {
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
