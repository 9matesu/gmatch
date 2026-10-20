import { describe, expect, it, beforeEach } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { validateSocialOperation } from '@orbit/protocol'
import { SocialOperationLog, type OperationLogBackend } from './socialOperationLog'
import { publishSignedPostOperation, shouldEmitSocialOperation } from './socialPublish'
import { contentManifestHash } from '@orbit/protocol'

const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const OTHER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

function memoryBackend(): OperationLogBackend & { store: Map<string, import('./socialOperationLog').LoggedOperation> } {
  const store = new Map<string, import('./socialOperationLog').LoggedOperation>()
  return {
    store,
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

function input(n: number, overrides: Partial<Parameters<typeof publishSignedPostOperation>[1]> = {}) {
  return {
    objectId: `post-${n}`,
    contentCid: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    caption: 'hello world',
    tags: 'Art, TEST, second tag',
    ...overrides,
  }
}

describe('publishSignedPostOperation (L1 slice 3)', () => {
  let backend: ReturnType<typeof memoryBackend>
  let log: SocialOperationLog

  beforeEach(() => {
    backend = memoryBackend()
    log = new SocialOperationLog(backend)
  })

  it('commits a signed, self-authorized, chained post.create durably', async () => {
    const first = await publishSignedPostOperation(IDENTITY, input(1), log)
    expect(validateSocialOperation(first)).toBeNull()
    expect(first.actorSequence).toBe(1)
    expect(first.previousOperationId).toBeNull()
    expect(first.payload.tags).toEqual(['art', 'test', 'secondtag'])
    expect(first.payload.manifestHash).toBe(contentManifestHash({
      ownerId: IDENTITY.orbitId,
      contentCid: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    }))
    const stored = backend.store.get(first.operationId)!
    expect(stored.status).toBe('committed')

    const second = await publishSignedPostOperation(IDENTITY, input(2), log)
    expect(second.actorSequence).toBe(2)
    expect(second.previousOperationId).toBe(first.operationId)

    // The committed records round-trip through full protocol validation
    // (shape, actor binding, operation-id preimage, signature).
    for (const entry of await log.listOperationsByActor(IDENTITY.orbitId)) {
      expect(validateSocialOperation(entry.record)).toBeNull()
    }
  })

  it('refuses a duplicate object id instead of double-creating', async () => {
    await publishSignedPostOperation(IDENTITY, input(1), log)
    await expect(publishSignedPostOperation(IDENTITY, input(1), log)).rejects.toThrow(/post already created/)
    expect(backend.store.size).toBe(1)
  })

  it('rejects malformed inputs before anything is written', async () => {
    await expect(publishSignedPostOperation(IDENTITY, input(1, { contentCid: 'not-hex' }), log)).rejects.toThrow()
    await expect(publishSignedPostOperation(IDENTITY, input(2, { mimeType: '' }), log)).rejects.toThrow()
    await expect(publishSignedPostOperation(IDENTITY, input(3, { objectId: '' }), log)).rejects.toThrow()
    expect(backend.store.size).toBe(0)
  })

  it('normalizes and caps tags through the shared shape rule', async () => {
    const operation = await publishSignedPostOperation(IDENTITY, input(1, {
      tags: 'one, two, three, four, five, six, seven',
    }), log)
    expect(operation.payload.tags).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('never emits onto a forked log history', async () => {
    await publishSignedPostOperation(IDENTITY, input(1), log)
    // Tamper a second entry in at the same sequence — the slot helper must refuse.
    const existing = [...backend.store.values()][0]
    backend.store.set('b'.repeat(64), { ...existing, operationId: 'b'.repeat(64), actorSequence: existing.actorSequence })
    await expect(publishSignedPostOperation(IDENTITY, input(2), log)).rejects.toThrow(/fork/)
  })

  it('keeps independent actors on independent chains', async () => {
    await publishSignedPostOperation(IDENTITY, input(1), log)
    const other = await publishSignedPostOperation(OTHER, input(2), log)
    expect(other.actorSequence).toBe(1)
    expect(other.previousOperationId).toBeNull()
    expect(backend.store.size).toBe(2)
  })

  it('preserves actor heads across prune and capacity eviction', async () => {
    await publishSignedPostOperation(IDENTITY, input(1), log)
    await publishSignedPostOperation(IDENTITY, input(2), log)
    // Age and deliver the older entry so prune wants it — but it is the
    // referenced predecessor, and the head must survive regardless.
    const older = [...backend.store.values()].find((entry) => entry.actorSequence === 1)!
    backend.store.set(older.operationId, { ...older, status: 'delivered', updatedAt: 1 })
    await log.advanceStatus([...backend.store.values()].find((entry) => entry.actorSequence === 2)!.operationId, 'delivered')
    const headEntry = [...backend.store.values()].find((entry) => entry.actorSequence === 2)!
    backend.store.set(headEntry.operationId, { ...headEntry, updatedAt: 1 })
    const removed = await log.prune(Date.now())
    // The aged delivered predecessor is pruned (gaps are legal and
    // detectable); the actor's chain HEAD must survive.
    expect(removed).toBe(1)
    expect([...backend.store.values()].map((entry) => entry.actorSequence)).toEqual([2])
    // The head survives even when it alone is old + delivered.
    backend.store.set(headEntry.operationId, { ...headEntry, status: 'delivered', updatedAt: 1 })
    expect(await log.prune(Date.now())).toBe(0)
    expect(backend.store.has(headEntry.operationId)).toBe(true)
  })

  it('gates emission to public durable feed posts only', () => {
    expect(shouldEmitSocialOperation({ durable: true })).toBe(true)
    expect(shouldEmitSocialOperation({ durable: true, isPublic: false })).toBe(false)
    expect(shouldEmitSocialOperation({ durable: true, isStory: true })).toBe(false)
    expect(shouldEmitSocialOperation({ durable: true, isAvatar: true })).toBe(false)
    expect(shouldEmitSocialOperation({ durable: true, isChat: true })).toBe(false)
    expect(shouldEmitSocialOperation({})).toBe(false)
  })

  it('surfaces log storage failures instead of claiming a commit', async () => {
    const failing: OperationLogBackend = {
      ...memoryBackend(),
      async put() { throw new Error('disk full') },
    }
    const failingLog = new SocialOperationLog(failing)
    await expect(publishSignedPostOperation(IDENTITY, input(1), failingLog)).rejects.toThrow(/disk full/)
  })
})
