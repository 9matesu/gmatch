import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { answerPollShouldRetry, OrbitPeer } from './webrtc'

const api = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./api', () => ({
  orbitFetch: (...args: unknown[]) => api.fetch(...args),
}))

// The NAT-T ladder: STUN srflx, global IPv6, Radmin VPN — all signaled.
const SRFLX = 'candidate:2 1 udp 1685790719 203.0.113.7 41234 typ srflx raddr 192.168.1.5 rport 54321'
const IPV6_HOST = 'candidate:1 1 udp 2122260223 2601:646:1234::1 54321 typ host'
const RADMIN_HOST = 'candidate:1 1 udp 2122260223 26.26.113.34 54321 typ host'
// CGNAT has no direct rung: it can never be signaled as a host candidate.
const CGNAT_HOST = 'candidate:1 1 udp 2122260223 100.64.0.1 54321 typ host'
const CANDIDATES = [SRFLX, IPV6_HOST, RADMIN_HOST, CGNAT_HOST]

class FakeChannel {
  readyState = 'open'
  binaryType = 'arraybuffer'
  send() {}
  close() {}
}

class FakePC {
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  iceConnectionState = 'new'
  onicecandidate: ((e: { candidate: { toJSON: () => { candidate: string; sdpMid: string } } }) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  ondatachannel: ((e: unknown) => void) | null = null
  constructor(_cfg?: unknown) {}
  createDataChannel() { return new FakeChannel() as never }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=alice' } }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\no=bob' } }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d
    // The ICE agent emits candidates as soon as local SDP is installed —
    // well before the async signal POST returns the offer id.
    for (const candidate of CANDIDATES) {
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate, sdpMid: '0' }) } })
    }
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: SRFLX, sdpMid: '0' }) } })
  }
  async addIceCandidate() {}
  close() { this.iceConnectionState = 'closed' }
}

class FakeSD {
  type: string
  sdp: string
  constructor(init: { type: string; sdp: string }) { this.type = init.type; this.sdp = init.sdp }
}

beforeEach(() => {
  api.fetch.mockReset()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  vi.stubGlobal('RTCSessionDescription', FakeSD)
})

describe('answerPollShouldRetry', () => {
  it('waits out a slow peer but stops on a bad offer or an auth refusal', () => {
    expect(answerPollShouldRetry(404, 'Answer not found')).toBe(true)
    expect(answerPollShouldRetry(400, 'Invalid answer data')).toBe(true)
    expect(answerPollShouldRetry(404, 'Offer not found')).toBe(false)
    expect(answerPollShouldRetry(403, 'Forbidden')).toBe(false)
  })
})

describe('initiate', () => {
  it('signals candidates gathered before the offer id exists', async () => {
    const identity = generateIdentity()
    api.fetch.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/signal/initiate') return new Response(JSON.stringify({ id: 'offer-1' }), { status: 201 })
      if (endpoint === '/api/signal/answer/offer-1') return new Response(JSON.stringify({ answer: { type: 'answer', sdp: 'v=0' } }), { status: 200 })
      if (endpoint === '/api/signal/ice') return new Response('{}', { status: 201 })
      return new Response('{}', { status: 200 })
    })

    const peer = new OrbitPeer()
    try {
      expect(await peer.initiate('bob', identity)).toBe('offer-1')
      const iceBodies = api.fetch.mock.calls
        .filter((call) => call[0] === '/api/signal/ice')
        .map((call) => JSON.parse((call[1] as RequestInit).body as string))
      // Without the pre-SDP handler these candidates were silently lost; the
      // peer then had no srflx address to connect to across two NATs.
      expect(iceBodies.some((body) => body.candidate.candidate === SRFLX)).toBe(true)
      expect(iceBodies.every((body) => body.offer_id === 'offer-1')).toBe(true)
    } finally {
      peer.close()
      vi.unstubAllGlobals()
    }
  })

  it('signals the whole direct ladder but never a CGNAT literal', async () => {
    const identity = generateIdentity()
    api.fetch.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/signal/initiate') return new Response(JSON.stringify({ id: 'offer-2' }), { status: 201 })
      if (endpoint === '/api/signal/answer/offer-2') return new Response(JSON.stringify({ answer: { type: 'answer', sdp: 'v=0' } }), { status: 200 })
      if (endpoint === '/api/signal/ice') return new Response('{}', { status: 201 })
      return new Response('{}', { status: 200 })
    })
    const peer = new OrbitPeer()
    try {
      await peer.initiate('bob', identity)
      const signaled = api.fetch.mock.calls
        .filter((call) => call[0] === '/api/signal/ice')
        .map((call) => JSON.parse((call[1] as RequestInit).body as string).candidate.candidate as string)
      expect(signaled).toContain(SRFLX)
      expect(signaled).toContain(IPV6_HOST)
      expect(signaled).toContain(RADMIN_HOST)
      expect(signaled).not.toContain(CGNAT_HOST)
    } finally {
      peer.close()
      vi.unstubAllGlobals()
    }
  })
})
