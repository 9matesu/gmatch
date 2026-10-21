import { describe, expect, it } from 'vitest'
import type { LoggedOperation, OperationLogStatus } from './socialOperationLog'
import { projectPosts } from './socialFeedProjection'

let seq = 0

function op(overrides: Partial<LoggedOperation> & {
  type: 'post.create' | 'post.edit' | 'post.delete'
  payload: Record<string, unknown>
  objectId: string
  actorId?: string
  actorSequence?: number
  createdAt?: number
}, status: OperationLogStatus = 'committed'): LoggedOperation {
  seq += 1
  const operationId = (overrides.operationId ?? `${seq}`.padStart(64, 'a'))
  return {
    operationId,
    actorId: overrides.actorId ?? 'actor-1',
    actorSequence: overrides.actorSequence ?? seq,
    createdAt: overrides.createdAt ?? 1_000 + seq,
    status,
    attempts: 0,
    updatedAt: 0,
    record: {
      protocol: 'gmatch-social',
      version: 1,
      type: overrides.type,
      operationId,
      actorId: overrides.actorId ?? 'actor-1',
      signingKey: 'k'.repeat(64),
      actorSequence: overrides.actorSequence ?? seq,
      previousOperationId: null,
      createdAt: overrides.createdAt ?? 1_000 + seq,
      objectId: overrides.objectId,
      payload: overrides.payload,
      signature: 's'.repeat(128),
    },
  }
}

const create = (objectId: string, extra: Record<string, unknown> = {}) => op({
  type: 'post.create',
  objectId,
  payload: { contentCid: 'c'.repeat(64), manifestHash: 'm'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 10, caption: 'hello', ...extra },
})

describe('socialFeedProjection (L4.1)', () => {
  it('projects an accepted post.create into one post keyed by objectId', () => {
    const posts = projectPosts([create('post-a')], { isBlockedTag: () => false })
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: 'post-a',
      authorId: 'actor-1',
      mimeType: 'image/jpeg',
      caption: 'hello',
      edited: false,
      status: 'committed',
    })
  })

  it('applies an edit as the new head (caption, media, edited flag)', () => {
    const created = create('post-a')
    const edited = op({
      type: 'post.edit',
      objectId: 'post-a',
      payload: {
        supersedes: [created.operationId],
        contentCid: 'd'.repeat(64),
        manifestHash: 'n'.repeat(64),
        mimeType: 'image/png',
        sizeBytes: 20,
        caption: 'fixed',
      },
    })
    const posts = projectPosts([created, edited], { isBlockedTag: () => false })
    expect(posts).toHaveLength(1)
    expect(posts[0].caption).toBe('fixed')
    expect(posts[0].mimeType).toBe('image/png')
    expect(posts[0].headOperationId).toBe(edited.operationId)
    expect(posts[0].edited).toBe(true)
  })

  it('hides a tombstoned post', () => {
    const created = create('post-a')
    const deleted = op({
      type: 'post.delete',
      objectId: 'post-a',
      payload: { targetOperationId: created.operationId },
    })
    expect(projectPosts([created, deleted], { isBlockedTag: () => false })).toHaveLength(0)
  })

  it('orders newest first with a stable operationId tiebreak', () => {
    const older = create('post-old')
    const newer = create('post-new')
    older.record = { ...older.record, createdAt: 5_000 }
    newer.record = { ...newer.record, createdAt: 6_000 }
    const posts = projectPosts([older, newer], { isBlockedTag: () => false })
    expect(posts.map((p) => p.id)).toEqual(['post-new', 'post-old'])

    const tieA = create('post-tie-a')
    const tieB = create('post-tie-b')
    tieA.record = { ...tieA.record, createdAt: 7_000 }
    tieB.record = { ...tieB.record, createdAt: 7_000 }
    const tied = projectPosts([tieB, tieA], { isBlockedTag: () => false })
    expect(tied.map((p) => p.id)).toEqual(['post-tie-a', 'post-tie-b'])
  })

  it('drops blocked tags instead of the post (SPEC §8 applies to remote metadata)', () => {
    const tagged = create('post-a', { tags: ['loli', 'sunset'] })
    const posts = projectPosts([tagged], { isBlockedTag: (tag) => tag === 'loli' })
    expect(posts).toHaveLength(1)
    expect(posts[0].tags).toEqual(['sunset'])
  })

  it('never projects the same objectId twice and carries delivery status', () => {
    const first = create('post-a')
    const second = create('post-a')
    const posts = projectPosts([first, second], { isBlockedTag: () => false })
    expect(posts).toHaveLength(1)
    expect(posts[0].headOperationId).toBe(first.operationId)

    const delivered = create('post-b')
    delivered.status = 'delivered'
    expect(projectPosts([delivered], { isBlockedTag: () => false })[0].status).toBe('delivered')
  })

  it('ignores operations that are not post lifecycle entries', () => {
    const entries = [create('post-a')]
    const withComment = [...entries, op({
      type: 'post.delete',
      objectId: 'post-a',
      payload: { targetOperationId: 'f'.repeat(64) },
    })]
    // A delete for a different operation id tombstones nothing.
    expect(projectPosts(withComment, { isBlockedTag: () => false })).toHaveLength(1)
  })
})
