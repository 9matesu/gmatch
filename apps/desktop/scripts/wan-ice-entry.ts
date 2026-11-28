/**
 * Browser-side real-ICE proof (loaded into TWO Playwright pages).
 *
 * This is the BROWSER twin of `p2p-worker.ts`: it runs the REAL production
 * wire primitives — `peerConnectionConfig(null)` (direct-first with Google
 * primary + Cloudflare fallback STUN, the production posture), `createSocialOperation` /
 * `validateSocialOperation` (the signed post.create), `seal1to1` / `open1to1`
 * + `encodeDmBody` / `decodeBody` (the sealed DM) and `sha256HexBlob`
 * (content verification) — over a genuine `RTCPeerConnection` DataChannel.
 * Nothing here is a mock: the bytes that cross the channel are the same frames
 * the swarm carries in production.
 *
 * 1.7.3 ships TWO free STUN servers (Google primary, Cloudflare fallback) and
 * no baked TURN: the direct path is host/srflx candidates (mDNS, global IPv6,
 * Radmin). `peerConnectionConfig(null)` is exactly that default — no forced
 * relay, a TURN is appended only when explicitly configured.
 *
 * esbuild bundles this (platform=browser) and the driver (`wan-ice.mjs`)
 * loads it into two isolated browser contexts and relays only the SDP.
 */
import { generateIdentity } from '@orbit/crypto'
import { createSocialOperation, validateSocialOperation, seal1to1, open1to1, contentManifestHash } from '@orbit/protocol'
import { peerConnectionConfig } from '../src/utils/ice-hygiene'
import { encodeDmBody, encodeAckBody, decodeBody } from '../src/utils/mail-dm'
import { sha256HexBlob } from '../src/utils/swarmEngine'

const IDENTITY = generateIdentity()

// Production posture: Google + Cloudflare STUN host/srflx direct path, no forced relay.
const CONFIG = peerConnectionConfig(null)

let pc: RTCPeerConnection | null = null
let dc: RTCDataChannel | null = null
const inbox: unknown[] = []
const waiters: Array<{ predicate: (m: unknown) => boolean; resolve: (m: unknown) => void; timer: number }> = []

function deliver(msg: unknown): void {
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    if (waiters[i].predicate(msg)) {
      const { resolve, timer } = waiters[i]
      clearTimeout(timer)
      waiters.splice(i, 1)
      resolve(msg)
      return
    }
  }
  inbox.push(msg)
  if (inbox.length > 64) inbox.shift()
}

function take(predicate: (m: unknown) => boolean, timeoutMs: number): Promise<unknown | null> {
  const existing = inbox.findIndex(predicate)
  if (existing >= 0) return Promise.resolve(inbox.splice(existing, 1)[0])
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex((w) => w.resolve === resolve)
      if (i >= 0) waiters.splice(i, 1)
      resolve(null)
    }, timeoutMs)
    waiters.push({ predicate, resolve, timer })
  })
}

function wireChannel(channel: RTCDataChannel): void {
  dc = channel
  channel.addEventListener('message', (event) => {
    try {
      deliver(JSON.parse(String(event.data)))
    } catch {
      /* non-JSON frame */
    }
  })
}

function send(msg: unknown): void {
  if (!dc || dc.readyState !== 'open') throw new Error('data channel not open')
  dc.send(JSON.stringify(msg))
}

