import { describe, expect, it, beforeEach, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, SENDING_EVICT_MS, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'
import { acceptInboundOperation, broadcastPendingOperations, broadcastRecentOperations } from './socialOpTransport'
import { handleSwarmMessage, sendSwarmFrame, setSwarmOperationHandler, setSwarmTransport } from '../utils/p2pSwarm'

const AUTHOR = restoreIdentity('00'.repeat(32), '11'.repeat(32))

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

async function authorPost(log: SocialOperationLog, n: number) {
  return publishSignedPostOperation(AUTHOR, {
    objectId: `post-${n}`,
    contentCid: `${n}`.repeat(64).slice(0, 64),
    mimeType: 'image/jpeg',
    sizeBytes: 100 + n,
    caption: `caption ${n}`,
  }, log)
}

describe('socialOpTransport (L4 seed)', () => {
  let authorLog: SocialOperationLog
  let peerLog: SocialOperationLog

  beforeEach(() => {
    authorLog = newLog()
    peerLog = newLog()
  })

  function newLog() {
    return new SocialOperationLog(memoryBackend())
  }

  it('replicates a signed post operation from the author to a peer log', async () => {
    const operation = await authorPost(authorLog, 1)
    expect(await acceptInboundOperation(peerLog, operation)).toBe('accepted')
    const received = (await peerLog.listOperationsByActor(AUTHOR.orbitId))
      .map((entry) => entry.record as Record<string, unknown>)
    expect(received).toHaveLength(1)
    expect(received[0].operationId).toBe(operation.operationId)

    // Chained second operation follows once the first is in the peer's log.
    const second = await authorPost(authorLog, 2)
    expect(await acceptInboundOperation(peerLog, second)).toBe('accepted')
    expect(await peerLog.listPendingOperations()).toHaveLength(2)
  })

  it('treats re-delivery as a duplicate no-op', async () => {
    const operation = await authorPost(authorLog, 1)
    expect(await acceptInboundOperation(peerLog, operation)).toBe('accepted')
    expect(await acceptInboundOperation(peerLog, operation)).toBe('duplicate')
    expect(await acceptInboundOperation(authorLog, operation)).toBe('duplicate')
  })

  it('rejects tampered signatures and inconsistent manifest claims', async () => {
    const operation = await authorPost(authorLog, 1)
    expect(await acceptInboundOperation(peerLog, { ...operation, signature: 'f'.repeat(128) })).toBe('rejected')
    // sizeBytes is part of the manifest claim: changing it desynchronizes
    // payload.manifestHash even though the signature itself is intact.
    expect(await acceptInboundOperation(peerLog, {
      ...operation,
      payload: { ...operation.payload, sizeBytes: 999 },
    })).toBe('rejected')
    expect(await peerLog.listOperationsByActor(AUTHOR.orbitId)).toHaveLength(0)
  })

  it('rejects out-of-order operations but accepts them after the predecessor lands', async () => {
    const first = await authorPost(authorLog, 1)
    const second = await authorPost(authorLog, 2)
    expect(await acceptInboundOperation(peerLog, second)).toBe('rejected')
    expect(await acceptInboundOperation(peerLog, first)).toBe('accepted')
    expect(await acceptInboundOperation(peerLog, second)).toBe('accepted')
  })

  it('rejects a record whose claimed actor is not the signer', async () => {
    const operation = await authorPost(authorLog, 1)
    // Rewriting actorId invalidates the operation-id preimage, the actor
    // binding, and the signature — every layer rejects independently.
    expect(await acceptInboundOperation(peerLog, { ...operation, actorId: 'e'.repeat(64) })).toBe('rejected')
  })

  it('broadcast hands pending operations to the network and never claims delivered', async () => {
    const first = await authorPost(authorLog, 1)
    const second = await authorPost(authorLog, 2)
    const sent: Array<Record<string, unknown>> = []
    const { sent: count } = await broadcastPendingOperations(authorLog, (operation) => { sent.push(operation) })
    expect(count).toBe(2)
    expect(sent).toHaveLength(2)
    // Both moved to 'sending' — the truthful fire-and-forget state.
    const statuses = new Map((await authorLog.listPendingOperations())
      .map((entry) => [entry.operationId, entry.status]))
    expect(statuses.get(first.operationId)).toBe('sending')
    expect(statuses.get(second.operationId)).toBe('sending')
    // And the peer still accepts what it receives.
    expect(await acceptInboundOperation(peerLog, sent[0])).toBe('accepted')
  })

  it('re-offers recent delivered operations so peers that joined later still get them', async () => {
    const first = await authorPost(authorLog, 1)
    const second = await authorPost(authorLog, 2)
    // Both were already acked by an earlier peer wave — exactly the state that
    // used to make old posts permanently invisible to a newcomer.
    await authorLog.advanceStatus(first.operationId, 'delivered')
    await authorLog.advanceStatus(second.operationId, 'delivered')
    expect(await authorLog.listPendingOperations()).toHaveLength(0)

    const sent: Array<Record<string, unknown>> = []
    const { sent: count } = await broadcastRecentOperations(authorLog, (operation) => { sent.push(operation) })
    expect(count).toBe(2)
    expect(sent.map((operation) => operation.operationId)).toEqual([second.operationId, first.operationId])
    // Re-offering does not rewrite delivery state: it is a catch-up wave, not
    // a re-ack. The receiving side dedupes by operation id.
    const stored = new Map((await authorLog.listAllOperations())
      .map((entry) => [entry.operationId, entry.status]))
    expect(stored.get(first.operationId)).toBe('delivered')
    expect(stored.get(second.operationId)).toBe('delivered')
  })

  it('bounds the catch-up wave by count and age', async () => {
    await authorPost(authorLog, 1)
    await authorPost(authorLog, 2)
    await authorPost(authorLog, 3)

    const limited: Array<Record<string, unknown>> = []
    expect((await broadcastRecentOperations(authorLog, (operation) => { limited.push(operation) }, { limit: 2 })).sent).toBe(2)
    // Newest first, so the head of the chain is always in the wave.
    expect(limited[0].operationId).toBe((await authorLog.listAllOperations())
      .sort((a, b) => b.createdAt - a.createdAt)[0].operationId)

    // Nothing falls inside a zero-width window.
    const none: Array<Record<string, unknown>> = []
    expect((await broadcastRecentOperations(authorLog, (operation) => { none.push(operation) }, { maxAgeMs: 0 })).sent).toBe(0)
    expect(none).toHaveLength(0)
  })

  it('evicts long-stuck sending entries at capacity but never the chain head', async () => {
    const backend = memoryBackend()
    let now = Date.now()
    const log = new SocialOperationLog(backend, { maxEntries: 4, now: () => now })
    const first = await authorPost(log, 1)
    const second = await authorPost(log, 2) // the chain head that must survive
    // Both are 'sending' (broadcast, no ack yet). The clock then jumps past the
    // eviction window: the stale entry is evictable, the head stays fresh.
    await log.advanceStatus(first.operationId, 'sending')
    await log.advanceStatus(second.operationId, 'sending')
    now += SENDING_EVICT_MS + 1000
    await log.bumpAttempts(second.operationId) // refresh the head only
    // Fill past capacity: the stale entry is evictable, the head is not.
    await authorPost(log, 3)
    await authorPost(log, 4)
    await authorPost(log, 5)
    const remaining = [...backend.store.values()]
    expect(remaining.length).toBeLessThanOrEqual(4)
    expect(remaining.some((entry) => entry.operationId === first.operationId)).toBe(false)
    expect(remaining.some((entry) => entry.actorSequence === 2)).toBe(true)
    expect(remaining.some((entry) => entry.actorSequence === 5)).toBe(true)
  })

  it('routes SWARM_OP frames to the injected handler and out via sendSwarmFrame', async () => {
    const handler = vi.fn(async () => {})
    setSwarmOperationHandler(handler)
    try {
      expect(sendSwarmFrame({ type: 'SWARM_WANT', id: 'x' })).toBe(false)
      const sent: unknown[] = []
      setSwarmTransport((msg) => { sent.push(msg) })
      expect(sendSwarmFrame({ type: 'SWARM_WANT', id: 'x' })).toBe(true)

      const operation = await authorPost(authorLog, 1)
      expect(await handleSwarmMessage({ type: 'SWARM_OP', operation })).toBe(true)
      expect(handler).toHaveBeenCalledWith(operation)
      expect(await handleSwarmMessage({ type: 'SWARM_OP', operation: { tampered: true } })).toBe(true)
      expect(handler).toHaveBeenCalledTimes(2)
      setSwarmTransport(null)
    } finally {
      setSwarmOperationHandler(null)
      setSwarmTransport(null)
    }
  })
})
