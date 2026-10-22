import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { acceptInboundOperation } from '../services/socialOpTransport'
import { publishSignedPostOperation } from '../services/socialPublish'
import { publishComment, publishReactionAdd } from '../services/socialInteraction'
import { peerCommentsByPost } from './usePeerComments'

const PEER = restoreIdentity('22'.repeat(32), '33'.repeat(32))
const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))

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

function newLog() {
  return new SocialOperationLog(memoryBackend())
}

async function peerPostIn(log: SocialOperationLog) {
  const peerLog = newLog()
  const operation = await publishSignedPostOperation(PEER, {
    objectId: 'post-1',
    contentCid: 'c'.repeat(64),
    mimeType: 'image/jpeg',
    sizeBytes: 10,
  }, peerLog)
  expect(await acceptInboundOperation(log, operation)).toBe('accepted')
  return operation
}

describe('peer comments projection (read half)', () => {
  it('renders a peer comment thread in the shape the feed shows', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishComment(PEER, { postId: 'post-1', parentCommentId: null, body: 'from a peer', commentId: 'c1' }, log)
    await publishComment(ME, { postId: 'post-1', parentCommentId: 'c1', body: 'and a reply', commentId: 'c2' }, log)

    const byPost = peerCommentsByPost(await log.listAllOperations(), ME.orbitId)
    const rows = byPost.get('post-1') ?? []
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe('c1')
    expect(rows[0].text).toBe('from a peer')
    expect(rows[0].author_id).toBe(PEER.orbitId)
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The reply keeps the parent link, so the feed nests it.
    expect(rows[1].parent_comment_id).toBe('c1')
  })

  it('folds a peer like on a peer comment into its count', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishComment(PEER, { postId: 'post-1', parentCommentId: null, body: 'like me', commentId: 'c1' }, log)
    await publishReactionAdd(ME, { targetType: 'comment', targetId: 'c1' }, log)

    const byPost = peerCommentsByPost(await log.listAllOperations(), ME.orbitId)
    const row = (byPost.get('post-1') ?? [])[0]
    expect(row.like_count).toBe(1)
    expect(row.is_liked).toBe(true)
  })

  it('has no rows for a post nobody commented on', async () => {
    const log = newLog()
    await peerPostIn(log)
    const byPost = peerCommentsByPost(await log.listAllOperations())
    expect(byPost.size).toBe(0)
  })
})
