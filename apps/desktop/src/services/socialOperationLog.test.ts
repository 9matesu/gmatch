import { describe, expect, it, beforeEach } from 'vitest'
import {
  SocialOperationLog,
  createIndexedDbOperationLogBackend,
  DELIVERED_GRACE_MS,
  isValidLogEntryShape,
  MAX_LOG_ENTRIES,
  MAX_RECORD_BYTES,
  type LoggedOperation,
  type OperationLogBackend,
} from './socialOperationLog'

/** In-memory backend: same contract as IndexedDB, runnable under node vitest. */
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

function entry(n: number, overrides: Partial<LoggedOperation> = {}) {
  return {
    operationId: (n.toString(16).padStart(64, '0') as string),
    actorId: 'actor-1',
    actorSequence: n,
    createdAt: 1000 + n,
    record: { n },
    status: 'committed' as const,
    attempts: 0,
    updatedAt: 1000 + n,
    ...overrides,
  }
}

describe('SocialOperationLog (L1 slice 1)', () => {
  let backend: ReturnType<typeof memoryBackend>
  let log: SocialOperationLog

  beforeEach(() => {
    backend = memoryBackend()
    log = new SocialOperationLog(backend)
  })

  it('appends durably and is idempotent by operation id', async () => {
    const first = await log.append(entry(1))
    expect(first.outcome).toBe('appended')
    const again = await log.append(entry(1))
    expect(again.outcome).toBe('duplicate')
    expect(again.entry).toEqual(first.entry)
    expect(backend.store.size).toBe(1)
  })

  it('rejects invalid ids and oversized records instead of claiming success', async () => {
    await expect(log.append({ ...entry(2), operationId: 'not-hex' })).rejects.toThrow(/invalid operation id/)
    const huge = { ...entry(3), record: { blob: 'x'.repeat(MAX_RECORD_BYTES) } }
    await expect(log.append(huge)).rejects.toThrow(/too large/)
    expect(backend.store.size).toBe(0)
  })

  it('advances status monotonically and bumps attempts', async () => {
    await log.append(entry(1))
    expect(await log.advanceStatus(entry(1).operationId, 'sending')).toBe(true)
    expect(await log.advanceStatus(entry(1).operationId, 'committed')).toBe(false)
    expect(await log.advanceStatus(entry(1).operationId, 'sending')).toBe(false)
    expect(await log.advanceStatus(entry(1).operationId, 'delivered')).toBe(true)
    expect(await log.advanceStatus(entry(1).operationId, 'sending')).toBe(false)
    expect(await log.bumpAttempts(entry(1).operationId)).toBe(true)
    const stored = backend.store.get(entry(1).operationId)!
    expect(stored.status).toBe('delivered')
    expect(stored.attempts).toBe(1)
    expect(await log.advanceStatus('f'.repeat(64), 'delivered')).toBe(false)
  })

  it('lists pending entries oldest-first and never lists delivered ones', async () => {
    await log.append(entry(3))
    await log.append(entry(1))
    await log.append(entry(2))
    await log.advanceStatus(entry(2).operationId, 'delivered')
    const pending = await log.listPendingOperations()
    expect(pending.map((item) => item.actorSequence)).toEqual([1, 3])
  })

  it('prunes only delivered entries past the grace window', async () => {
    const now = Date.now()
    await log.append(entry(1, { createdAt: now - DELIVERED_GRACE_MS - 10_000, updatedAt: now - DELIVERED_GRACE_MS - 10_000 }))
    await log.append(entry(2, { createdAt: now - DELIVERED_GRACE_MS - 10_000, updatedAt: now - DELIVERED_GRACE_MS - 10_000 }))
    await log.advanceStatus(entry(1).operationId, 'delivered')
    // Age the delivered entry past the grace window (delivery refreshed updatedAt).
    const aged = backend.store.get(entry(1).operationId)!
    backend.store.set(entry(1).operationId, { ...aged, updatedAt: now - DELIVERED_GRACE_MS - 10_000 })
    const removed = await log.prune(now)
    expect(removed).toBe(1)
    expect(backend.store.has(entry(1).operationId)).toBe(false)
    expect(backend.store.has(entry(2).operationId)).toBe(true)
  })

  it('evicts oldest delivered entries at capacity and refuses to evict undelivered', async () => {
    for (let i = 1; i <= 4; i += 1) {
      const appended = await log.append(entry(i))
      if (i <= 2) await log.advanceStatus(entry(i).operationId, 'delivered')
      expect(appended.outcome).toBe('appended')
    }
    // Log now: 1,2 delivered; 3,4 pending.
    for (let i = 5; i <= MAX_LOG_ENTRIES + 2; i += 1) {
      await log.append(entry(i))
    }
    // Cap reached with more pending than slots: further appends of NEW pending must fail.
    await expect(log.append(entry(MAX_LOG_ENTRIES + 3))).rejects.toThrow(/full of undelivered/)
    expect(backend.store.size).toBe(MAX_LOG_ENTRIES)
    // Delivered entries were evicted first.
    expect(backend.store.has(entry(1).operationId)).toBe(false)
    expect(backend.store.has(entry(2).operationId)).toBe(false)
    expect(backend.store.has(entry(3).operationId)).toBe(true)
  })

  it('propagates backend failures so callers never claim false durability', async () => {
    const failing: OperationLogBackend = {
      ...memoryBackend(),
      async put() { throw new Error('disk full') },
    }
    const failingLog = new SocialOperationLog(failing)
    await expect(failingLog.append(entry(1))).rejects.toThrow(/disk full/)
  })

  it('shape-checks entries so tampered rows never enter or leave the pending list', () => {
    expect(isValidLogEntryShape(entry(1))).toBe(true)
    expect(isValidLogEntryShape({ ...entry(1), status: 'bogus' })).toBe(false)
    expect(isValidLogEntryShape({ ...entry(1), actorSequence: 0 })).toBe(false)
    expect(isValidLogEntryShape({ ...entry(1), record: 'not-an-object' })).toBe(false)
    expect(isValidLogEntryShape(null)).toBe(false)
  })

  it('exposes an IndexedDB backend constructor for the renderer', () => {
    expect(typeof createIndexedDbOperationLogBackend).toBe('function')
  })
})
