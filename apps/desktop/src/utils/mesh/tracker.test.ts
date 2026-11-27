import { describe, expect, it, vi } from 'vitest'
import { startTrackerClient } from './tracker'

/**
 * The tracker wire is the reference `bittorrent-tracker` protocol — the one
 * every public WebTorrent tracker runs.
 *
 * These tests pin the parts that are easy to get wrong and fail SILENTLY:
 * a malformed announce is simply never answered, and an answer without
 * `to_peer_id` is dropped by the server parser. In both cases the tracker path
 * looks alive and connects to NOTHING.
 */

class FakeSocket {
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(readonly url: string) {
    setTimeout(() => {
      this.readyState = 1
      this.emit('open', {})
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
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

/** The wire form of a 20-byte id: one character per byte, never hex. */
function wireId(hex: string): string {
  let out = ''
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return out
}

const OUR_PEER = '01'.repeat(20)
const OUR_HASH = '07'.repeat(20)

describe('the tracker wire', () => {
  it('publishes the offer as an SDP object, the way the tracker expects', async () => {
    const sockets: FakeSocket[] = []
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      offers: () => [
        {
          offerId: 'ab'.repeat(20),
          peerId: OUR_PEER,
          infoHash: OUR_HASH,
          offer: { type: 'offer', sdp: 'v=0\r\n' },
        },
      ],
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
      const announced = JSON.parse(sockets[0].sent[0])

      // The SDP is an OBJECT. A string offer is not an offer.
      expect(announced.offers[0].offer).toEqual({ type: 'offer', sdp: 'v=0\r\n' })
      // The id is the binary wire form, never hex.
      expect(announced.offers[0].offer_id).toBe(wireId('ab'.repeat(20)))
      expect(announced.offers[0].offer_id).toHaveLength(20)
      // `numwant` is the field the server reads.
      expect(announced.numwant).toBe(1)
      expect(announced.num_w).toBeUndefined()
      expect(announced.info_hash).toBe(wireId(OUR_HASH))
      expect(announced.peer_id).toBe(wireId(OUR_PEER))
    } finally {
      handle.stop()
    }
  })

  it('answers with to_peer_id — without it the tracker server drops the answer', async () => {
    const sockets: FakeSocket[] = []
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      answer: () => ({
        offerId: 'cd'.repeat(20),
        peerId: 'ef'.repeat(20),
        infoHash: OUR_HASH,
        answer: { type: 'answer', sdp: 'v=0\r\n' },
      }),
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
      const answered = JSON.parse(sockets[0].sent.find((s) => s.includes('"answer"'))!)

      // The server parser THROWS without this: "invalid `to_peer_id`
      // (required with `answer`)". The answer would never be relayed.
      expect(answered.to_peer_id).toBe(wireId('ef'.repeat(20)))
      expect(answered.to_peer_id).toHaveLength(20)
      expect(answered.offer_id).toBe(wireId('cd'.repeat(20)))
      expect(answered.answer).toEqual({ type: 'answer', sdp: 'v=0\r\n' })
      // The answer rides its OWN announce: the tracker relays it and does not
      // answer an answer.
      expect(answered.offers).toBeUndefined()
    } finally {
      handle.stop()
    }
  })

  it('reads a relayed offer from the singular `offer` field', async () => {
    const sockets: FakeSocket[] = []
    const offers: unknown[] = []
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      onOffers: (o) => offers.push(...o),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))

      sockets[0].emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: wireId(OUR_HASH),
          peer_id: wireId('99'.repeat(20)),
          offer_id: wireId('ab'.repeat(20)),
          offer: { type: 'offer', sdp: 'v=0\r\nremote\r\n' },
        }),
      })

      await vi.waitFor(() => expect(offers.length).toBe(1))
      expect(offers[0]).toEqual({
        offerId: 'ab'.repeat(20),
        peerId: '99'.repeat(20),
        infoHash: OUR_HASH,
        offer: { type: 'offer', sdp: 'v=0\r\nremote\r\n' },
      })
    } finally {
      handle.stop()
    }
  })

  it('reads a relayed answer from the singular `answer` field and reconciles the id', async () => {
    const sockets: FakeSocket[] = []
    const answers: { offerId: string; peerId: string }[] = []
    const ourOfferId = 'ab'.repeat(20)
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      offers: () => [
        {
          offerId: ourOfferId,
          peerId: OUR_PEER,
          infoHash: OUR_HASH,
          offer: { type: 'offer', sdp: 'v=0\r\n' },
        },
      ],
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      onAnswers: (a) => answers.push(...a),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
      const announced = JSON.parse(sockets[0].sent[0])
      const wireOfferId = announced.offers[0].offer_id

      // The tracker echoes the offer_id it was given, byte for byte.
      expect(wireOfferId).not.toBe(ourOfferId)

      sockets[0].emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: wireId(OUR_HASH),
          peer_id: wireId('99'.repeat(20)),
          offer_id: wireOfferId,
          answer: { type: 'answer', sdp: 'v=0\r\nanswer\r\n' },
        }),
      })

      await vi.waitFor(() => expect(answers.length).toBe(1))
      expect(answers[0].offerId).toBe(ourOfferId)
      expect(answers[0].peerId).toBe('99'.repeat(20))
    } finally {
      handle.stop()
    }
  })

  it('ignores the tracker echoing our own offer back to us', async () => {
    const sockets: FakeSocket[] = []
    const offers: unknown[] = []
    const answers: unknown[] = []
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      onOffers: (o) => offers.push(...o),
      onAnswers: (a) => answers.push(...a),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))

      sockets[0].emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: wireId(OUR_HASH),
          peer_id: wireId(OUR_PEER),
          offer_id: wireId('ab'.repeat(20)),
          offer: { type: 'offer', sdp: 'v=0\r\n' },
        }),
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(offers.length).toBe(0)
      expect(answers.length).toBe(0)
    } finally {
      handle.stop()
    }
  })

  it('ignores a message about a room we never announced', async () => {
    const sockets: FakeSocket[] = []
    const offers: unknown[] = []
    const handle = await startTrackerClient({
      trackers: ['wss://fake.tracker'],
      infoHashes: async () => [new Uint8Array(20).fill(7)],
      peerId: () => new Uint8Array(20).fill(1),
      socketImpl: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s as unknown as WebSocket
      },
      onOffers: (o) => offers.push(...o),
    })

    try {
      await vi.waitFor(() => expect(sockets.length).toBe(1))
      await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))

      sockets[0].emit('message', {
        data: JSON.stringify({
          action: 'announce',
          info_hash: wireId('aa'.repeat(20)),
          peer_id: wireId('99'.repeat(20)),
          offer_id: wireId('ab'.repeat(20)),
          offer: { type: 'offer', sdp: 'v=0\r\n' },
        }),
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(offers.length).toBe(0)
    } finally {
      handle.stop()
    }
  })
})
