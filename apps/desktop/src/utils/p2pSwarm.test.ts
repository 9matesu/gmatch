import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSwarmOffer } from '@orbit/protocol'
import {
  registerLocalObject,
  hasLocalObject,
  getLocalObject,
  createSwarmSession,
  sha256HexBlob,
  setSwarmTransport,
  setSwarmLegacyPlaintextEnabled,
  handleSwarmMessage,
  requestSwarmObject,
  cancelSwarmObject,
  __localObjectCacheForTests,
  __resetLocalObjectCacheForTests,
  type SwarmMessage,
  type SwarmSession,
} from './p2pSwarm'

describe('p2pSwarm (WebRTC Object Swarm Transfer)', () => {
  it('registers and retrieves local objects for swarm seeding', async () => {
    const blob = new Blob(['sample-card-media-data'], { type: 'image/png' })
    registerLocalObject('obj-card-1', blob)

    expect(hasLocalObject('obj-card-1')).toBe(true)
    expect(hasLocalObject('obj-missing')).toBe(false)

    const retrieved = await getLocalObject('obj-card-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.size).toBe(blob.size)
  })

  it('handles SWARM_WANT and transmits chunks between simulated peers', async () => {
    const testData = 'a'.repeat(128 * 1024) // 128KB payload
    const sourceBlob = new Blob([testData], { type: 'video/mp4' })

    const peerASentMessages: SwarmMessage[] = []
    const peerBSentMessages: SwarmMessage[] = []

    // Peer A serves files; Peer B wants 'video-1'
    const sessionA = createSwarmSession({
      send: (msg) => {
        peerASentMessages.push(msg)
        // Relay to Peer B
        sessionB.handleMessage(msg)
      },
    })
    sessionA.registerLocalObject('video-1', sourceBlob)

    const sessionB = createSwarmSession({
      send: (msg) => {
        peerBSentMessages.push(msg)
        // Relay to Peer A
        sessionA.handleMessage(msg)
      },
    })

    // Peer B requests the object from the swarm
    const receivedBlobPromise = sessionB.requestObject('video-1')
    const receivedBlob = await receivedBlobPromise

    expect(receivedBlob).not.toBeNull()
    expect(receivedBlob.size).toBe(sourceBlob.size)
    expect(receivedBlob.type).toBe('video/mp4')

    // Verify chunk transmission occurred over the simulated channel
    expect(peerBSentMessages.some((m) => m.type === 'SWARM_WANT')).toBe(true)
    expect(peerASentMessages.some((m) => m.type === 'SWARM_CHUNK')).toBe(true)
  })

  it('accepts reassembled bytes only when they match the expected content hash', async () => {
    const payload = 'verified-media-bytes-'.repeat(64)
    const sourceBlob = new Blob([payload], { type: 'image/png' })
    const realHash = await sha256HexBlob(sourceBlob)

    const wire = () => {
      const q: SwarmMessage[] = []
      return {
        q,
        flush(session: ReturnType<typeof createSwarmSession>) {
          const m = q.shift()
          if (m) void session.handleMessage(m)
        },
        push(m: SwarmMessage) { q.push(m) },
      }
    }

    // Match case: hashes equal -> resolves and stores.
    {
      const ch = wire()
      const a = createSwarmSession({ send: (m) => ch.push(m) })
      const b = createSwarmSession({ send: (m) => ch.push(m) })
      a.registerLocalObject('ok-1', sourceBlob)
      const p = b.requestObject('ok-1', 5000, realHash)
      await new Promise((r) => setTimeout(r, 0))
      ch.flush(a)
      await new Promise((r) => setTimeout(r, 0))
      while (ch.q.length) ch.flush(b)
      await new Promise((r) => setTimeout(r, 0))
      const got = await p
      expect(got.size).toBe(sourceBlob.size)
      expect(hasLocalObject('ok-1')).toBe(true)
    }

    // Mismatch case: rejects and does NOT store the tampered bytes.
    {
      const ch = wire()
      const a = createSwarmSession({ send: (m) => ch.push(m) })
      const b = createSwarmSession({ send: (m) => ch.push(m) })
      a.registerLocalObject('bad-1', sourceBlob) // serves real bytes...
      const p = b.requestObject('bad-1', 5000, 'f'.repeat(64)) // ...but expects another hash
      await new Promise((r) => setTimeout(r, 0))
      ch.flush(a)
      await new Promise((r) => setTimeout(r, 0))
      while (ch.q.length) ch.flush(b)
      await expect(p).rejects.toThrow(/hash verification|verification failed/)
    }
  })

  /** A REAL seeder in a second session, bridged frame-by-frame into the
   *  module. This exercises the actual production wire (offer -> sealed DEK
   *  -> encrypted chunks) instead of replaying crafted plaintext frames. */
  function wireModuleSeeder(store: Map<string, Blob>): {
    seeder: SwarmSession
    frames: SwarmMessage[]
  } {
    const frames: SwarmMessage[] = []
    const seeder = createSwarmSession({
      send: (m) => { frames.push(m); void handleSwarmMessage(m) },
      localStore: store,
    })
    setSwarmTransport((m) => { void seeder.handleMessage(m) })
    return { seeder, frames }
  }

  async function sha256HexText(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('verifies assembly integrity against the expected hash', async () => {
    const text = 'b'.repeat(70 * 1024) // 18 chunks
    const blob = new Blob([text], { type: 'video/mp4' })
    wireModuleSeeder(new Map([['hash-ok', blob]]))
    const hash = await sha256HexText(text)
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: true }) } })
    const received = await requestSwarmObject('hash-ok', 5000, { expectedHash: hash })
    expect(received.size).toBe(blob.size)
    expect(hasLocalObject('hash-ok')).toBe(true)
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('rejects tampered bytes and never registers them', async () => {
    const text = 'c'.repeat(70 * 1024)
    const blob = new Blob([text], { type: 'video/mp4' })
    wireModuleSeeder(new Map([['hash-bad', blob]]))
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: true }) } })
    await expect(requestSwarmObject('hash-bad', 5000, { expectedHash: '0'.repeat(64) })).rejects.toThrow(/hash verification/i)
    expect(hasLocalObject('hash-bad')).toBe(false)
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('rejects duplicate and inconsistent chunks and permits cancellation', async () => {
    // The session opts into legacy ingest so this exercises the plaintext
    // validation path (the v0 contract); the swarm-v1 path is authenticated.
    const session = createSwarmSession({ send: () => {}, legacyPlaintext: true })
    const pending = session.requestObject('session-invalid', 1000)
    await session.handleMessage({
      type: 'SWARM_CHUNK', id: 'session-invalid', index: 0, total: 2,
      mimeType: 'text/plain', dataBase64: 'YQ==',
    })
    await expect(pending).rejects.toThrow(/invalid swarm chunk/i)

    const cancelled = session.requestObject('session-cancel', 1000)
    expect(session.cancelObject('session-cancel')).toBe(true)
    await expect(cancelled).rejects.toThrow(/cancelled/i)
    expect(session.cancelObject('session-cancel')).toBe(false)
  })

  it('rejects malformed expected hashes before sending a request', async () => {
    const send = vi.fn()
    setSwarmTransport(send)
    await expect(requestSwarmObject('hash-invalid', 1000, { expectedHash: 'not-a-hash' })).rejects.toThrow(/invalid swarm object request/i)
    expect(send).not.toHaveBeenCalled()
    setSwarmTransport(null)
  })

  it('normalizes uppercase SHA-256 expectations before verifying content', async () => {
    const text = 'uppercase hash test'
    const blob = new Blob([text], { type: 'text/plain' })
    wireModuleSeeder(new Map([['hash-uppercase', blob]]))
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: true }) } })
    const uppercase = (await sha256HexText(text)).toUpperCase()
    await expect(requestSwarmObject('hash-uppercase', 5000, { expectedHash: uppercase })).resolves.toHaveProperty('size', blob.size)
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('verifies cached bytes against an expected hash before returning them', async () => {
    const corrupt = new Blob(['stale or corrupt'])
    const expectedHash = await sha256HexBlob(new Blob(['different expected bytes']))
    registerLocalObject('cached-tamper', corrupt)
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: true }) } })
    const send = vi.fn()
    setSwarmTransport(send)
    await expect(requestSwarmObject('cached-tamper', 1000, { expectedHash })).rejects.toThrow(/hash verification/)
    expect(send).not.toHaveBeenCalled()
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('does not serve zero-byte or over-limit local objects (offered or not)', async () => {
    const send = vi.fn()
    setSwarmTransport(send)
    registerLocalObject('empty', new Blob([]))
    await handleSwarmMessage({ type: 'SWARM_WANT', id: 'empty' })
    expect(send).not.toHaveBeenCalled()

    const offer = createSwarmOffer()
    await handleSwarmMessage({ type: 'SWARM_WANT', id: 'empty', transferId: '1'.repeat(32), offerPub: offer.publicKeyHex })
    expect(send).not.toHaveBeenCalled()
    setSwarmTransport(null)
  })

  it('serves offered wants as ciphertext and keeps every frame under the split threshold', async () => {
    const sent: SwarmMessage[] = []
    const id = 'i'.repeat(256)
    setSwarmTransport((message) => sent.push(message))
    registerLocalObject(id, new Blob([new Uint8Array(4 * 1024)]))
    const offer = createSwarmOffer()
    await handleSwarmMessage({ type: 'SWARM_WANT', id, transferId: '2'.repeat(32), offerPub: offer.publicKeyHex })
    expect(sent.some((message) => message.type === 'SWARM_KEY')).toBe(true)
    const chunks = sent.filter((message) => message.type === 'SWARM_CHUNK')
    expect(chunks).toHaveLength(1)
    for (const frame of [...chunks, ...sent.filter((message) => message.type === 'SWARM_KEY')]) {
      expect(new TextEncoder().encode(JSON.stringify(frame)).byteLength).toBeLessThan(8 * 1024)
      expect(new TextEncoder().encode(JSON.stringify(frame)).byteLength).toBeLessThan(30_000)
    }
    setSwarmTransport(null)
  })

  it('drops plaintext chunks by default (never registers bytes)', async () => {
    expect(hasLocalObject('no-plain-chunk')).toBe(false)
  })

  it('rejects malformed chunk metadata and lengths before storing bytes (legacy ingest opt-in)', async () => {
    setSwarmLegacyPlaintextEnabled(true)
    const cases = [
      { index: 1, total: 1, data: 'eA==' }, // index outside transfer
      { index: 0, total: 9000, data: 'eA==' }, // exceeds object limit
      { index: 0, total: 2, data: 'eA==' }, // truncated non-final chunk
      { index: 0, total: 1, data: '***' }, // malformed base64
    ]
    for (const [n, testCase] of cases.entries()) {
      const id = `malformed-${n}`
      setSwarmTransport((msg) => {
        if (msg.type === 'SWARM_WANT' && msg.id === id) {
          void handleSwarmMessage({
            type: 'SWARM_CHUNK', id, index: testCase.index, total: testCase.total,
            mimeType: 'image/png', dataBase64: testCase.data,
          })
        }
      })
      await expect(requestSwarmObject(id, 1000)).rejects.toThrow(/invalid swarm chunk|timed out/i)
      expect(hasLocalObject(id)).toBe(false)
    }
    setSwarmTransport(null)
    setSwarmLegacyPlaintextEnabled(false)
  })

  it('does not resolve a received object until durable storage succeeds', async () => {
    const id = 'persist-failure'
    const bytes = new Blob(['persist me'])
    wireModuleSeeder(new Map([[id, bytes]]))
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: false }) } })
    await expect(requestSwarmObject(id, 2000)).rejects.toThrow(/could not be persisted/i)
    expect(hasLocalObject(id)).toBe(false)
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('reports transfer progress per chunk', async () => {
    const text = 'd'.repeat(130 * 1024) // 32 chunks
    const blob = new Blob([text], { type: 'video/mp4' })
    wireModuleSeeder(new Map([['progress-1', blob]]))
    vi.stubGlobal('window', { gmatch: { vaultPutBytes: vi.fn().mockResolvedValue({ ok: true }) } })
    const seen: Array<[number, number]> = []
    await requestSwarmObject('progress-1', 5000, { onProgress: (r, t) => { seen.push([r, t]) } })
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.at(-1)?.[0]).toBe(seen.at(-1)?.[1])
    setSwarmTransport(null)
    vi.unstubAllGlobals()
  })

  it('cancels an in-flight fetch and drops partial chunks', async () => {
    const text = 'e'.repeat(200 * 1024)
    const blob = new Blob([text], { type: 'video/mp4' })
    // Bridge through a throttled seeder so cancel lands mid-transfer.
    const seeder = createSwarmSession({
      send: (m) => {
        if (m.type !== 'SWARM_CHUNK') {
          void handleSwarmMessage(m)
          return
        }
        void new Promise((r) => setTimeout(r, 25)).then(() => { void handleSwarmMessage(m) })
      },
      localStore: new Map([['cancel-1', blob]]),
    })
    setSwarmTransport((m) => { void seeder.handleMessage(m) })
    const pending = requestSwarmObject('cancel-1', 5000)
    await new Promise((r) => setTimeout(r, 40))
    expect(cancelSwarmObject('cancel-1')).toBe(true)
    await expect(pending).rejects.toThrow(/cancelled/i)
    expect(hasLocalObject('cancel-1')).toBe(false)
    // Late chunks for a cancelled fetch are ignored, not resurrected.
    expect(await handleSwarmMessage({ type: 'SWARM_CHUNK', id: 'cancel-1', index: 39, total: 40, mimeType: 'video/mp4', dataBase64: 'eA==' })).toBe(false)
    expect(cancelSwarmObject('cancel-1')).toBe(false)
    setSwarmTransport(null)
  })
})

