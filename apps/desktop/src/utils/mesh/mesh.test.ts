import { describe, expect, it, vi } from 'vitest'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { PeerRoster } from '../peerRoster'
import { startMesh, meshPeerAsUser } from './mesh'
import { makeHello, signHello } from './hello'

const FP_LOCAL = 'cc'.repeat(32)
const FP_REMOTE = 'bb'.repeat(32)

/** The wire form of a 20-byte id: one character per byte, never hex. */
function wireId(hex: string): string {
  let out = ''
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return out
}

/**
 * A tracker that answers our offer the way a real one does: it echoes the
 * `offer_id` it was given, byte for byte, and speaks the reference wire
 * (a SINGULAR `answer` carrying an SDP OBJECT).
 */
class FakeTrackerSocket {
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(
    readonly url: string,
    readonly remote: OrbitIdentity,
  ) {
    setTimeout(() => {
      this.readyState = 1
      this.emit('open', {})
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    const offers = Array.isArray(msg.offers) ? msg.offers : []
    if (offers.length === 0) return
    const row = offers[0] as { offer_id: string }
    queueMicrotask(() =>
      this.emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: msg.info_hash,
          peer_id: wireId('99'.repeat(20)),
          offer_id: row.offer_id,
          answer: { type: 'answer', sdp: 'v=0\r\n' },
        }),
      }),
    )
  }

  close() {
    this.readyState = 3
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    ;(this.listeners[type] ||= []).push(cb)
  }

  removeEventListener() {
    /* not needed by the fake */
  }

  emit(type: string, ev: unknown) {
    for (const cb of this.listeners[type] || []) cb(ev)
  }
}

class FakeChannel {
  readyState = 'connecting'
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(private readonly pc: FakePc) {}

  send(data: string) {
    this.pc.onChannelSend(data)
  }

  close() {
    this.readyState = 'closed'
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    ;(this.listeners[type] ||= []).push(cb)
  }

  removeEventListener(type: string, cb: (ev: unknown) => void) {
    const list = this.listeners[type]
    if (!list) return
    const i = list.indexOf(cb)
    if (i >= 0) list.splice(i, 1)
  }

  emit(type: string, ev: unknown) {
    for (const cb of [...(this.listeners[type] || [])]) cb(ev)
  }
}

/**
 * An RTCPeerConnection whose far end answers the signed HELLO.
 *
 * The mesh constructs it as `new Rtc(iceConfig)`, so the FIRST argument is
 * the ICE configuration — NOT the remote identity. The remote identity is
 * bound by `fakePcFor`.
 */
class FakePc {
  localDescription: { sdp: string } | null = null
  iceGatheringState = 'complete'
  connectionState = 'new'
  /** The SDP this connection was asked to accept (the peer's offer/answer). */
  remoteSdp: string | null = null
  readonly channel = new FakeChannel(this)

  constructor(
    readonly iceConfig: unknown,
    readonly remote: OrbitIdentity,
  ) {}

  createDataChannel() {
    return this.channel
  }

  async createOffer() {
    return { type: 'offer', sdp: `v=0\r\na=fingerprint:sha-256 ${FP_LOCAL}\r\n` }
  }

  async createAnswer() {
    return { type: 'answer', sdp: `v=0\r\na=fingerprint:sha-256 ${FP_REMOTE}\r\n` }
  }

  async setLocalDescription(d: { sdp: string }) {
    this.localDescription = d
  }

  async setRemoteDescription(d: { sdp: string }) {
    this.remoteSdp = d.sdp
    this.channel.readyState = 'open'
    this.channel.emit('open', {})
  }

  addEventListener() {
    /* not needed by the fake */
  }

  removeEventListener() {
    /* not needed by the fake */
  }

  close() {
    this.connectionState = 'closed'
  }

  onChannelSend(text: string) {
    let msg: { sig?: string; type?: string; v: number; orbitId: string; pubKeyHex: string; encPubHex?: string; fp: string; nonce: string }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (msg.sig) return // their signed hello: nothing left to answer
    if (msg.type === 'SWARM_PEX') return // the PEX frame is not a hello
    const hello = makeHello(this.remote, FP_REMOTE)
    this.channel.emit('message', {
      data: JSON.stringify(signHello(this.remote, hello, msg)),
    })
  }
}

/** The mesh calls `new Rtc(iceConfig)`: bind the remote identity by subclass. */
function fakePcFor(remote: OrbitIdentity, made?: FakePc[]): typeof RTCPeerConnection {
  return class extends FakePc {
    constructor(iceConfig: unknown) {
      super(iceConfig, remote)
      made?.push(this)
    }
  } as unknown as typeof RTCPeerConnection
}

