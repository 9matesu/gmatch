import { describe, expect, it, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import {
  SocialOperationLog,
  type LoggedOperation,
  type OperationLogBackend,
} from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'
import { acceptInboundOperation } from './socialOpTransport'
import { projectPosts } from './socialFeedProjection'
import { projectedPostsToFeedPosts } from '../hooks/usePeerFeedPosts'
import { projectFeed } from '../features/feed/feedProjection'
import { resolveContentAddressedMedia } from '../utils/contentAddressedMedia'
import { SwarmTestNetwork } from '../utils/swarmHarness'
import { sha256HexBlob } from '../utils/p2pSwarm'

/**
 * L4 acceptance, executed: a post and its media cross from A to B with NO node
 * in the loop.
 *
 * A durably commits a signed `post.create`, then its bytes exist only on the
 * swarm (seeded under the content hash — the durable key). B accepts the
 * operation, projects the feed row, and pulls the media addressed by the row's
 * own `content_hash`, verifying the sha256 before anything is stored. There is
 * no `/api/objects` step anywhere: the bytes are found from their content.
 *
 * The tampered-seeder case is the other half of the same rule: addressing by
 * hash is only worth anything if bytes that do not hash to it are refused.
 */

const AUTHOR = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const READER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

function memoryBackend(): OperationLogBackend {
  const store = new Map<string, LoggedOperation>()
  return {
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

const PICTURE = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])], { type: 'image/png' })

describe('L4 join: a peer post and its media, with no node', () => {
  it('carries the content address from publish to a verified render', async () => {
    const contentHash = await sha256HexBlob(PICTURE)
    const net = new SwarmTestNetwork()
    const a = net.createNode('author')
    const b = net.createNode('reader')

    // A: the bytes live on the swarm, addressed by their content hash only.
    a.session.registerLocalObject(contentHash, PICTURE)

    // A: the signed operation is durably committed before any network call.
    const logA = new SocialOperationLog(memoryBackend())
    const operation = await publishSignedPostOperation(AUTHOR, {
      objectId: 'post-object-1',
      contentCid: contentHash,
      mimeType: 'image/png',
      sizeBytes: PICTURE.size,
      caption: 'a picture that lives on the peers',
      tags: 'portrait,solo',
    }, logA)

    // B: accepts the operation into its OWN log (signature, manifest, chain).
    const logB = new SocialOperationLog(memoryBackend())
    expect(await acceptInboundOperation(logB, operation)).toBe('accepted')

    // B: the projection yields a feed row that still names its content.
    const projected = projectPosts(await logB.listAllOperations())
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: 'post-object-1',
      authorId: AUTHOR.orbitId,
      contentCid: contentHash,
    })

    const rows = projectedPostsToFeedPosts(projected, READER.orbitId)
    expect(rows[0]).toMatchObject({
      id: 'post-object-1',
      origin: 'peer',
      url: '/api/objects/post-object-1',
      content_hash: contentHash,
    })

    // B: the row survives the timeline merge with its content address intact.
    const merged = projectFeed({
      items: [],
      optimisticPosts: [],
      localPending: [],
      pinnedPosts: [],
      peerFeedPosts: rows,
      serverPosts: [],
      repostedPosts: [],
      myProfilePosts: [],
      deletedPostIds: new Set(),
      archivedPostIds: new Set(),
      users: [],
      profilePics: {},
      identity: { orbitId: READER.orbitId },
      myProfile: { displayName: 'reader' },
    })
    expect(merged[0].content_hash).toBe(contentHash)

    // B: resolves the media from the row's content, never from a node.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const bytes = await resolveContentAddressedMedia(merged[0].id, merged[0].content_hash!, {
        timeoutMs: 3000,
        deps: {
          readLocal: async (id) => b.durable.get(id) ?? null,
          requestSwarm: (id, timeoutMs, opts) => b.session.requestObject(id, timeoutMs, opts.expectedHash),
        },
      })

      expect(bytes).not.toBeNull()
      expect(await sha256HexBlob(bytes!)).toBe(contentHash)
      expect(new Uint8Array(await bytes!.arrayBuffer())).toEqual(new Uint8Array(await PICTURE.arrayBuffer()))
      // Verified before it was stored: B's durable store now holds it.
      expect(b.durable.get(contentHash)?.size).toBe(PICTURE.size)
      // The one request that would have needed a node was never made.
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses bytes from a peer that does not hash to the row address', async () => {
    const contentHash = await sha256HexBlob(PICTURE)
    const net = new SwarmTestNetwork()
    const liar = net.createNode('liar')
    const b = net.createNode('reader')

    // The liar advertises the content hash but holds different bytes.
    liar.session.registerLocalObject(contentHash, new Blob(['not the picture'], { type: 'image/png' }))

    const bytes = await resolveContentAddressedMedia('post-object-1', contentHash, {
      timeoutMs: 500,
      deps: {
        readLocal: async (id) => b.durable.get(id) ?? null,
        requestSwarm: (id, timeoutMs, opts) => b.session.requestObject(id, timeoutMs, opts.expectedHash),
      },
    })

    expect(bytes).toBeNull()
    expect(b.durable.has(contentHash)).toBe(false)
  })
})