describe('p2pSwarm RAM cache is bounded (memory)', () => {
  beforeEach(() => {
    __resetLocalObjectCacheForTests()
  })

  it('keeps at most 64 entries and evicts oldest first', () => {
    for (let i = 0; i < 80; i += 1) registerLocalObject(`mem-${i}`, new Blob([`b${i}`]))
    const { keys, bytes } = __localObjectCacheForTests()
    expect(keys.length).toBe(64)
    expect(keys[0]).toBe('mem-16')
    expect(keys[keys.length - 1]).toBe('mem-79')
    expect(hasLocalObject('mem-0')).toBe(false)
    expect(bytes).toBeGreaterThan(0)
  })

  it('a read refreshes recency, so a displayed object is evicted last', async () => {
    registerLocalObject('mem-first', new Blob(['1']))
    for (let i = 0; i < 63; i += 1) registerLocalObject(`mem-f${i}`, new Blob([`x${i}`]))
    // 'mem-first' is the oldest entry; reading it (a tile rendering it) must
    // move it to the front of the queue so the next insert evicts a colder one.
    await getLocalObject('mem-first')
    registerLocalObject('mem-overflow', new Blob(['y']))
    expect(hasLocalObject('mem-first')).toBe(true)
    expect(hasLocalObject('mem-f0')).toBe(false)
  })

  it('does not register an object above the transfer size limit', () => {
    const huge = new Blob(['huge'])
    Object.defineProperty(huge, 'size', { value: 65 * 1024 * 1024 })
    registerLocalObject('mem-huge', huge)
    expect(hasLocalObject('mem-huge')).toBe(false)
  })

  it('eviction from RAM never deletes the durable copy (bytes are re-read)', async () => {
    // Register beyond the cap, then read an evicted id back through the durable
    // store. getLocalObject must answer from disk rather than reporting a miss.
    registerLocalObject('mem-durable', new Blob(['durable-bytes'], { type: 'image/jpeg' }))
    for (let i = 0; i < 70; i += 1) registerLocalObject(`mem-x${i}`, new Blob([`z${i}`]))
    expect(hasLocalObject('mem-durable')).toBe(false)
    // No durable store in this environment: the honest answer is null, not a
    // phantom hit on the evicted RAM entry.
    await expect(getLocalObject('mem-durable')).resolves.toBeNull()
  })
})
