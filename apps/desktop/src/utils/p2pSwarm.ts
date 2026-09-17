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

export function registerLocalObject(id: string, blob: Blob): void {
  if (!id || !blob) return
  localObjects.set(id, blob)
}

export function hasLocalObject(id: string): boolean {
  return localObjects.has(id)
}

export async function getLocalObject(id: string): Promise<Blob | null> {
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

  return null
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
