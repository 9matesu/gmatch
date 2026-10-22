import type { OrbitIdentity } from '@orbit/crypto'
import {
  seal1to1,
  deliveryToken,
  type OpenedEnvelope,
} from '@orbit/protocol'
import { getApiBaseUrl } from './api'
import { defaultIceConfig, sanitizeCandidate } from './ice-hygiene'
import { peerNodeFor } from './peerNodes'
import { logger } from './logger'

function readTurnEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) return process.env as Record<string, string | undefined>
  if (typeof window !== 'undefined') return (window as unknown as { __ENV?: Record<string, string | undefined> }).__ENV ?? {}
  return {}
}

export type CourierSignalPayload =
  | {
      type: 'offer'
      sessionId: string
      fromOrbitId: string
      fromPubKeyHex: string
      fromEncPubHex: string
      sdp: RTCSessionDescriptionInit
    }
  | {
      type: 'answer'
      sessionId: string
      fromOrbitId: string
      fromPubKeyHex: string
      fromEncPubHex: string
      sdp: RTCSessionDescriptionInit
    }
  | {
      type: 'ice'
      sessionId: string
      fromOrbitId: string
      candidate: RTCIceCandidateInit
    }

export interface PeerMeshConnection {
  peerOrbitId: string
  pc: RTCPeerConnection
  channel: RTCDataChannel
  send: (data: string | ArrayBuffer) => void
  close: () => void
}

const activeMeshPeers = new Map<string, PeerMeshConnection>()
const pendingSessions = new Map<string, {
  pc: RTCPeerConnection
  channel?: RTCDataChannel
  resolveChannel?: (ch: RTCDataChannel) => void
  rejectChannel?: (err: Error) => void
}>()

export function getActiveMeshPeers(): Map<string, PeerMeshConnection> {
  return activeMeshPeers
}

export type MeshMessageHandler = (data: string, fromPeerId: string) => void
const meshMessageHandlers = new Set<MeshMessageHandler>()

export function onMeshMessage(handler: MeshMessageHandler): () => void {
  meshMessageHandlers.add(handler)
  return () => {
    meshMessageHandlers.delete(handler)
  }
}

function dispatchMeshMessage(data: string, fromPeerId: string): void {
  for (const handler of meshMessageHandlers) {
    try {
      handler(data, fromPeerId)
    } catch (err) {
      logger.warn('[Mesh] Error in mesh message handler:', err)
    }
  }
}

export function broadcastMeshFrame(data: string): void {
  for (const conn of activeMeshPeers.values()) {
    if (conn.channel.readyState === 'open') {
      try {
        conn.channel.send(data)
      } catch (err) {
        logger.warn('[Mesh] Error sending frame to peer:', conn.peerOrbitId, err)
      }
    }
  }
}

/**
 * Sends a sealed WebRTC signaling envelope to a peer's delivery token on the courier.
 */
