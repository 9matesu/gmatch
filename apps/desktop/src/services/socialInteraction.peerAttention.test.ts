import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { createSocialOperation } from '@orbit/protocol'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from './socialOperationLog'
import { acceptInboundOperation } from './socialOpTransport'
import { publishSignedPostOperation } from './socialPublish'
import {
  activeFollowOperationId,
  publishComment,
  publishCommentDelete,
  publishFollow,
  publishReactionAdd,
  publishReactionRemove,
  publishReport,
  publishUnfollow,
} from './socialInteraction'
import { projectPeerAttentionFor } from './socialInteractionProjection'

/**
 * The peer notification lane: only OTHER actors' operations about MY content (or
 * about me) are news. These tests pin the honest rules — self activity is never
 * a notification, a withdrawn like/undone follow is not an event, a tombstoned
 * post/comment has nothing to say, and every row opens the thing it is about.
 */
const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const PEER = restoreIdentity('22'.repeat(32), '33'.repeat(32))
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

async function postBy(log: SocialOperationLog, identity: typeof ME, objectId: string) {
  const authorLog = newLog()
  const operation = await publishSignedPostOperation(identity, {
    objectId,
    contentCid: 'c'.repeat(64),
    mimeType: 'image/jpeg',
    sizeBytes: 10,
  }, authorLog)
  expect(await acceptInboundOperation(log, operation)).toBe('accepted')
  return operation
}

async function project(log: SocialOperationLog, selfId = ME.orbitId) {
  return projectPeerAttentionFor(await log.listAllOperations(), selfId)
}

describe('projectPeerAttentionFor (the peer notification lane)', () => {
  it('a peer like of MY post is news; the liker does not notify himself', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishReactionAdd(PEER, { targetType: 'post', targetId: 'post-mine' }, log)

    const mine = await project(log)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({
      kind: 'like',
      targetType: 'post',
      targetId: 'post-mine',
      actorId: PEER.orbitId,
    })
    expect(await project(log, PEER.orbitId)).toHaveLength(0)
  })

  it("a like of somebody else's post is not my news", async () => {
    const log = newLog()
    await postBy(log, OTHER, 'post-other')
    await publishReactionAdd(PEER, { targetType: 'post', targetId: 'post-other' }, log)
    expect(await project(log)).toHaveLength(0)
  })

  it('a withdrawn like stops being an event', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishReactionAdd(PEER, { targetType: 'post', targetId: 'post-mine' }, log)
    expect(await project(log)).toHaveLength(1)

    await publishReactionRemove(PEER, { targetType: 'post', targetId: 'post-mine' }, log)
    expect(await project(log)).toHaveLength(0)
  })

  it('a like on MY comment carries the post so the deep link can open it', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishComment(ME, { postId: 'post-mine', parentCommentId: null, body: 'mine', commentId: 'c-mine' }, log)
    await publishReactionAdd(PEER, { targetType: 'comment', targetId: 'c-mine' }, log)

    const events = await project(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'like',
      targetType: 'comment',
      targetId: 'c-mine',
      postId: 'post-mine',
    })
  })

  it('a follow notifies the followed player, and an undone follow stops', async () => {
    const log = newLog()
    await publishFollow(PEER, ME.orbitId, log)
    const followed = await project(log)
    expect(followed).toHaveLength(1)
    expect(followed[0]).toMatchObject({ kind: 'follow', targetType: 'user', targetId: PEER.orbitId })

    // My own follow of the peer is not news to me.
    await publishFollow(ME, PEER.orbitId, log)
    expect(await project(log)).toHaveLength(1)

    const opId = activeFollowOperationId(await log.listAllOperations(), PEER.orbitId, ME.orbitId)!
    await publishUnfollow(PEER, opId, log)
    expect(await project(log)).toHaveLength(0)
  })

  it('a top-level comment on my post says "comment" and carries its text', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishComment(PEER, { postId: 'post-mine', parentCommentId: null, body: 'nice one', commentId: 'c-top' }, log)

    const events = await project(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'comment',
      targetType: 'post',
      targetId: 'post-mine',
      note: 'nice one',
    })
  })

  it('a reply is news to the comment author, opening the reply itself', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishComment(ME, { postId: 'post-mine', parentCommentId: null, body: 'mine', commentId: 'c-mine' }, log)
    await publishComment(PEER, { postId: 'post-mine', parentCommentId: 'c-mine', body: 'replying', commentId: 'c-reply' }, log)

    const events = await project(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'reply',
      targetType: 'comment',
      targetId: 'c-reply',
      postId: 'post-mine',
      note: 'replying',
    })
  })

  it("a reply to somebody else's comment on my post is not my news", async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishComment(PEER, { postId: 'post-mine', parentCommentId: null, body: 'theirs', commentId: 'c-theirs' }, log)
    await publishComment(OTHER, { postId: 'post-mine', parentCommentId: 'c-theirs', body: 'reply', commentId: 'c-reply2' }, log)

    const kinds = (await project(log)).map((event) => event.kind)
    // The top-level comment from PEER is news; the reply between the two peers is not.
    expect(kinds).toEqual(['comment'])
  })

  it('a report on my comment carries the reason and the post', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishComment(ME, { postId: 'post-mine', parentCommentId: null, body: 'mine', commentId: 'c-mine' }, log)
    await publishReport(PEER, { targetType: 'comment', targetId: 'c-mine' }, 'not ok', log)

    const events = await project(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'report',
      targetType: 'comment',
      targetId: 'c-mine',
      postId: 'post-mine',
      note: 'not ok',
    })
  })

  it('a deleted comment takes its notification with it', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    const created = await publishComment(PEER, {
      postId: 'post-mine',
      parentCommentId: null,
      body: 'oops',
      commentId: 'c-deleted',
    }, log)
    expect(await project(log)).toHaveLength(1)

    await publishCommentDelete(PEER, created.operationId, log)
    expect(await project(log)).toHaveLength(0)
  })

  it('a deleted post silences everything about it', async () => {
    const log = newLog()
    const post = await postBy(log, ME, 'post-mine')
    await publishReactionAdd(PEER, { targetType: 'post', targetId: 'post-mine' }, log)
    expect(await project(log)).toHaveLength(1)

    const { actorSequence, previousOperationId } = await log.nextActorSlot(ME.orbitId)
    const deletion = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.delete',
      actorId: ME.orbitId, signingKey: ME.publicKeyHex,
      actorSequence, previousOperationId, createdAt: Date.now(),
      objectId: 'post-mine',
      payload: { targetOperationId: post.operationId },
    }, ME.privateKeyHex)
    expect(await acceptInboundOperation(log, deletion)).toBe('accepted')

    expect(await project(log)).toHaveLength(0)
  })

  it('is empty without an identity, and never notifies about my own activity', async () => {
    const log = newLog()
    await postBy(log, ME, 'post-mine')
    await publishReactionAdd(ME, { targetType: 'post', targetId: 'post-mine' }, log)
    expect(await project(log)).toHaveLength(0)
    expect(await project(log, '')).toHaveLength(0)
  })
})