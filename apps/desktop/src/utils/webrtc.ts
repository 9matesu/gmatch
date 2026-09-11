import { OrbitIdentity } from '@orbit/crypto'
import { orbitFetch } from './api'
import { logger } from './logger';
import { defaultIceConfig, sanitizeCandidate } from './ice-hygiene'

export interface FileMeta {
  name: string
  mime_type: string
  size_bytes: number
  sender_pubkey: string
  sender_enc_pubkey: string
  encrypted: boolean
}

function getIceServers(): RTCIceServer[] {
  // Single privacy gate (ice-hygiene): STUN always; TURN relay-only when set.
  return defaultIceConfig(readTurnEnv()).iceServers as RTCIceServer[]
}

function readTurnEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) return process.env as Record<string, string | undefined>
  if (typeof window !== 'undefined') return (window as any).__ENV ?? {}
  return {}
}

const CHUNK_SIZE = 64 * 1024 // 64KB
const ANSWER_TIMEOUT = 45_000
const CHANNEL_TIMEOUT = 30_000
const ICE_POLL_INTERVAL = 1000
const ICE_POLL_TIMEOUT = 60_000 // stop polling for ICE after 60s

export class OrbitPeer {
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private pendingChunks: Blob[] = []
  private fileMeta: FileMeta | null = null
  private fileSize = 0
  private receivedSize = 0
  private resolveConnect: ((meta: FileMeta) => void) | null = null
  private rejectConnect: ((err: Error) => void) | null = null
  private icePollTimer: ReturnType<typeof setTimeout> | null = null
  private icePollTimeout: ReturnType<typeof setTimeout> | null = null

  onProgress?: (received: number, total: number) => void
  onComplete?: (blob: Blob, meta: FileMeta) => void
  onError?: (err: Error) => void

  private iceServers: RTCIceServer[]

  constructor() {
    this.iceServers = getIceServers()
  }

  async initiate(recipientId: string, identity: OrbitIdentity): Promise<string> {
    logger.log('[ORBIT WebRTC] Initiating peer connection to:', recipientId)
    this.pc = new RTCPeerConnection(defaultIceConfig(readTurnEnv()))
    this.channel = this.pc.createDataChannel('file-transfer')
    this.setupDataChannel(identity)

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    const res = await orbitFetch('/api/signal/initiate', {
      method: 'POST',
      body: JSON.stringify({ offer: this.pc.localDescription, receiver_id: recipientId }),
    }, identity)

    if (!res.ok) {
      logger.warn('[ORBIT WebRTC] Signal initiate endpoint error, operating on client-side swarm fallback.')
      throw new Error('Failed to initiate WebRTC signal')
    }

    const { id: offerId } = await res.json()
    logger.log('[ORBIT WebRTC] WebRTC offer initiated successfully! Offer ID:', offerId)

    this.pc.onicecandidate = async (e) => {
      if (!e.candidate) return
      const safe = sanitizeCandidate(e.candidate.toJSON())
      if (!safe) return // raw-IP candidate — never leaves this machine
      await orbitFetch('/api/signal/ice', {
        method: 'POST',
        body: JSON.stringify({ offer_id: offerId, candidate: safe }),
      }, identity).catch(() => {})
    }

    this.pc.oniceconnectionstatechange = () => {
      logger.log('[ORBIT WebRTC] ICE Connection State:', this.pc?.iceConnectionState)
      if (this.pc?.iceConnectionState === 'failed' || this.pc?.iceConnectionState === 'disconnected') {
        this.onError?.(new Error(`ICE connection ${this.pc.iceConnectionState}`))
      }
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close()
        reject(new Error('Timed out waiting for WebRTC answer signal'))
      }, ANSWER_TIMEOUT)

