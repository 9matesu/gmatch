import { describe, it, expect } from 'vitest'
import {
  registerLocalObject,
  hasLocalObject,
  getLocalObject,
  createSwarmSession,
  sha256HexBlob,
  type SwarmMessage,
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
})