describe('the tracker mesh', () => {
  it('a tracker-discovered peer becomes a visible roster peer', async () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const roster = new PeerRoster(null)
    const sockets: FakeTrackerSocket[] = []
    const pcs: FakePc[] = []

    const mesh = await startMesh({
      identity: {
        orbitId: alice.orbitId,
        publicKeyHex: alice.publicKeyHex,
        privateKeyHex: alice.privateKeyHex,
        encryptionPubHex: alice.encryptionPubHex,
      },
      communityKey: () => 'test-community',
      trackers: ['wss://fake.tracker'],
      socketImpl: (url) => {
        const s = new FakeTrackerSocket(url, bob)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      rtc: fakePcFor(bob, pcs),
      onPeer: (peer) => {
        const user = meshPeerAsUser(peer)
        if (!user) return
        roster.upsert(user)
      },
    })

    try {
      await vi.waitFor(() => expect(roster.list()).toHaveLength(1), { timeout: 5_000 })
      const peer = roster.list()[0]
      expect(peer.id).toBe(bob.orbitId)
      expect(peer.publicKey).toBe(bob.publicKeyHex)
      expect(peer.encryptionPubKey).toBe(bob.encryptionPubHex)
      expect(peer.online).toBe(true)
      // The tracker wire carries the SDP as an OBJECT, not base64. Reading it
      // as base64 (or as JSON) throws, the connection is closed, and the
      // tracker path looks alive while connecting to NOTHING.
      expect(pcs[0]?.remoteSdp).toBe('v=0\r\n')
    } finally {
      mesh.stop()
    }
  })

  it('answers a relayed offer with to_peer_id, the way the tracker routes it', async () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const sockets: FakeTrackerSocket[] = []

    const mesh = await startMesh({
      identity: {
        orbitId: alice.orbitId,
        publicKeyHex: alice.publicKeyHex,
        privateKeyHex: alice.privateKeyHex,
        encryptionPubHex: alice.encryptionPubHex,
      },
      communityKey: () => 'test-community',
      trackers: ['wss://fake.tracker'],
      socketImpl: (url) => {
        const s = new FakeTrackerSocket(url, bob)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      rtc: fakePcFor(bob),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
      const announced = JSON.parse(sockets[0].sent[0])

      // The tracker relays somebody else's offer to us: SINGULAR `offer`.
      const remoteOfferId = wireId('5a'.repeat(20))
      const remotePeerId = wireId('77'.repeat(20))
      sockets[0].emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: announced.info_hash,
          peer_id: remotePeerId,
          offer_id: remoteOfferId,
          offer: { type: 'offer', sdp: 'v=0\r\nremote-offer\r\n' },
        }),
      })

      // Our answer must name the peer it answers: the tracker server DROPS an
      // answer without `to_peer_id`, so the offering peer never hears back.
      await vi.waitFor(
        () => {
          const payload = sockets[0].sent.map((s) => JSON.parse(s)).find((m) => m.answer)
          expect(payload?.to_peer_id).toBe(remotePeerId)
          expect(payload?.answer).toEqual({
            type: 'answer',
            sdp: expect.stringContaining('v=0'),
          })
        },
        { timeout: 5_000 },
      )
    } finally {
      mesh.stop()
    }
  })

  it('the tracker peer id is stable across announces', async () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const sockets: FakeTrackerSocket[] = []

    const mesh = await startMesh({
      identity: {
        orbitId: alice.orbitId,
        publicKeyHex: alice.publicKeyHex,
        privateKeyHex: alice.privateKeyHex,
        encryptionPubHex: alice.encryptionPubHex,
      },
      communityKey: () => 'test-community',
      trackers: ['wss://fake.tracker'],
      socketImpl: (url) => {
        const s = new FakeTrackerSocket(url, bob)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      rtc: fakePcFor(bob),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(1))
      // A fresh peer id per announce made the tracker see a new peer every
      // time, and the answer to an offer we published could not be routed
      // back to us.
      const ids = new Set(sockets[0].sent.map((s) => JSON.parse(s).peer_id))
      expect(ids.size).toBe(1)
    } finally {
      mesh.stop()
    }
  })

  it('a peer with no proven key is not shown', () => {
    expect(meshPeerAsUser({ orbitId: 'a'.repeat(64), at: Date.now() })).toBeNull()
    expect(meshPeerAsUser({ orbitId: 'a'.repeat(64), pubKeyHex: 'b'.repeat(64), at: Date.now() })?.id).toBe(
      'a'.repeat(64),
    )
  })
})
