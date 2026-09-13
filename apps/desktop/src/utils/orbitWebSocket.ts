import { orbitFetch, getApiBaseUrl, getApiWebSocketUrl } from './api'

interface OrbitIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPubHex?: string
}

type Listener = (message: any) => void

let activeIdentity: string | null = null
let socket: WebSocket | null = null
let connectPromise: Promise<void> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0
let reconnectDelay = 1000
let closeTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function closeSocket() {
  clearReconnect()
  const current = socket
  socket = null
  if (current) {
    current.onopen = null
    current.onmessage = null
    current.onerror = null
    current.onclose = null
    current.close()
  }
}

async function connect(identity: OrbitIdentity, expectedGeneration: number): Promise<void> {
  if (expectedGeneration !== generation || activeIdentity !== identity.orbitId || listeners.size === 0) return
  const ticketRes = await orbitFetch('/api/ws-ticket', { method: 'POST' }, identity)
  if (!ticketRes.ok) throw new Error(`WebSocket ticket failed: ${ticketRes.status}`)
  const body = await ticketRes.json() as { ticket?: string }
  if (!body.ticket || expectedGeneration !== generation || activeIdentity !== identity.orbitId || listeners.size === 0) return

  const url = getApiWebSocketUrl('/api/ws')
  const next = new WebSocket(url)
  socket = next

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let authenticated = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    next.onopen = () => {
      if (expectedGeneration !== generation || socket !== next) {
        next.close()
        finish(new Error('Stale websocket generation'))
        return
      }
      next.send(JSON.stringify({ type: 'auth', ticket: body.ticket }))
      reconnectDelay = 1000
      finish()
    }
    next.onmessage = (event) => {
      let message: any
      try { message = JSON.parse(event.data) } catch { return }
      if (message?.type === 'auth_ack') {
        if (!message.ok) {
          next.close()
          return
        }
        authenticated = true
        next.send(JSON.stringify({ type: 'subscribe', rooms: ['lobby', 'global'] }))
        return
      }
      if (!authenticated) return
      for (const listener of listeners) listener(message)
    }
    next.onerror = () => finish(new Error('WebSocket connection failed'))
    next.onclose = () => {
      if (!settled) finish(new Error('WebSocket closed before opening'))
      if (socket !== next || expectedGeneration !== generation || listeners.size === 0) return
      socket = null
      clearReconnect()
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connectPromise = connect(identity, expectedGeneration).catch(() => {
          connectPromise = null
          if (socket === null && listeners.size > 0 && expectedGeneration === generation) {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null
              void ensureConnected(identity, expectedGeneration)
            }, reconnectDelay)
          }
        })
      }, reconnectDelay)
    }
  })
}

async function ensureConnected(identity: OrbitIdentity, expectedGeneration: number) {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  if (connectPromise) return connectPromise
  connectPromise = connect(identity, expectedGeneration).catch((error) => {
    connectPromise = null
    if (listeners.size > 0 && expectedGeneration === generation) {
      clearReconnect()
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void ensureConnected(identity, expectedGeneration)
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    }
    throw error
  }).finally(() => {
    connectPromise = null
  })
  return connectPromise
}

export function subscribeOrbitWebSocket(identity: OrbitIdentity, listener: Listener) {
  if (activeIdentity !== identity.orbitId) {
    generation += 1
    activeIdentity = identity.orbitId
    closeSocket()
  }
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
  listeners.add(listener)
  void ensureConnected(identity, generation).catch(() => {})

  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    closeTimer = setTimeout(() => {
      if (listeners.size > 0) return
      generation += 1
      activeIdentity = null
      closeSocket()
      connectPromise = null
    }, 1000)
  }
}

export function sendOrbitWebSocket(message: unknown): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}
