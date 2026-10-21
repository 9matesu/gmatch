import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import { acceptInboundOperation, applyOperationAck, broadcastPendingOperations, validateOperationAck } from './socialOpTransport'
import { publishSignedPostOperation } from './socialPublish'

const AUTHOR = restoreIdentity('00'.repeat(32), '11'.repeat(32))

function memoryBackend(): OperationLogBackend & { store: Map<string, LoggedOperation>; reads: number } {
  const store = new Map<string, LoggedOperation>()
  const backend = {
    store,
    reads: 0,
    async put(entry: LoggedOperation) { store.set(entry.operationId, entry) },
    async get(id: string) { return store.get(id) ?? null },
    async getAll() { backend.reads += 1; return [...store.values()] },
    async delete(id: string) { store.delete(id) },
  }
  return backend
}

async function authorPost(log: SocialOperationLog, n: number) {
  return publishSignedPostOperation(AUTHOR, {
    objectId: `post-${n}`,
    contentCid: `${n}`.repeat(64).slice(0, 64),
    mimeType: 'image/jpeg',
    sizeBytes: 100 + n,
  }, log)
}

describe('operation acks (L4.3)', () => {
  it('validates ack shape strictly', () => {
    expect(validateOperationAck({ operationId: 'a'.repeat(64), actorId: 'b'.repeat(64) })).not.toBeNull()
    expect(validateOperationAck({ operationId: 'short', actorId: 'b'.repeat(64) })).toBeNull()
    expect(validateOperationAck({ operationId: 'a'.repeat(64) })).toBeNull()
    expect(validateOperationAck(null)).toBeNull()
  })

  it('advances to delivered only for a known operation and matching actor', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const operation = await authorPost(log, 1)

    // Unknown id: refused.
    expect(await applyOperationAck(log, { operationId: 'f'.repeat(64), actorId: AUTHOR.orbitId })).toBe(false)
    // Wrong actor: refused (a stray frame cannot vouch for our work).
    expect(await applyOperationAck(log, { operationId: operation.operationId, actorId: 'e'.repeat(64) })).toBe(false)
    expect((await log.getEntry(operation.operationId))?.status).toBe('committed')

    expect(await applyOperationAck(log, { operationId: operation.operationId, actorId: AUTHOR.orbitId })).toBe(true)
    expect((await log.getEntry(operation.operationId))?.status).toBe('delivered')
    // Downgrade/no-op: a second ack reports false, status stays delivered.
    expect(await applyOperationAck(log, { operationId: operation.operationId, actorId: AUTHOR.orbitId })).toBe(false)
  })

  it('a real peer ack makes the author entry delivered after broadcast', async () => {
    const authorLog = new SocialOperationLog(memoryBackend())
    const peerLog = new SocialOperationLog(memoryBackend())
    const operation = await authorPost(authorLog, 1)

    const sent: unknown[] = []
    await broadcastPendingOperations(authorLog, (op) => sent.push(op))
    expect((await authorLog.getEntry(operation.operationId))?.status).toBe('sending')

    // Receiver accepts and acks; the sender applies it.
    expect(await acceptInboundOperation(peerLog, operation)).toBe('accepted')
    expect(await applyOperationAck(authorLog, { operationId: operation.operationId, actorId: operation.actorId })).toBe(true)
    expect((await authorLog.getEntry(operation.operationId))?.status).toBe('delivered')
  })
})

describe('operation log read cache', () => {
  it('serves repeated reads without re-scanning the backend, and invalidates across instances', async () => {
    const backend = memoryBackend()
    const log = new SocialOperationLog(backend)
    const other = new SocialOperationLog(backend)

    await authorPost(log, 1)
    const before = backend.reads
    await log.listAllOperations()
    await log.listAllOperations()
    await log.listPendingOperations()
    // One scan for the whole burst: the cache is shared by revision.
    expect(backend.reads).toBe(before + 1)

    // A write through ANOTHER instance invalidates this instance's cache.
    await authorPost(other, 2)
    expect(await log.listAllOperations()).toHaveLength(2)
  })
})
