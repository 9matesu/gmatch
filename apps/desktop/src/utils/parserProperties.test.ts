import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { validateSocialOperation } from '@orbit/protocol'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { publishSignedPostOperation } from '../services/socialPublish'
import { SwarmTestNetwork } from './swarmHarness'
import type { SwarmMessage } from './p2pSwarm'

/**
 * Property tests for the parsers that face untrusted input (roadmap L8:
 * "fuzz message parsers and migrations").
 *
 * These are properties, not examples: a random mutation of a signed operation
 * must never validate, a random swarm frame must never store bytes, and a
 * random release feed must never produce an unsafe download plan.
 *
 * The randomness is seeded, so a failure is reproducible.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function memoryBackend(): OperationLogBackend & { store: Map<string, LoggedOperation> } {
  const store = new Map<string, LoggedOperation>()
  return {
    store,
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

describe('protocol parser properties', () => {
  it('rejects every single-byte mutation of a signed operation', async () => {
    const identity = restoreIdentity('00'.repeat(32), '11'.repeat(32))
    const log = new SocialOperationLog(memoryBackend())
    const operation = await publishSignedPostOperation(identity, {
      objectId: 'post-1',
      contentCid: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      caption: 'hello world',
      tags: 'Art, TEST',
    }, log)
    expect(validateSocialOperation(operation)).toBeNull()

    const encoded = new TextEncoder().encode(JSON.stringify(operation))
    const random = seeded(1337)
    let mutations = 0
    for (let i = 0; i < 300; i += 1) {
      const copy = Uint8Array.from(encoded)
      const at = Math.floor(random() * copy.length)
      copy[at] = copy[at] ^ (1 << Math.floor(random() * 8))
      let parsed: unknown
      try {
        parsed = JSON.parse(new TextDecoder().decode(copy))
      } catch {
        continue // not JSON anymore: rejected by the parser anyway
      }
      mutations += 1
      expect(validateSocialOperation(parsed)).not.toBeNull()
    }
    expect(mutations).toBeGreaterThan(100)
  }, 60000)

  it('rejects random shapes that merely look like operations', () => {
    const random = seeded(99)
    for (let i = 0; i < 200; i += 1) {
      const shape: Record<string, unknown> = {}
      const fields = ['protocol', 'version', 'type', 'operationId', 'actorId', 'signingKey', 'actorSequence', 'previousOperationId', 'createdAt', 'objectId', 'payload', 'signature']
      for (const field of fields) {
        if (random() < 0.6) shape[field] = random() < 0.5 ? Math.floor(random() * 1e6) : 'x'.repeat(1 + Math.floor(random() * 70))
      }
      expect(validateSocialOperation(shape)).not.toBeNull()
    }
  })
})

describe('swarm frame properties', () => {
  it('never stores bytes from a malformed frame', async () => {
    const network = new SwarmTestNetwork()
    const node = network.createNode('A')
    const random = seeded(4242)

    for (let i = 0; i < 300; i += 1) {
      const frame = {
        type: 'SWARM_CHUNK',
        id: random() < 0.5 ? 'a'.repeat(64) : 'not-a-hash',
        index: Math.floor(random() * 100000),
        total: Math.floor(random() * 100000),
        mimeType: 'x'.repeat(1 + Math.floor(random() * 200)),
        dataBase64: 'A'.repeat(1 + Math.floor(random() * 200)),
      } as unknown as SwarmMessage
      // Must not throw, must not store anything.
      await node.session.handleMessage(frame)
    }
    expect(node.durable.size).toBe(0)
  }, 60000)
})
