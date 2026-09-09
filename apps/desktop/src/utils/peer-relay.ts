import Peer, { DataConnection } from 'peerjs'
import { OrbitObject, User } from '@orbit/shared'
import { logger } from './logger';
import { defaultIceConfig } from './ice-hygiene'

export interface P2PPayloadMessage {
  type: 'PRESENCE' | 'IMAGE_ANNOUNCE' | 'MESSAGE' | 'CHAT' | 'STORY_ANNOUNCE'
  user: User
  payload?: OrbitObject
  timestamp: number
}

// Privacy gate: same ICE hygiene as the file-transfer peer (ice-hygiene.ts).
// defaultIceConfig: env TURN forces relay (zero-exposure), otherwise STUN only.
const ICE_CFG = defaultIceConfig(
  typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {},
)

/**
 * Self-hosted PeerServer only (plan P3.5 + no-third-party rule): the bundled
 * app must NEVER dial the public `0.peerjs.com` cloud (it would hand
 * connection metadata — our sanitized ids, timing, peer graph — to a third
 * party nobody chose). When the user has not configured
 * NEXT_PUBLIC_PEERJS_HOST/PORT, this returns undefined and the caller keeps
 * the relay DISABLED: WS swarm + blind courier still carry all traffic
 * (no dead end; the fan-out is simply direct-only).
 */
export interface PeerRelayServer {
  host: string
  port: number
  path: string
  secure: boolean
}

export function peerRelayConfig(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {},
): PeerRelayServer | undefined {
  const host = (env.NEXT_PUBLIC_PEERJS_HOST || peerRelayOverride?.host || '').trim()
  const port = Number(env.NEXT_PUBLIC_PEERJS_PORT || peerRelayOverride?.port || 0)
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  const path = (env.NEXT_PUBLIC_PEERJS_PATH || peerRelayOverride?.path || '').trim() || '/'
  const secure = env.NEXT_PUBLIC_PEERJS_SECURE !== undefined
    ? env.NEXT_PUBLIC_PEERJS_SECURE === '1' || env.NEXT_PUBLIC_PEERJS_SECURE === 'true'
    : (peerRelayOverride ? peerRelayOverride.secure ?? port === 443 : port === 443)
  return { host, port, path, secure }
}

/** Explicit runtime setup (Settings / server-mode UI): never the cloud. */
let peerRelayOverride: Partial<PeerRelayServer> | null = null
export function setPeerRelayServer(cfg: Partial<PeerRelayServer> | null): void {
  peerRelayOverride = cfg
}

export class OrbitPeerRelay {
  private peer: Peer | null = null
  private activeConnections: Map<string, DataConnection> = new Map()
  private lastDialAttempt: Map<string, number> = new Map()
  private lastPoolWarningAt = 0
  public peerId: string = ''

  public onMessage?: (msg: P2PPayloadMessage, fromPeerId: string) => void
  public onPeerConnect?: (peerId: string) => void

  constructor(orbitId: string) {
    if (typeof window === 'undefined') return
    const sanitizedId = `orbit-${orbitId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`
    this.peerId = sanitizedId

    const serverCfg = peerRelayConfig()
    if (!serverCfg) {
      // No self-hosted PeerServer configured: DO NOT dial the public cloud.
      // The relay stays disabled (canDial false) — WS swarm + courier carry
      // everything; direct WebRTC fan-out is opt-in by the user's setup.
      logger.log('[ORBIT PeerJS] relay disabled (no NEXT_PUBLIC_PEERJS_HOST configured; public cloud not dialed)')
      return
    }

    logger.log('[ORBIT PeerJS] Initializing WebRTC PeerJS relay with ID:', sanitizedId, 'via', serverCfg.host)
    try {
      this.peer = new Peer(sanitizedId, {
        host: serverCfg.host,
        port: serverCfg.port,
        path: serverCfg.path,
        secure: serverCfg.secure,
        config: ICE_CFG,
        debug: 0,
      })

      this.peer.on('open', (id) => {
        logger.log('[ORBIT PeerJS] WebRTC peer registered on self-hosted relay! Registered ID:', id)
      })

      this.peer.on('connection', (conn) => {
        logger.log('[ORBIT PeerJS] Direct WebRTC DataChannel connection request from:', conn.peer)
        this.setupConnection(conn)
      })

      this.peer.on('error', (err) => {
        logger.warn('[ORBIT PeerJS] PeerJS relay notice:', err)
      })
    } catch (e) {
      logger.warn('[ORBIT PeerJS] PeerJS initialization exception:', e)
    }
  }

