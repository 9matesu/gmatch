import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import {
  DEFAULT_IMPORT_LIMIT,
  importedObjectIds,
  importLocalPosts,
  selectImportCandidates,
  type ImportablePost,
} from './socialPostImport'
import { projectPosts } from './socialFeedProjection'

const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const OTHER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

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

function post(overrides: Partial<ImportablePost> = {}): ImportablePost {
  return {
    id: 'post-1',
    owner_id: ME.orbitId,
    content_hash: 'a'.repeat(64),
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    caption: 'mine',
    tags: ['art'],
    is_public: 1,
    ...overrides,
  }
}

describe('local post import (migration)', () => {
  it('selects only own, public, hash-bearing posts', () => {
    const objects = [
      post({ id: 'p1' }),
      post({ id: 'p2', owner_id: OTHER.orbitId }),
      post({ id: 'p3', is_public: 0 }),
      post({ id: 'p4', content_hash: null }),
      post({ id: 'p5', size_bytes: 0 }),
      post({ id: 'p6' }),
    ]
    const selected = selectImportCandidates(objects, { selfId: ME.orbitId })
    expect(selected.map((o) => o.id)).toEqual(['p1', 'p6'])
  })

  it('caps the number of posts per run', () => {
    const objects = Array.from({ length: 10 }, (_, i) => post({ id: `p${i}` }))
    expect(selectImportCandidates(objects, { selfId: ME.orbitId, limit: 3 })).toHaveLength(3)
    expect(selectImportCandidates(objects, { selfId: ME.orbitId, limit: DEFAULT_IMPORT_LIMIT })).toHaveLength(10)
  })

  it('imports once and is idempotent on a second run', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const objects = [post({ id: 'p1' }), post({ id: 'p2' })]
    const candidates = selectImportCandidates(objects, { selfId: ME.orbitId })

    const first = await importLocalPosts(ME, candidates, log)
    expect(first.errors).toEqual([])
    expect(first.imported).toBe(2)

    // Second run: nothing is imported again (idempotent by objectId).
    const already = await importedObjectIds(log)
    expect([...already].sort()).toEqual(['p1', 'p2'])
    const second = await importLocalPosts(ME, selectImportCandidates(objects, { selfId: ME.orbitId, alreadyImported: already }), log)
    expect(second.imported).toBe(0)
    // Even without the pre-filter, the service itself refuses to re-import.
    const third = await importLocalPosts(ME, selectImportCandidates(objects, { selfId: ME.orbitId }), log)
    expect(third.imported).toBe(0)
    expect(third.skipped).toBe(2)

    const projected = projectPosts(await log.listAllOperations())
    expect(projected.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('never imports another user’s post', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const objects = [post({ id: 'theirs', owner_id: OTHER.orbitId })]
    const candidates = selectImportCandidates(objects, { selfId: ME.orbitId })
    expect(candidates).toHaveLength(0)
    const summary = await importLocalPosts(ME, candidates, log)
    expect(summary.imported).toBe(0)
    expect(await log.listAllOperations()).toHaveLength(0)
  })
})
