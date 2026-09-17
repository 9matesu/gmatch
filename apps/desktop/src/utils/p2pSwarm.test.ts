import { describe, it, expect } from 'vitest'
import {
  registerLocalObject,
  hasLocalObject,
  getLocalObject,
  createSwarmSession,
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
})
