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
// defaultIceConfig: env TURN forces relay (zero-exposure), otherwise the
// community relay is added as candidate source without forcing transport.
const ICE_CFG = defaultIceConfig(
  typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {},
)

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

    logger.log('[ORBIT PeerJS] Initializing WebRTC PeerJS relay with ID:', sanitizedId)
    try {
      this.peer = new Peer(sanitizedId, {
        config: ICE_CFG,
        debug: 0,
      })

      this.peer.on('open', (id) => {
        logger.log('[ORBIT PeerJS] WebRTC peer registered on public relay network! Registered ID:', id)
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