export async function sendCourierSignal(
  recipientPubKeyHex: string,
  recipientEncPubHex: string,
  payload: CourierSignalPayload,
  identity: OrbitIdentity,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  opts?: { base?: string },
): Promise<boolean> {
  const token = deliveryToken(recipientPubKeyHex)
  const env = seal1to1(
    JSON.stringify(payload),
    'signal',
    {
      privateKeyHex: identity.privateKeyHex,
      publicKeyHex: identity.publicKeyHex,
      encryptionPrivHex: identity.encryptionPrivHex || '',
      encryptionPubHex: identity.encryptionPubHex || '',
    },
    {
      publicKeyHex: recipientPubKeyHex,
      encryptionPubHex: recipientEncPubHex,
    },
    { to: token, exp: Date.now() + 60_000 },
  )

  try {
    // The recipient's mailbox is on the node THEY are connected to: a peer on
    // another node gets the signal there, not on ours.
    const base = (opts?.base || getApiBaseUrl()).replace(/\/+$/, '')
    const url = `${base}/api/mail/${token}`
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Handles an inbound signal envelope received through the courier mail channel.
 */
export async function handleInboundSignal(
  opened: OpenedEnvelope,
  identity: OrbitIdentity,
  onNewConnection?: (conn: PeerMeshConnection) => void,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  if (opened.kind !== 'signal') return false

  let payload: CourierSignalPayload
  try {
    payload = JSON.parse(opened.body)
  } catch {
    return false
  }

  if (payload.type === 'offer') {
    // Inbound connection request: respond with an SDP Answer
    const sessionId = payload.sessionId
    const pc = new RTCPeerConnection(defaultIceConfig(readTurnEnv()))

    let dataChannel: RTCDataChannel | null = null

    pc.ondatachannel = (e) => {
      dataChannel = e.channel
      dataChannel.onopen = () => {
        logger.log('[Mesh] DataChannel opened with peer:', payload.fromOrbitId)
        const conn: PeerMeshConnection = {
          peerOrbitId: payload.fromOrbitId,
          pc,
          channel: dataChannel!,
          send: (d) => dataChannel!.send(d as any),
          close: () => {
            pc.close()
            activeMeshPeers.delete(payload.fromOrbitId)
          },
        }
        activeMeshPeers.set(payload.fromOrbitId, conn)
        onNewConnection?.(conn)
      }
      dataChannel.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
        dispatchMeshMessage(data, payload.fromOrbitId)
      }
      dataChannel.onclose = () => {
        activeMeshPeers.delete(payload.fromOrbitId)
      }
    }

    // The sender lives on its own node: answer and ICE go there.
    const senderBase = peerNodeFor(payload.fromOrbitId)
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const safe = sanitizeCandidate(e.candidate.toJSON())
      if (!safe) return
      void sendCourierSignal(
        payload.fromPubKeyHex,
        payload.fromEncPubHex,
        {
          type: 'ice',
          sessionId,
          fromOrbitId: identity.orbitId,
          candidate: safe,
        },
        identity,
        fetchImpl,
        { base: senderBase || undefined },
      )
    }

    pendingSessions.set(sessionId, { pc })

    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    await sendCourierSignal(
      payload.fromPubKeyHex,
      payload.fromEncPubHex,
      {
        type: 'answer',
        sessionId,
        fromOrbitId: identity.orbitId,
        fromPubKeyHex: identity.publicKeyHex,
        fromEncPubHex: identity.encryptionPubHex || '',
        sdp: answer,
      },
      identity,
      fetchImpl,
      { base: senderBase || undefined },
    )
    return true
  }

  if (payload.type === 'answer') {
    const session = pendingSessions.get(payload.sessionId)
    if (!session) return false
    try {
      await session.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      return true
    } catch (err) {
      logger.warn('[Mesh] Error setting remote description from answer:', err)
      return false
    }
  }

  if (payload.type === 'ice') {
    const session = pendingSessions.get(payload.sessionId)
    if (!session) return false
    try {
      await session.pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      return true
    } catch {
      return false
    }
  }

  return false
}

/**
 * Initiates a direct P2P WebRTC DataChannel connection to a peer via courier mailbox signaling.
 */
export async function connectToPeerMesh(
  peer: { id: string; public_key: string; encryption_pub_key?: string },
  identity: OrbitIdentity,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 30000,
): Promise<PeerMeshConnection> {
  const existing = activeMeshPeers.get(peer.id)
  if (existing && existing.channel.readyState === 'open') {
    return existing
  }

  if (!peer.encryption_pub_key) {
    throw new Error('Peer has no encryption public key for signaling')
  }

  const pc = new RTCPeerConnection(defaultIceConfig(readTurnEnv()))
  const channel = pc.createDataChannel('gmatch-mesh')
  const sessionId = `${identity.orbitId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  // A peer on another node: the signal goes to THEIR courier.
  const peerBase = peerNodeFor(peer.id)

  return new Promise<PeerMeshConnection>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSessions.delete(sessionId)
      pc.close()
      reject(new Error(`Timed out connecting to peer ${peer.id}`))
    }, timeoutMs)

    channel.onopen = () => {
      clearTimeout(timer)
      pendingSessions.delete(sessionId)
      logger.log('[Mesh] Outbound DataChannel connected to peer:', peer.id)
      const conn: PeerMeshConnection = {
        peerOrbitId: peer.id,
        pc,
        channel,
        send: (d) => channel.send(d as any),
        close: () => {
          pc.close()
          activeMeshPeers.delete(peer.id)
        },
      }
      activeMeshPeers.set(peer.id, conn)
      resolve(conn)
    }

    channel.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
      dispatchMeshMessage(data, peer.id)
    }

    channel.onclose = () => {
      activeMeshPeers.delete(peer.id)
    }

    channel.onerror = (e) => {
      logger.warn('[Mesh] Channel error with peer:', peer.id, e)
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const safe = sanitizeCandidate(e.candidate.toJSON())
      if (!safe) return
      void sendCourierSignal(
        peer.public_key,
        peer.encryption_pub_key!,
        {
          type: 'ice',
          sessionId,
          fromOrbitId: identity.orbitId,
          candidate: safe,
        },
        identity,
        fetchImpl,
        { base: peerBase || undefined },
      )
    }

    pendingSessions.set(sessionId, { pc, channel })

    void (async () => {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await sendCourierSignal(
          peer.public_key,
          peer.encryption_pub_key!,
          {
            type: 'offer',
            sessionId,
            fromOrbitId: identity.orbitId,
            fromPubKeyHex: identity.publicKeyHex,
            fromEncPubHex: identity.encryptionPubHex || '',
            sdp: offer,
          },
          identity,
          fetchImpl,
          { base: peerBase || undefined },
        )
      } catch (err) {
        clearTimeout(timer)
        pendingSessions.delete(sessionId)
        pc.close()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })
}
