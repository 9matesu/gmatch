// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  broadcastMeshFrame,
  getActiveMeshPeers,
  handleInboundSignal,
  MESH_BACKPRESSURE_HIGH_BYTES,
  MESH_BACKPRESSURE_LOW_BYTES,
  sendCourierSignal,
  setMeshIceFailureHandler,
  signalMailBase,
  type CourierSignalPayload,
} from './courierSignaling'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { open1to1, deliveryToken } from '@orbit/protocol'

/** Minimal offline RTCPeerConnection double so the answerer path can be
 *  driven through the real ICE buffering / dedupe code. */
class FakePC {
  static readonly all: FakePC[] = []
  remoteDescription: RTCSessionDescription | null = null
  iceConnectionState = 'new'
  appliedCandidates: string[] = []
  ondatachannel: ((ev: unknown) => void) | null = null
  onicecandidate: ((ev: unknown) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  constructor() { FakePC.all.push(this) }
  async setRemoteDescription(desc: any) { this.remoteDescription = desc }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\no=bob-instant' } }
  async setLocalDescription() {}
  async addIceCandidate(c: RTCIceCandidateInit) { this.appliedCandidates.push(c.candidate ?? '') }
  close() {}
}

describe('courierSignaling', () => {
  const alice = generateIdentity() as OrbitIdentity
  const bob = generateIdentity() as OrbitIdentity

  describe('signalMailBase (30s handshake, no 20s poll detour)', () => {
    it('uses the peer node named by its signed beacon when reachable', () => {
      expect(signalMailBase('http://26.0.0.9:8790/', 'http://rendezvous', 'http://127.0.0.1:8790'))
        .toBe('http://26.0.0.9:8790')
    })

    it('falls back to the rendezvous, then to this machine node', () => {
      expect(signalMailBase(null, 'http://rendezvous', 'http://127.0.0.1:8790')).toBe('http://rendezvous')
      expect(signalMailBase('', '', 'http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790')
    })

    it('refuses a loopback/link-local beacon address so it cannot poison the handshake', () => {
      // Any peer can self-declare 127.0.0.1 in a signed beacon; reading it as a
      // mail base would send our SDP to OUR OWN loopback mailbox (no peer there).
      expect(signalMailBase('http://127.0.0.1:9999', 'http://rendezvous', 'http://127.0.0.1:8790'))
        .toBe('http://rendezvous')
      expect(signalMailBase('http://localhost:8790', 'http://rendezvous', 'http://127.0.0.1:8790'))
        .toBe('http://rendezvous')
      expect(signalMailBase('http://[::1]:8790', 'http://rendezvous', 'http://127.0.0.1:8790'))
        .toBe('http://rendezvous')
      expect(signalMailBase('http://169.254.4.4:8790', 'http://rendezvous', 'http://127.0.0.1:8790'))
        .toBe('http://rendezvous')
      expect(signalMailBase('not a url', '', 'http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790')
    })
  })

  it('seals signal envelope to recipient token via PUT /api/mail/:token', async () => {
    let capturedUrl = ''
    let capturedBody: any = null

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const payload: CourierSignalPayload = {
      type: 'offer',
      sessionId: 'test-session-123',
      fromOrbitId: alice.orbitId,
      fromPubKeyHex: alice.publicKeyHex,
      fromEncPubHex: alice.encryptionPubHex || '',
      sdp: { type: 'offer', sdp: 'v=0\r\no=alice...' },
    }

    const ok = await sendCourierSignal(
      bob.publicKeyHex,
      bob.encryptionPubHex || '',
      payload,
      alice,
      fetchMock as unknown as typeof globalThis.fetch,
    )

    expect(ok).toBe(true)
    const expectedToken = deliveryToken(bob.publicKeyHex)
    expect(capturedUrl).toContain(`/api/mail/${expectedToken}`)
    expect(capturedBody.env.kind).toBe('signal')
    expect(capturedBody.env.to).toBe(expectedToken)

    // Verify Bob can decrypt it
    const opened = open1to1(capturedBody.env, bob.encryptionPrivHex || '')

    expect(opened.kind).toBe('signal')
    const decryptedPayload = JSON.parse(opened.body)
    expect(decryptedPayload.type).toBe('offer')
    expect(decryptedPayload.sessionId).toBe('test-session-123')
    expect(decryptedPayload.fromOrbitId).toBe(alice.orbitId)
  })

  it('handleInboundSignal ignores non-signal envelopes', async () => {
    const fakeEnvelope: any = {
      kind: 'mail',
      id: 'env-1',
      to: 'token',
      body: JSON.stringify({ text: 'hello' }),
      senderPubHex: alice.publicKeyHex,
      senderOrbitId: alice.orbitId,
    }

    const handled = await handleInboundSignal(fakeEnvelope, bob)
    expect(handled).toBe(false)
  })

  it('buffers trickle candidates until the answer, and never re-applies duplicates', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    class FakeSD { type: string; sdp: string; constructor(i: { type: string; sdp: string }) { this.type = i.type; this.sdp = i.sdp } }
    vi.stubGlobal('RTCSessionDescription', FakeSD)
    class FakeIC { candidate: string; constructor(i: { candidate?: string }) { this.candidate = i.candidate ?? '' } }
    vi.stubGlobal('RTCIceCandidate', FakeIC)
    try {
      // Answerer flow: offer -> ICE arrives AFTER setRemoteDescription applies.
      await handleInboundSignal({
        kind: 'signal',
        id: 'env-offer',
        body: JSON.stringify({ type: 'offer', sessionId: 's-answer', fromOrbitId: alice.orbitId, fromPubKeyHex: alice.publicKeyHex, fromEncPubHex: alice.encryptionPubHex, sdp: { type: 'offer', sdp: 'v=0' } }),
        senderOrbitId: alice.orbitId,
      } as any, bob)
      expect(FakePC.all.length).toBe(1)
      const answerer = FakePC.all[0]
      await handleInboundSignal({
        kind: 'signal',
        id: 'env-ice-1',
        body: JSON.stringify({ type: 'ice', sessionId: 's-answer', fromOrbitId: alice.orbitId, candidate: { candidate: 'candidate:1 udp host .local 0 typ host', sdpMid: '0' } }),
        senderOrbitId: alice.orbitId,
      } as any, bob)
      await handleInboundSignal({
        kind: 'signal',
        id: 'env-ice-2',
        body: JSON.stringify({ type: 'ice', sessionId: 's-answer', fromOrbitId: alice.orbitId, candidate: { candidate: 'candidate:1 udp host .local 0 typ host', sdpMid: '0' } }),
        senderOrbitId: alice.orbitId,
      } as any, bob)
      expect(answerer.appliedCandidates).toEqual(['candidate:1 udp host .local 0 typ host'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the ICE watchdog reports terminal failure to the transport layer', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    class FakeSD { type: string; sdp: string; constructor(i: { type: string; sdp: string }) { this.type = i.type; this.sdp = i.sdp } }
    vi.stubGlobal('RTCSessionDescription', FakeSD)
    const failures: Array<[string, string]> = []
    const restore = setMeshIceFailureHandler((peerId, reason) => failures.push([peerId, reason]));
    try {
      await handleInboundSignal({
        kind: 'signal',
        id: 'env-offer-2',
        body: JSON.stringify({ type: 'offer', sessionId: 's-fail', fromOrbitId: alice.orbitId, fromPubKeyHex: alice.publicKeyHex, fromEncPubHex: alice.encryptionPubHex, sdp: { type: 'offer', sdp: 'v=0' } }),
        senderOrbitId: alice.orbitId,
      } as any, bob)
      const pc = FakePC.all[FakePC.all.length - 1]
      pc.iceConnectionState = 'failed'
      pc.oniceconnectionstatechange?.()
      expect(failures).toEqual([[alice.orbitId, 'ice failed']])
    } finally {
      restore()
      vi.unstubAllGlobals()
    }
  })

  describe('broadcastMeshFrame backpressure (swarm frames over the DataChannel mesh)', () => {
    /** A channel double with an observable send buffer. Each test uses fresh
     *  objects — the saturation mark is a per-channel WeakSet in the module. */
    function fakeChannel(buffered: () => number): RTCDataChannel & { sent: string[] } {
      const record = { sent: [] as string[] }
      return {
        readyState: 'open',
        get bufferedAmount() { return buffered() },
        send: (data: string) => { record.sent.push(data) },
        ...record,
      } as never
    }
    function registerMeshPeer(peerOrbitId: string, channel: RTCDataChannel): void {
      getActiveMeshPeers().set(peerOrbitId, {
        peerOrbitId,
        pc: {} as RTCPeerConnection,
        channel,
        send: () => {},
        close: () => {},
      })
    }
    /** 1 MiB high-water mark in the module under test. */
    const HIGH = MESH_BACKPRESSURE_HIGH_BYTES

    afterEach(() => {
      getActiveMeshPeers().clear()
    })

    it('delivers a swarm frame to an open, healthy channel', () => {
      const channel = fakeChannel(() => 0)
      registerMeshPeer('peer-1', channel)
      broadcastMeshFrame(JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_HAVE', ids: ['a'] } }))
      expect(channel.sent).toHaveLength(1)
      expect(JSON.parse(channel.sent[0])).toEqual({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_HAVE', ids: ['a'] } })
    })

    it('withholds frames from a channel whose send buffer passed the high-water mark', () => {
      const channel = fakeChannel(() => HIGH + 1)
      registerMeshPeer('peer-saturated', channel)
      broadcastMeshFrame(JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_CHUNK', id: 'x', index: 0, total: 8, dataBase64: 'AA==' } }))
      expect(channel.sent).toHaveLength(0)
    })

    it('resumes a saturated channel after its buffer drains below the low-water mark', () => {
      let buffered = HIGH + 1
      const channel = fakeChannel(() => buffered)
      registerMeshPeer('peer-recovering', channel)
      broadcastMeshFrame(JSON.stringify({}))

      // Still above HIGH: withheld...
      expect(channel.sent).toHaveLength(0)
      // ...and drained to between LOW and HIGH: still withheld (hysteresis —
      // a channel is only un-saturated once it truly emptied its backlog).
      buffered = MESH_BACKPRESSURE_LOW_BYTES + 1
      broadcastMeshFrame(JSON.stringify({}))
      expect(channel.sent).toHaveLength(0)
      // ...and fully drained: feeding resumes on the next frame.
      buffered = 0
      const resumedFrame = JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_HAVE', ids: ['b'] } })
      broadcastMeshFrame(resumedFrame)
      expect(channel.sent).toEqual([resumedFrame])
    })

    it('never lets one saturated peer starve the others on the same broadcast', () => {
      const healthy = fakeChannel(() => 0)
      const saturated = fakeChannel(() => HIGH * 2)
      registerMeshPeer('peer-healthy', healthy)
      registerMeshPeer('peer-clogged', saturated)
      broadcastMeshFrame(JSON.stringify({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_CHUNK', id: 'x', index: 1, total: 8, dataBase64: 'AA==' } }))
      expect(healthy.sent).toHaveLength(1)
      expect(saturated.sent).toHaveLength(0)
    })

    it('skips channels that are not open, without touching healthy peers', () => {
      const closed = fakeChannel(() => 0)
      ;(closed as { readyState: string }).readyState = 'closing'
      const open = fakeChannel(() => 0)
      registerMeshPeer('peer-closed', closed)
      registerMeshPeer('peer-open', open)
      expect(() => broadcastMeshFrame(JSON.stringify({}))).not.toThrow()
      expect(closed.sent).toHaveLength(0)
      expect(open.sent).toHaveLength(1)
    })
  })
})