      const pollAnswer = async () => {
        const res = await orbitFetch(`/api/signal/answer/${offerId}`, {}, identity)
        if (res.status === 404) {
          try {
            const body = await res.json()
            if (body?.error === 'Answer not found') { setTimeout(pollAnswer, 1000); return }
          } catch {}
          this.close(); reject(new Error('Poll answer failed (404)')); return
        }
        clearTimeout(timeout)
        if (!res.ok) { this.close(); reject(new Error('Poll answer failed')); return }
        const { answer } = await res.json()
        if (!answer || !answer.type) {
          const bodyText = await res.text().catch(() => '')
          logger.error('[ORBIT WebRTC] Invalid answer response body:', bodyText.slice(0, 500))
          this.close()
          reject(new Error('Invalid/null WebRTC answer from peer'))
          return
        }
        try {
          logger.log('[ORBIT WebRTC] Received remote answer signal for offer:', offerId)
          await this.pc!.setRemoteDescription(new RTCSessionDescription(answer))
          resolve()
        } catch (err) {
          this.close()
          reject(err instanceof Error ? err : new Error('Failed to set remote description'))
        }
      }
      pollAnswer()
    })

    this.startIcePoll(offerId, identity)
    return offerId
  }

  async sendFile(file: File, identity: OrbitIdentity, _recipientId: string): Promise<void> {
    logger.log('[ORBIT WebRTC] Preparing to stream file over WebRTC DataChannel:', file.name, 'Size:', file.size)
    if (!this.channel || this.channel.readyState !== 'open') {
      await new Promise<void>((resolve, reject) => {
        const startTime = Date.now()
        const check = () => {
          if (this.channel?.readyState === 'open') resolve()
          else if (this.channel?.readyState === 'closed') reject(new Error('DataChannel closed'))
          else if (Date.now() - startTime > CHANNEL_TIMEOUT) reject(new Error('Timed out waiting for DataChannel to open'))
          else setTimeout(check, 100)
        }
        check()
      })
    }

    logger.log('[ORBIT WebRTC] DataChannel open! Streaming file binary chunks P2P...')
    const meta: FileMeta = {
      name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      sender_pubkey: identity.publicKeyHex,
      sender_enc_pubkey: identity.encryptionPubHex || '',
      encrypted: false,
    }
    this.channel!.send(JSON.stringify({ type: 'meta', ...meta }))

    const buffer = await file.arrayBuffer()
    let offset = 0
    while (offset < buffer.byteLength) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE)
      this.channel!.send(chunk)
      offset += CHUNK_SIZE
      this.onProgress?.(offset, buffer.byteLength)
    }
    this.channel!.send(new Uint8Array(0))
    logger.log('[ORBIT WebRTC] Finished streaming P2P file chunks!')
  }

  async acceptOffer(offerId: string, identity: OrbitIdentity): Promise<void> {
    logger.log('[ORBIT WebRTC] Accepting WebRTC offer signal:', offerId)
    let offerRes: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      offerRes = await orbitFetch(`/api/signal/offer/${offerId}`, {}, identity)
      if (offerRes.ok) break
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
    if (!offerRes || !offerRes.ok) throw new Error('[phase:fetch-offer] Failed to fetch WebRTC offer')
    const { offer, sender_id } = await offerRes.json()

    this.pc = new RTCPeerConnection(defaultIceConfig(readTurnEnv()))
    this.pc.ondatachannel = (e) => {
      logger.log('[ORBIT WebRTC] DataChannel established on receiver!')
      this.channel = e.channel
      this.setupDataChannel(identity)
    }
    this.pc.oniceconnectionstatechange = () => {
      logger.log('[ORBIT WebRTC Receiver] ICE Connection State:', this.pc?.iceConnectionState)
      if (this.pc?.iceConnectionState === 'failed' || this.pc?.iceConnectionState === 'disconnected') {
        this.onError?.(new Error(`[phase:ice] ICE connection ${this.pc.iceConnectionState}`))
      }
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)

    const respondRes = await orbitFetch('/api/signal/respond', {
      method: 'POST',
      body: JSON.stringify({ offer_id: offerId, answer: this.pc.localDescription }),
    }, identity)
    if (!respondRes.ok) {
      const body = await respondRes.text()
      throw new Error(`[phase:send-answer] ${respondRes.status} ${body}`)
    }

    this.pc.onicecandidate = async (e) => {
      if (!e.candidate) return
      const safe = sanitizeCandidate(e.candidate.toJSON())
      if (!safe) return // raw-IP candidate — never leaves this machine
      await orbitFetch('/api/signal/ice', {
        method: 'POST',
        body: JSON.stringify({ offer_id: offerId, candidate: safe }),
      }, identity).catch(() => {})
    }

    this.startIcePoll(offerId, identity)
  }

  private setupDataChannel(_identity: OrbitIdentity) {
    if (!this.channel) return
    this.channel.binaryType = 'arraybuffer'

    this.channel.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data)
        if (msg.type === 'meta') {
          logger.log('[ORBIT WebRTC] DataChannel received metadata:', msg.name, 'Size:', msg.size_bytes)
          this.fileMeta = { ...msg }
          this.fileSize = msg.size_bytes
          this.receivedSize = 0
          this.pendingChunks = []
          this.resolveConnect?.(this.fileMeta!)
        }
        return
      }
      const buf = e.data as ArrayBuffer
      if (buf.byteLength === 0) {
        logger.log('[ORBIT WebRTC] DataChannel received EOF chunk. Reassembling complete Blob...')
        const blob = new Blob(this.pendingChunks, { type: this.fileMeta?.mime_type || 'image/jpeg' })
        this.onComplete?.(blob, this.fileMeta!)
        this.pendingChunks = []
        this.receivedSize = 0
        return
      }
      this.pendingChunks.push(new Blob([buf]))
      this.receivedSize += buf.byteLength
      this.onProgress?.(this.receivedSize, this.fileSize)
    }

    this.channel.onerror = (e) => {
      logger.error('[ORBIT WebRTC] DataChannel error:', e)
      this.onError?.(new Error('Data channel error'))
    }
  }

  waitForMeta(): Promise<FileMeta> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close()
        reject(new Error('Timed out waiting for file metadata'))
      }, 30_000)
      this.resolveConnect = (meta) => {
        clearTimeout(timeout)
        resolve(meta)
      }
      this.rejectConnect = (err) => {
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  private startIcePoll(offerId: string, identity: OrbitIdentity) {
    const startTime = Date.now()
    const poll = async () => {
      if (!this.pc) return
      const state = this.pc.iceConnectionState
      if (state === 'connected' || state === 'completed' || state === 'failed' || state === 'disconnected') return
      if (Date.now() - startTime > ICE_POLL_TIMEOUT) return
      const res = await orbitFetch(`/api/signal/ice/${offerId}`, {}, identity)
      if (!res.ok) { this.icePollTimer = setTimeout(poll, ICE_POLL_INTERVAL); return }
      const { candidates } = await res.json()
      if (!this.pc) return
      for (const c of candidates) {
        try { await this.pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
      }
      this.icePollTimer = setTimeout(poll, ICE_POLL_INTERVAL)
    }
    this.icePollTimer = setTimeout(poll, 500)
  }

  close() {
    if (this.icePollTimer) { clearTimeout(this.icePollTimer); this.icePollTimer = null }
    if (this.icePollTimeout) { clearTimeout(this.icePollTimeout); this.icePollTimeout = null }
    this.channel?.close()
    this.pc?.close()
    this.pc = null
    this.channel = null
  }
}

export async function pollOffers(identity: OrbitIdentity): Promise<Array<{ id: string; sender_id: string }>> {
  const res = await orbitFetch('/api/signal/pending', {}, identity)
  if (!res.ok) return []
  const data = await res.json()
  return data.offers || []
}
