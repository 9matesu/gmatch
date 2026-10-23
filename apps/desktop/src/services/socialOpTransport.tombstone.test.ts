import { describe, expect, it, beforeEach, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { createSocialOperation } from '@orbit/protocol'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'
import { acceptInboundOperation } from './socialOpTransport'

// Purge is observed, not executed: the byte stores are not under test here.
const purgeMock = vi.hoisted(() => ({ purgeSwarmObject: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../utils/p2pSwarm', () => ({ purgeSwarmObject: purgeMock.purgeSwarmObject }))

/** The tombstone purge rides an unawaited async IIFE; flush several ticks. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

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

describe('tombstone → local replica purge (P1 deletion semantics)', () => {
  beforeEach(() => purgeMock.purgeSwarmObject.mockClear())

  it('a validated post.delete purges the replica bytes the peer holds', async () => {
    const authorLog = new SocialOperationLog(memoryBackend())
    const peerLog = new SocialOperationLog(memoryBackend())
    const created = await publishSignedPostOperation(AUTHOR, {
      objectId: 'post-gone',
      contentCid: '1'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    }, authorLog)
    expect(await acceptInboundOperation(peerLog, created)).toBe('accepted')

    // The author deletes their own post: chained after the create.
    const { actorSequence, previousOperationId } = await authorLog.nextActorSlot(AUTHOR.orbitId)
    const deletion = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.delete',
      actorId: AUTHOR.orbitId, signingKey: AUTHOR.publicKeyHex,
      actorSequence, previousOperationId, createdAt: Date.now(),
      objectId: 'post-gone',
      payload: { targetOperationId: created.operationId },
    }, AUTHOR.privateKeyHex)

    expect(await acceptInboundOperation(peerLog, deletion)).toBe('accepted')
    // The purge is fire-and-forget; flush the macrotask.
    await settle()
    expect(purgeMock.purgeSwarmObject).toHaveBeenCalledWith('1'.repeat(64))
  })

  it('deleting something without a locally-held creation purges nothing', async () => {
    const authorLog = new SocialOperationLog(memoryBackend())
    const peerLog = new SocialOperationLog(memoryBackend())
    const created = await publishSignedPostOperation(AUTHOR, {
      objectId: 'post-never-here',
      contentCid: '2'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    }, authorLog)
    const { actorSequence, previousOperationId } = await authorLog.nextActorSlot(AUTHOR.orbitId)
    const deletion = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.delete',
      actorId: AUTHOR.orbitId, signingKey: AUTHOR.publicKeyHex,
      actorSequence, previousOperationId, createdAt: Date.now(),
      objectId: 'post-never-here',
      payload: { targetOperationId: created.operationId },
    }, AUTHOR.privateKeyHex)
    // The create never reached us: the tombstone is REJECTED (the authorizer
    // refuses a successor whose predecessor is missing), so no purge fires.
    // Withdrawal therefore always follows the creation wave — the honest
    // cost of validating history locally with no trusted central judge.
    expect(await acceptInboundOperation(peerLog, deletion)).toBe('rejected')
    await settle()
    expect(purgeMock.purgeSwarmObject).not.toHaveBeenCalled()
  })
})