  private setupConnection(conn: DataConnection) {
    const existing = this.activeConnections.get(conn.peer)
    if (existing && existing !== conn) {
      try { existing.close() } catch {}
    }
    this.activeConnections.set(conn.peer, conn)
    this.onPeerConnect?.(conn.peer)

    conn.on('open', () => {
      logger.log('[ORBIT PeerJS] DataChannel OPENED with peer:', conn.peer)
    })

    conn.on('data', (data: any) => {
      logger.log('[ORBIT PeerJS] Received WebRTC P2P DataChannel payload from:', conn.peer, 'Type:', data?.type)
      if (data && this.onMessage) {
        this.onMessage(data as P2PPayloadMessage, conn.peer)
      }
    })

    conn.on('close', () => {
      logger.log('[ORBIT PeerJS] DataChannel closed with peer:', conn.peer)
      this.activeConnections.delete(conn.peer)
    })

    conn.on('error', (err) => {
      logger.warn('[ORBIT PeerJS] DataChannel error with peer:', conn.peer, err)
      this.activeConnections.delete(conn.peer)
    })
  }

  private MAX_CONNECTIONS = 10
  private DIAL_COOLDOWN_MS = 30_000

  public canDial(targetOrbitId: string): boolean {
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) return false
    const targetPeerId = `orbit-${targetOrbitId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`
    if (targetPeerId === this.peerId) return false
    const conn = this.activeConnections.get(targetPeerId)
    if (conn?.open) return true
    const last = this.lastDialAttempt.get(targetPeerId) || 0
    return Date.now() - last >= this.DIAL_COOLDOWN_MS
  }

  public connectAndSend(targetOrbitId: string, msg: P2PPayloadMessage) {
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) return
    const targetPeerId = `orbit-${targetOrbitId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`
    if (targetPeerId === this.peerId) return

    let conn = this.activeConnections.get(targetPeerId)
    if (conn && conn.open) {
      conn.send(msg)
      return
    }

    // Limit concurrent connections to avoid RTCPeerConnection exhaustion
    if (this.activeConnections.size >= this.MAX_CONNECTIONS) {
      const now = Date.now()
      if (now - this.lastPoolWarningAt > 10_000) {
        logger.warn(`[ORBIT PeerJS] Connection pool full (${this.MAX_CONNECTIONS}), skipping direct WebRTC fanout`)
        this.lastPoolWarningAt = now
      }
      return
    }

    const now = Date.now()
    const lastDial = this.lastDialAttempt.get(targetPeerId) || 0
    if (now - lastDial < this.DIAL_COOLDOWN_MS) return
    this.lastDialAttempt.set(targetPeerId, now)

    logger.log('[ORBIT PeerJS] Dialing direct WebRTC P2P DataChannel to target:', targetPeerId)
    conn = this.peer.connect(targetPeerId, { reliable: true })
    if (!conn) return
    this.setupConnection(conn)

    conn.on('open', () => {
      logger.log('[ORBIT PeerJS] Connected! Transmitting P2P payload to:', targetPeerId)
      conn!.send(msg)
    })
  }

  public destroy() {
    for (const conn of this.activeConnections.values()) {
      conn.close()
    }
    this.activeConnections.clear()
    this.peer?.destroy()
    this.peer = null
  }
}
