// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { sendCourierSignal, handleInboundSignal, setMeshIceFailureHandler, type CourierSignalPayload } from './courierSignaling'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { open1to1, deliveryToken, seal1to1 } from '@orbit/protocol'

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
      const envelope = (payload: unknown) => seal1to1(
        JSON.stringify(payload), 'signal',
        { privateKeyHex: alice.privateKeyHex, publicKeyHex: alice.publicKeyHex, encryptionPrivHex: alice.encryptionPrivHex, encryptionPubHex: alice.encryptionPubHex },
        { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex },
        { to: deliveryToken(bob.publicKeyHex), exp: Date.now() + 60_000 },
      )

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
})
