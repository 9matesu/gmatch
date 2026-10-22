import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { acceptInboundOperation } from '../services/socialOpTransport'
import { publishSignedPostOperation } from '../services/socialPublish'
import {
  activeFollowOperationId,
  persistPeerLike,
  publishComment,
  publishFollow,
  publishReport,
  publishUnfollow,
} from '../services/socialInteraction'
import { projectFollows, projectReportsFor } from '../services/socialInteractionProjection'

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

describe('the social graph as operations (L5/L7)', () => {
  it('follows a peer and the follow shows up in the projection', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)

    const follows = projectFollows(await log.listAllOperations())
    expect(follows.get(ME.orbitId)?.has(PEER.orbitId)).toBe(true)
    expect(follows.get(PEER.orbitId)).toBeUndefined()
  })

  it('refuses a second follow of the same user, and following yourself', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    await expect(publishFollow(ME, PEER.orbitId, log)).rejects.toThrow(/already following/)
    await expect(publishFollow(ME, ME.orbitId, log)).rejects.toThrow(/yourself/)
  })

  it('unfollows by naming my own follow operation', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    const entries = await log.listAllOperations()
    const opId = activeFollowOperationId(entries, ME.orbitId, PEER.orbitId)
    expect(opId).toBeTruthy()

    await publishUnfollow(ME, opId!, log)
    const follows = projectFollows(await log.listAllOperations())
    expect(follows.get(ME.orbitId)?.has(PEER.orbitId) ?? false).toBe(false)
    // The undo is one-shot: there is no active follow left to remove.
    expect(activeFollowOperationId(await log.listAllOperations(), ME.orbitId, PEER.orbitId)).toBeNull()
  })

  it('refuses to remove somebody else\'s follow', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    const entries = await log.listAllOperations()
    const opId = activeFollowOperationId(entries, ME.orbitId, PEER.orbitId)!
    await expect(publishUnfollow(PEER, opId, log)).rejects.toThrow(/follower/)
  })

  it('reports peer content and only the author sees it', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishReport(ME, { targetType: 'post', targetId: 'post-1' }, 'not for me', log)

    // The post belongs to the peer: the report is theirs, not mine.
    const mine = projectReportsFor(await log.listAllOperations(), ME.orbitId)
    expect(mine).toHaveLength(0)
    const theirs = projectReportsFor(await log.listAllOperations(), PEER.orbitId)
    expect(theirs).toHaveLength(1)
    expect(theirs[0].reason).toBe('not for me')
    expect(theirs[0].reporterId).toBe(ME.orbitId)
  })

  it('refuses a report about content nobody published here', async () => {
    const log = newLog()
    await expect(publishReport(ME, { targetType: 'post', targetId: 'ghost' }, 'x', log))
      .rejects.toThrow(/unavailable/)
  })

  it('a peer follow does not break the reaction path', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishFollow(ME, PEER.orbitId, log)
    await persistPeerLike(ME, { targetType: 'post', targetId: 'post-1' }, true, log)
    expect((await log.listAllOperations()).length).toBe(3)
  })

  it('a comment still works next to the new operation types', async () => {
    const log = newLog()
    await peerPostIn(log)
    await publishComment(ME, { postId: 'post-1', parentCommentId: null, body: 'hi', commentId: 'c1' }, log)
    expect(projectReportsFor(await log.listAllOperations(), PEER.orbitId)).toHaveLength(0)
  })
})
