import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import {
  SocialOperationLog,
  type LoggedOperation,
  type OperationLogBackend,
} from './socialOperationLog'
import { projectPosts } from './socialFeedProjection'
import { sha256HexBlob } from '../utils/p2pSwarm'
import {
  AUTO_IMPORT_LIMIT,
  MAX_IMPORT_PER_RUN,
  __resetAutoReplicateForTests,
  autoReplicateOwnPosts,
  importOwnPosts,
  type ImportOwnPostsDeps,
  type ImportablePost,
} from './socialPostImport'

/**
 * Importing your OWN existing posts into the signed log is what keeps old
 * content visible to peers after the feed stops being node-authoritative.
 *
 * The rules pinned here are the ones that make it safe to run at all: only
 * public feed posts, idempotent by object id, bytes are required and verified,
 * a tombstone wins, and nothing is ever deleted or re-addressed.
 */

// The node route is mocked file-wide: the descriptor guard lives in the
// DEFAULT deps, and that guard is exactly what one of these tests is about.
const orbit = vi.hoisted(() => ({ orbitFetch: vi.fn() }))
vi.mock('../utils/api', () => ({ orbitFetch: orbit.orbitFetch }))

vi.mock('../utils/p2pSwarm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/p2pSwarm')>()
  return {
    ...mod,
    getLocalObject: vi.fn(async () => null),
    registerLocalObject: vi.fn(),
  }
})

const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const PICTURE = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6])], { type: 'image/png' })

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

function row(overrides: Partial<ImportablePost> = {}): ImportablePost {
  return {
    id: 'post-1',
    contentHash: null,
    mimeType: 'image/png',
    sizeBytes: null,
    caption: 'old but gold',
    tags: 'portrait',
    isPublic: true,
    isStory: false,
    isAvatar: false,
    isChat: false,
    ...overrides,
  }
}

function deps(overrides: Partial<ImportOwnPostsDeps> = {}): ImportOwnPostsDeps & {
  seed: ReturnType<typeof vi.fn>
  readLocal: ReturnType<typeof vi.fn>
  fetchFromNode: ReturnType<typeof vi.fn>
} {
  return {
    listOwnPosts: vi.fn(async () => [row()]),
    readLocal: vi.fn(async () => PICTURE),
    fetchFromNode: vi.fn(async () => null),
    hash: (blob) => sha256HexBlob(blob),
    seed: vi.fn(),
    isDeleted: () => false,
    ...overrides,
  } as ImportOwnPostsDeps & {
    seed: ReturnType<typeof vi.fn>
    readLocal: ReturnType<typeof vi.fn>
    fetchFromNode: ReturnType<typeof vi.fn>
  }
}

