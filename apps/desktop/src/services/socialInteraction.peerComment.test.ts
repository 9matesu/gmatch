import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { acceptInboundOperation } from '../services/socialOpTransport'
import { publishSignedPostOperation } from '../services/socialPublish'
import {
  commentPersistenceRoute,
  persistPeerComment,
  publishComment,
} from '../services/socialInteraction'
import { projectComments } from '../services/socialInteractionProjection'

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

describe('peer comments (L5.2 write path)', () => {
  it('routes a comment to the peer operation path only for peer content', () => {
    expect(commentPersistenceRoute({ origin: 'peer' })).toBe('peer-operation')
    expect(commentPersistenceRoute({ origin: 'server' })).toBe('server')
    expect(commentPersistenceRoute(undefined)).toBe('server')
    expect(commentPersistenceRoute(null)).toBe('server')
  })

  it('persists a peer comment as a signed operation', async () => {
    const log = newLog()
    await peerPostIn(log)
    await persistPeerComment(ME, {
      postId: 'post-1',
      parentCommentId: null,
      body: 'hello from the peer path',
      commentId: 'c_peer_1',
    }, log)

    const threads = projectComments(await log.listAllOperations())
    const top = threads.get('post-1') ?? []
    expect(top).toHaveLength(1)
    expect(top[0].body).toBe('hello from the peer path')
    expect(top[0].authorId).toBe(ME.orbitId)
    expect(top[0].id).toBe('c_peer_1')
  })

  it('keeps the reply under its parent and refuses a comment on an unknown post', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishComment(ME, { postId: 'post-1', parentCommentId: null, body: 'root', commentId: 'c_root' }, log)
    await persistPeerComment(ME, {
      postId: 'post-1',
      parentCommentId: 'c_root',
      body: 'reply',
      commentId: 'c_reply',
    }, log)

    const threads = projectComments(await log.listAllOperations())
    const top = threads.get('post-1') ?? []
    expect(top).toHaveLength(1)
    expect(top[0].replies).toHaveLength(1)
    expect(top[0].replies[0].body).toBe('reply')

    // A post that is not in the local log has no commentable target.
    await expect(publishComment(ME, {
      postId: 'ghost-post',
      parentCommentId: null,
      body: 'nope',
      commentId: 'c_ghost',
    }, log)).rejects.toThrow(/unavailable|not found/i)
  })
})