// ---- the API the driver calls (one page = one peer) -----------------------
const api = {
  identity: () => ({
    orbitId: IDENTITY.orbitId,
    publicKeyHex: IDENTITY.publicKeyHex,
    encryptionPubHex: IDENTITY.encryptionPubHex,
  }),
  config: () => ({ iceTransportPolicy: (CONFIG as RTCConfiguration).iceTransportPolicy ?? null, iceServers: (CONFIG.iceServers || []).map((s) => s.urls) }),
  state: () => ({
    ice: pc?.iceConnectionState ?? null,
    conn: pc?.connectionState ?? null,
    gather: pc?.iceGatheringState ?? null,
    localSdp: pc?.localDescription?.sdp ?? '',
  }),

  async createOffer(): Promise<string> {
    pc = new RTCPeerConnection(CONFIG)
    wireChannel(pc.createDataChannel('gmatch-swarm'))
    await pc.setLocalDescription(await pc.createOffer())
    await waitIce(pc)
    return pc.localDescription?.sdp ?? ''
  },
  async acceptOffer(sdp: string): Promise<string> {
    pc = new RTCPeerConnection(CONFIG)
    pc.ondatachannel = (event) => wireChannel(event.channel)
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await pc.setLocalDescription(await pc.createAnswer())
    await waitIce(pc)
    return pc.localDescription?.sdp ?? ''
  },
  async applyAnswer(sdp: string): Promise<void> {
    if (!pc) throw new Error('no offer pending')
    await pc.setRemoteDescription({ type: 'answer', sdp })
  },
  async waitOpen(timeoutMs: number): Promise<boolean> {
    if (dc?.readyState === 'open') return true
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        clearInterval(poll)
        clearTimeout(timer)
        resolve(v)
      }
      const poll = setInterval(() => { if (dc?.readyState === 'open') done(true) }, 100)
      const timer = setTimeout(() => done(false), timeoutMs)
    })
  },

  // (a) signed post.create — the REAL production signer.
  signPost(input: { objectId: string; contentCid: string; mimeType: string; sizeBytes: number }) {
    // Same manifest binding as production publishSignedPostOperation.
    const manifestHash = contentManifestHash({
      ownerId: IDENTITY.orbitId,
      contentCid: input.contentCid,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    })
    return createSocialOperation({
      protocol: 'gmatch-social',
      version: 1,
      type: 'post.create',
      actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex,
      actorSequence: 1,
      previousOperationId: null,
      createdAt: Date.now(),
      objectId: input.objectId,
      payload: { contentCid: input.contentCid, manifestHash, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    }, IDENTITY.privateKeyHex)
  },
  sendOp(operation: unknown): void {
    send({ type: 'SWARM_OP', operation })
  },
  async recvOp(timeoutMs: number) {
    const frame = await take((m) => (m as { type?: string })?.type === 'SWARM_OP', timeoutMs) as { type: string; operation: unknown } | null
    if (!frame) return null
    // The REAL production validator: signature + actor/key binding + payload.
    const error = validateSocialOperation(frame.operation)
    const op = frame.operation as { actorId: string; objectId: string; payload?: { contentCid?: string } }
    return { ok: !error, error, actorId: op.actorId, objectId: op.objectId, contentCid: op.payload?.contentCid }
  },

  // (b) media as real SWARM_CHUNK frames, reassembled + sha256-verified.
  sendMedia(id: string, base64: string, mimeType: string): void {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const total = Math.max(1, Math.ceil(bytes.length / 4096))
    for (let index = 0; index < total; index += 1) {
      const slice = bytes.subarray(index * 4096, (index + 1) * 4096)
      send({ type: 'SWARM_CHUNK', id, index, total, mimeType, dataBase64: btoa(String.fromCharCode(...slice)) })
    }
  },
  async recvMedia(id: string, timeoutMs: number) {
    const chunks = new Map<number, Uint8Array>()
    let total = 0
    let mime = 'application/octet-stream'
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = await take((m) => (m as { type?: string })?.type === 'SWARM_CHUNK' && (m as { id?: string }).id === id, Math.max(1, deadline - Date.now())) as { index: number; total: number; mimeType: string; dataBase64: string } | null
      if (!frame) break
      total = frame.total
      mime = frame.mimeType
      chunks.set(frame.index, Uint8Array.from(atob(frame.dataBase64), (c) => c.charCodeAt(0)))
      if (chunks.size === total) break
    }
    if (total === 0 || chunks.size !== total) return { ok: false, error: `incomplete (${chunks.size}/${total})` }
    // Sum the ACTUAL chunk lengths — the last chunk may be shorter.
    const size = [...chunks.values()].reduce((n, c) => n + c.byteLength, 0)
    const merged = new Uint8Array(size)
    let offset = 0
    for (let i = 0; i < total; i += 1) {
      const chunk = chunks.get(i)!
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    const blob = new Blob([merged], { type: mime })
    const sha256 = await sha256HexBlob(blob)
    return { ok: sha256 === id, sha256, size: merged.byteLength }
  },

  // (c) sealed DM round-trip over the SAME channel (Envelope v2).
  sendDm(text: string, peer: { publicKeyHex: string; encryptionPubHex: string }): void {
    const msg = { id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, peerId: peer.publicKeyHex, own: true, text, ts: Date.now(), status: 'sent' as const }
    const env = seal1to1(encodeDmBody(msg), 'mail', IDENTITY, peer)
    send({ type: 'SWARM_DM', envelope: env })
  },
  async recvDm(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = await take((m) => (m as { type?: string })?.type === 'SWARM_DM', Math.max(1, deadline - Date.now())) as { type: string; envelope: Parameters<typeof open1to1>[0] } | null
      if (!frame) return null
      try {
        const opened = open1to1(frame.envelope, IDENTITY.encryptionPrivHex)
        const body = decodeBody(opened.body)
        if (body?.t === 'dm') {
          // Ack back, sealed to the key the sender proved (senderPub + fromEph).
          const ack = seal1to1(encodeAckBody(body.id), 'mail', IDENTITY, { publicKeyHex: opened.senderPubHex, encryptionPubHex: frame.envelope.fromEph || '' })
          send({ type: 'SWARM_DM', envelope: ack })
          return { id: body.id, text: body.text ?? '' }
        }
      } catch {
        /* not ours / bad signature: drop */
      }
    }
    return null
  },
  async recvAck(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = await take((m) => (m as { type?: string })?.type === 'SWARM_DM', Math.max(1, deadline - Date.now())) as { type: string; envelope: Parameters<typeof open1to1>[0] } | null
      if (!frame) return null
      try {
        const opened = open1to1(frame.envelope, IDENTITY.encryptionPrivHex)
        const body = decodeBody(opened.body)
        if (body?.t === 'dm_ack') return { id: body.id }
      } catch {
        /* drop */
      }
    }
    return null
  },

  close(): void {
    try { dc?.close() } catch { /* already closed */ }
    try { pc?.close() } catch { /* already closed */ }
  },
}

;(globalThis as { __wan?: typeof api }).__wan = api

async function waitIce(pc: RTCPeerConnection, budgetMs = 12_000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    // Wait for COMPLETE gathering: without trickle ICE an early SDP carries no
    // candidates and the pair can never connect (a false failure).
    const timer = setTimeout(done, budgetMs)
    function done() { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve() }
    function check() { if (pc.iceGatheringState === 'complete') done() }
    pc.addEventListener('icegatheringstatechange', check)
  })
}