describe('importOwnPosts (L4 migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orbit.orbitFetch.mockResolvedValue(new Response('{}', { status: 404 }))
  })

  it('turns an own public post into a signed operation, seeding id and hash', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps()

    const summary = await importOwnPosts(ME, log, { deps: d })
    const hash = await sha256HexBlob(PICTURE)

    expect(summary.imported).toHaveLength(1)
    expect(summary.skipped).toEqual([])
    expect(summary.bytesSeeded).toBe(1)

    // Bytes are locally servable under BOTH names before the operation exists.
    expect(d.seed).toHaveBeenCalledWith('post-1', PICTURE)
    expect(d.seed).toHaveBeenCalledWith(hash, PICTURE)

    const [projected] = projectPosts(await log.listAllOperations())
    expect(projected).toMatchObject({
      id: 'post-1',
      authorId: ME.orbitId,
      caption: 'old but gold',
      contentCid: hash,
      mimeType: 'image/png',
      sizeBytes: PICTURE.size,
    })
  })

  it('skips a story, an avatar, a chat attachment and a private row', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps({
      listOwnPosts: vi.fn(async () => [
        row({ id: 'story-1', isStory: true }),
        row({ id: 'avatar-1', isAvatar: true }),
        row({ id: 'chat-1', isChat: true }),
        row({ id: 'private-1', isPublic: false }),
      ]),
    })

    const summary = await importOwnPosts(ME, log, { deps: d })

    expect(summary.imported).toEqual([])
    expect(summary.skipped.map((s) => s.reason)).toEqual(['not-public', 'not-public', 'not-public', 'not-public'])
    // Nothing private is ever read or seeded.
    expect(d.readLocal).not.toHaveBeenCalled()
    expect(d.seed).not.toHaveBeenCalled()
  })

  it('is idempotent: a post already in the log is not created twice', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps()

    const first = await importOwnPosts(ME, log, { deps: d })
    const second = await importOwnPosts(ME, log, { deps: d })

    expect(first.imported).toHaveLength(1)
    expect(second.imported).toEqual([])
    expect(second.skipped).toEqual([{ id: 'post-1', reason: 'already' }])
    expect((await log.listAllOperations())).toHaveLength(1)
  })

  it('never resurrects a deleted post', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps({ isDeleted: (id) => id === 'post-1' })

    const summary = await importOwnPosts(ME, log, { deps: d })

    expect(summary.imported).toEqual([])
    expect(summary.skipped).toEqual([{ id: 'post-1', reason: 'deleted' }])
    expect(d.readLocal).not.toHaveBeenCalled()
  })

  it('refuses bytes that do not match the address the node declared', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps({
      listOwnPosts: vi.fn(async () => [row({ contentHash: 'f'.repeat(64) })]),
    })

    const summary = await importOwnPosts(ME, log, { deps: d })

    expect(summary.imported).toEqual([])
    expect(summary.skipped).toEqual([{ id: 'post-1', reason: 'hash-mismatch' }])
    // The wrong bytes are never seeded under the declared address either.
    expect(d.seed).not.toHaveBeenCalled()
    expect(await log.listAllOperations()).toEqual([])
  })

  it('falls back to the node when the bytes are not on this machine', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps({
      readLocal: vi.fn(async () => null),
      fetchFromNode: vi.fn(async () => PICTURE),
    })

    const summary = await importOwnPosts(ME, log, { deps: d })

    expect(summary.imported).toHaveLength(1)
    expect(d.fetchFromNode).toHaveBeenCalledWith('post-1')
    expect(d.seed).toHaveBeenCalledWith(await sha256HexBlob(PICTURE), PICTURE)
  })

  it('skips a post whose bytes are nowhere', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const d = deps({
      readLocal: vi.fn(async () => null),
      fetchFromNode: vi.fn(async () => null),
    })

    const summary = await importOwnPosts(ME, log, { deps: d })

    expect(summary.imported).toEqual([])
    expect(summary.skipped).toEqual([{ id: 'post-1', reason: 'no-bytes' }])
  })

  it('never treats a descriptor (JSON) from the node as media', async () => {
    const log = new SocialOperationLog(memoryBackend())
    // Default deps for the node read: only local bytes and seeding are stubbed.
    orbit.orbitFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/posts')) {
        return new Response(JSON.stringify({ posts: [{ id: 'post-1', mime_type: 'image/png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // A row the node does not physically hold: it answers with a `p2p`
      // descriptor, which is JSON, not bytes.
      return new Response(JSON.stringify({ type: 'p2p', id: 'post-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const summary = await importOwnPosts(ME, log, {
      deps: { readLocal: vi.fn(async () => null), seed: vi.fn() },
    })

    expect(summary.imported).toEqual([])
    expect(summary.skipped).toEqual([{ id: 'post-1', reason: 'no-bytes' }])
  })

  it('reports an unreadable node as nothing to import, never as an error', async () => {
    const log = new SocialOperationLog(memoryBackend())
    orbit.orbitFetch.mockImplementation(async () => { throw new Error('down') })

    const summary = await importOwnPosts(ME, log, {
      deps: { readLocal: vi.fn(async () => null), seed: vi.fn() },
    })

    expect(summary).toEqual({ imported: [], skipped: [], bytesSeeded: 0 })
  })

  it('caps the candidates per run so one click cannot become a stampede', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const listOwnPosts = vi.fn(async () => [row()])

    await importOwnPosts(ME, log, { limit: 5_000, deps: deps({ listOwnPosts }) })

    expect(listOwnPosts).toHaveBeenCalledWith(MAX_IMPORT_PER_RUN)
  })
})

describe('autoReplicateOwnPosts (foreground / peer-online reconcile)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetAutoReplicateForTests()
  })

  it('flushes the outbox, signs my posts for peers and refreshes the feed once', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const flushOutbox = vi.fn(async () => ({ registered: 1 }))
    const refreshFeed = vi.fn()
    const d = deps()

    const ran = await autoReplicateOwnPosts(ME, log, {
      flushOutbox, refreshFeed, importDeps: d,
    })

    expect(ran).toBe(true)
    expect(flushOutbox).toHaveBeenCalledOnce()
    expect(d.listOwnPosts).toHaveBeenCalledWith(AUTO_IMPORT_LIMIT)
    expect(projectPosts(await log.listAllOperations())).toHaveLength(1)
    expect(refreshFeed).toHaveBeenCalledOnce()
  })

  it('does not storm: a second hint inside the interval does no work', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const flushOutbox = vi.fn(async () => ({}))
    const d = deps()

    expect(await autoReplicateOwnPosts(ME, log, { flushOutbox, importDeps: d })).toBe(true)
    expect(await autoReplicateOwnPosts(ME, log, { flushOutbox, importDeps: d })).toBe(false)
    expect(flushOutbox).toHaveBeenCalledOnce()
    expect(d.listOwnPosts).toHaveBeenCalledOnce()
  })
})