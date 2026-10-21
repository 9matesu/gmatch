import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import { acceptInboundOperation } from './socialOpTransport'
import { publishSignedPostOperation } from './socialPublish'
import {
  publishComment,
  publishCommentDelete,
  publishReactionAdd,
  publishReactionRemove,
} from './socialInteraction'
import { projectComments, projectReactions, reactionKey } from './socialInteractionProjection'

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

/** A peer publishes a post; we accept it, so the post exists in OUR log. */
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

describe('signed social state (L5.1)', () => {
  it('likes and unlikes a peer-replicated post', async () => {
    const log = newLog()
    await peerPostIn(log)

    await publishReactionAdd(ME, { targetType: 'post', targetId: 'post-1' }, log)
    const liked = projectReactions(await log.listAllOperations())
    expect(liked.get(reactionKey('post', 'post-1'))).toMatchObject({ count: 1, actors: [ME.orbitId] })

    await publishReactionRemove(ME, { targetType: 'post', targetId: 'post-1' }, log)
    const unliked = projectReactions(await log.listAllOperations())
    expect(unliked.get(reactionKey('post', 'post-1'))?.count ?? 0).toBe(0)
  })

  it('refuses a reaction whose target is not in the local log', async () => {
    const log = newLog()
    await expect(publishReactionAdd(ME, { targetType: 'post', targetId: 'ghost' }, log))
      .rejects.toThrow(/unavailable/)
  })

  it('refuses an un-like without an active like', async () => {
    const log = newLog()
    await peerPostIn(log)
    await expect(publishReactionRemove(ME, { targetType: 'post', targetId: 'post-1' }, log))
      .rejects.toThrow(/no active reaction/)
  })

  it('creates a comment thread and deletes only the author’s own comment', async () => {
    const log = newLog()
    await peerPostIn(log)

    await publishComment(ME, { postId: 'post-1', parentCommentId: null, body: 'first', commentId: 'c1' }, log)
    await publishComment(ME, { postId: 'post-1', parentCommentId: 'c1', body: 'reply', commentId: 'c2' }, log)

    const threads = projectComments(await log.listAllOperations())
    const top = threads.get('post-1') ?? []
    expect(top).toHaveLength(1)
    expect(top[0].body).toBe('first')
    expect(top[0].replies).toHaveLength(1)
    expect(top[0].replies[0].body).toBe('reply')

    // A different actor cannot delete our comment.
    const target = (await log.listAllOperations())
      .map((entry) => entry.record as { type?: string; operationId?: string; objectId?: string })
      .find((record) => record.type === 'comment.create' && record.objectId === 'c1')
    await expect(publishCommentDelete(PEER, target!.operationId!, log)).rejects.toThrow(/author/)
    await publishCommentDelete(ME, target!.operationId!, log)

    const after = projectComments(await log.listAllOperations())
    // The reply outlives its deleted parent: it stays, promoted to top level.
    const remaining = after.get('post-1') ?? []
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe('reply')
  })
})
