import { describe, expect, it } from 'vitest'
import type { LoggedOperation, OperationLogBackend } from './socialOperationLog'

// A fake BroadcastChannel so the cross-tab invalidation can be exercised in
// node (the real one is a browser API; the module only uses it when `window`
// exists).
class FakeChannel {
  static instances: FakeChannel[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  constructor(public readonly name: string) { FakeChannel.instances.push(this) }
  postMessage(data: unknown) {
    for (const peer of FakeChannel.instances) {
      if (peer === this) continue
      queueMicrotask(() => peer.onmessage?.({ data }))
    }
  }
  close() { FakeChannel.instances = FakeChannel.instances.filter((entry) => entry !== this) }
}

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

describe('operation log cross-tab coherence', () => {
  it('invalidates this tab’s cache when another tab writes', async () => {
    const previousWindow = (globalThis as any).window
    const previousChannel = (globalThis as any).BroadcastChannel
    ;(globalThis as any).window = { dispatchEvent: () => {} }
    ;(globalThis as any).BroadcastChannel = FakeChannel
    FakeChannel.instances = []
    try {
      const { SocialOperationLog } = await import('./socialOperationLog')
      const backend = memoryBackend()
      const tabA = new SocialOperationLog(backend)
      const tabB = new SocialOperationLog(backend)

      await tabA.listAllOperations()
      await tabB.listAllOperations()
      const afterFirst = backend.reads
      await tabB.listAllOperations()
      expect(backend.reads).toBe(afterFirst) // the second read of the same tab is cached

      // Tab A writes: tab B must not keep serving its stale list.
      const entry: LoggedOperation = {
        operationId: 'a'.repeat(64),
        actorId: 'actor-1',
        actorSequence: 1,
        createdAt: 1,
        record: { hello: 'world' },
        status: 'committed',
        attempts: 0,
        updatedAt: 1,
      }
      await tabA.append({
        operationId: entry.operationId,
        actorId: entry.actorId,
        actorSequence: entry.actorSequence,
        createdAt: entry.createdAt,
        record: entry.record,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      const seen = await tabB.listAllOperations()
      expect(seen).toHaveLength(1)
      expect(seen[0].operationId).toBe(entry.operationId)
    } finally {
      ;(globalThis as any).window = previousWindow
      ;(globalThis as any).BroadcastChannel = previousChannel
    }
  })
})
