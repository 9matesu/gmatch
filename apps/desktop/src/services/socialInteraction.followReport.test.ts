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
import { projectFollowEdgesFor, projectFollows, projectFollowState, projectReportsFor } from '../services/socialInteractionProjection'

const PEER = restoreIdentity('22'.repeat(32), '33'.repeat(32))
const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const OTHER = restoreIdentity('44'.repeat(32), '55'.repeat(32))

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

  it('remembers the unfollowed target so a stale node row can be masked', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    const opId = activeFollowOperationId(await log.listAllOperations(), ME.orbitId, PEER.orbitId)!
    await publishUnfollow(ME, opId, log)

    // The node's own follower row can lag (or the unfollow never reached it),
    // so the reader needs to know WHICH ids the operation withdrew, not just
    // that they are absent from the active set.
    const state = projectFollowState(await log.listAllOperations())
    expect(state.following.get(ME.orbitId)?.has(PEER.orbitId) ?? false).toBe(false)
    expect(state.removed.get(ME.orbitId)?.has(PEER.orbitId)).toBe(true)
    expect(state.removed.get(PEER.orbitId)).toBeUndefined()
  })

  it('a re-follow is active again and no longer masked', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    const opId = activeFollowOperationId(await log.listAllOperations(), ME.orbitId, PEER.orbitId)!
    await publishUnfollow(ME, opId, log)
    await publishFollow(ME, PEER.orbitId, log)

    const state = projectFollowState(await log.listAllOperations())
    expect(state.following.get(ME.orbitId)?.has(PEER.orbitId)).toBe(true)
    expect(state.removed.get(ME.orbitId)?.has(PEER.orbitId) ?? false).toBe(false)
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

describe('the follow edges around one profile (both tabs, local-first)', () => {
  it('reads who follows me and who I follow from the operations alone', async () => {
    const log = newLog()
    await publishFollow(PEER, ME.orbitId, log)
    await publishFollow(ME, OTHER.orbitId, log)

    const mine = projectFollowEdgesFor(await log.listAllOperations(), ME.orbitId)
    expect([...mine.followers]).toEqual([PEER.orbitId])
    expect([...mine.following]).toEqual([OTHER.orbitId])
    expect(mine.withdrawnFollowers.size).toBe(0)
    expect(mine.withdrawnFollowing.size).toBe(0)

    const theirs = projectFollowEdgesFor(await log.listAllOperations(), PEER.orbitId)
    expect(theirs.followers).toHaveLength(0)
    expect([...theirs.following]).toEqual([ME.orbitId])
  })

  it('an unfollow masks the follower row the node may still list', async () => {
    const log = newLog()
    await publishFollow(PEER, ME.orbitId, log)
    const opId = activeFollowOperationId(await log.listAllOperations(), PEER.orbitId, ME.orbitId)!
    await publishUnfollow(PEER, opId, log)

    const edges = projectFollowEdgesFor(await log.listAllOperations(), ME.orbitId)
    expect(edges.followers.size).toBe(0)
    expect([...edges.withdrawnFollowers]).toEqual([PEER.orbitId])
  })

  it('masks the people I unfollowed from my following tab', async () => {
    const log = newLog()
    await publishFollow(ME, PEER.orbitId, log)
    const opId = activeFollowOperationId(await log.listAllOperations(), ME.orbitId, PEER.orbitId)!
    await publishUnfollow(ME, opId, log)

    const edges = projectFollowEdgesFor(await log.listAllOperations(), ME.orbitId)
    expect(edges.following.size).toBe(0)
    expect([...edges.withdrawnFollowing]).toEqual([PEER.orbitId])
  })

  it('a re-follow is active again and no longer masked', async () => {
    const log = newLog()
    await publishFollow(PEER, ME.orbitId, log)
    const opId = activeFollowOperationId(await log.listAllOperations(), PEER.orbitId, ME.orbitId)!
    await publishUnfollow(PEER, opId, log)
    await publishFollow(PEER, ME.orbitId, log)

    const edges = projectFollowEdgesFor(await log.listAllOperations(), ME.orbitId)
    expect([...edges.followers]).toEqual([PEER.orbitId])
    expect(edges.withdrawnFollowers.size).toBe(0)
  })

  it('an empty target has no edges at all', () => {
    const edges = projectFollowEdgesFor([], '')
    expect(edges.followers.size).toBe(0)
    expect(edges.following.size).toBe(0)
    expect(edges.withdrawnFollowers.size).toBe(0)
    expect(edges.withdrawnFollowing.size).toBe(0)
  })
})
