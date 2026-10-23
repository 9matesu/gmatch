import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import {
  createSocialOperation,
  authorizeSocialOperation,
  validateSocialOperation,
  type SocialOperation,
} from './social-operation'

const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const OTHER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

function createFixture() {
  return createSocialOperation({
    protocol: 'gmatch-social',
    version: 1,
    type: 'post.create',
    actorId: IDENTITY.orbitId,
    signingKey: IDENTITY.publicKeyHex,
    actorSequence: 1,
    previousOperationId: null,
    createdAt: 1,
    objectId: 'obj-1',
    payload: { contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234, caption: 'hi' },
  }, IDENTITY.privateKeyHex)
}

describe('proposed social operation v1', () => {
  it('matches the fixed operation ID and signature vector', () => {
    const operation = createFixture()
    expect(operation.operationId).toBe('e9ff6abe1464a887d72a691741284f148eab6f59039c1da517a3b98a247bc8de')
    expect(operation.signature).toBe('09925018a56486ac57f248e2e630097dd5457b135893f8db9f10a5706a496c68e56647fe80b55d7868bf2c277f49c92cb99feb370d66677758e1f59d4d0d0e07')
    expect(validateSocialOperation(operation)).toBeNull()
  })

  it('canonicalizes payload key order before deriving IDs and signatures', () => {
    const base = {
      protocol: 'gmatch-social' as const,
      version: 1 as const,
      type: 'post.create',
      actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex,
      actorSequence: 1,
      previousOperationId: null,
      createdAt: 1,
      objectId: 'obj-1',
    }
    const left = createSocialOperation({ ...base, payload: { contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234, caption: 'hi', tags: ['a', 'b'] } }, IDENTITY.privateKeyHex)
    const right = createSocialOperation({ ...base, payload: { tags: ['a', 'b'], caption: 'hi', sizeBytes: 1234, mimeType: 'image/jpeg', manifestHash: 'b'.repeat(64), contentCid: 'a'.repeat(64) } }, IDENTITY.privateKeyHex)
    expect(right.operationId).toBe(left.operationId)
    expect(right.signature).toBe(left.signature)
  })

  it('rejects tampering, key substitution, unknown versions, and oversized payloads', () => {
    const operation = createFixture()
    const cases: Partial<SocialOperation>[] = [
      { ...operation, payload: { caption: 'changed' } },
      { ...operation, actorId: 'f'.repeat(64) },
      { ...operation, version: 2 as 1 },
      { ...operation, type: 'future.operation' },
      { ...operation, payload: { body: 'x'.repeat(33 * 1024) } },
      { ...operation, payload: { bad: Number.NaN } },
      { ...operation, payload: { bad: undefined } },
      { ...operation, payload: { bad: [, 1] } },
      { ...operation, payload: { bad: new Date(0) } },
      { ...operation, experimentalField: true },
    ]
    for (const invalid of cases) expect(validateSocialOperation(invalid)).not.toBeNull()
  })

  it('rejects malformed actor sequences and previous-operation references', () => {
    const operation = createFixture()
    expect(validateSocialOperation({ ...operation, actorSequence: 0 })).toMatch(/sequence/)
    expect(validateSocialOperation({ ...operation, actorSequence: 2 })).toMatch(/sequence and previous/)
    expect(validateSocialOperation({ ...operation, previousOperationId: 'broken' })).toMatch(/previous operation/)
  })

  it('validates the closed payload shapes for every proposed operation type', () => {
    const common = {
      protocol: 'gmatch-social' as const, version: 1 as const, actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 1, previousOperationId: null,
      createdAt: 1, objectId: 'post-1',
    }
    const payloads: Array<[string, Record<string, unknown>]> = [
      ['post.create', { contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 }],
      ['post.edit', { supersedes: ['c'.repeat(64)], contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 }],
      ['post.delete', { targetOperationId: 'c'.repeat(64) }],
      ['comment.create', { postId: 'post-1', parentCommentId: null, body: 'hello' }],
      ['comment.delete', { targetOperationId: 'c'.repeat(64) }],
      ['reaction.add', { targetType: 'post', targetId: 'post-1', reaction: 'like' }],
      ['reaction.remove', { targetAddOperationIds: ['c'.repeat(64)] }],
    ]
    for (const [type, payload] of payloads) {
      const operation = createSocialOperation({ ...common, type, payload }, IDENTITY.privateKeyHex)
      expect(validateSocialOperation(operation)).toBeNull()
    }
    const post = createSocialOperation({ ...common, type: 'post.create', payload: payloads[0][1] }, IDENTITY.privateKeyHex)
    expect(validateSocialOperation({ ...post, payload: { ...post.payload, unexpected: true } })).toMatch(/payload/)
  })

  it('validates profile.update as an actor-owned versioned statement', () => {
    const common = {
      protocol: 'gmatch-social' as const, version: 1 as const, actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 2, previousOperationId: 'a'.repeat(64),
      createdAt: 2, objectId: IDENTITY.orbitId,
    }
    const valid = createSocialOperation({ ...common, type: 'profile.update', payload: { displayName: 'nova', bio: 'olá' } }, IDENTITY.privateKeyHex)
    expect(validateSocialOperation(valid)).toBeNull()
    // Explicit clears are legal (deletion semantics), unknown fields are not.
    expect(validateSocialOperation(createSocialOperation({ ...common, type: 'profile.update', payload: { displayName: '', bio: '' } }, IDENTITY.privateKeyHex))).toBeNull()
    expect(validateSocialOperation({ ...valid, objectId: 'someone-else' })).toMatch(/actor itself/)
    expect(() => createSocialOperation({ ...common, type: 'profile.update', payload: { avatar: 'x' } }, IDENTITY.privateKeyHex)).toThrow(/invalid operation payload/)
    expect(() => createSocialOperation({ ...common, type: 'profile.update', payload: {} }, IDENTITY.privateKeyHex)).toThrow(/invalid operation payload/)
    expect(() => createSocialOperation({ ...common, type: 'profile.update', payload: { displayName: 'x'.repeat(61) } }, IDENTITY.privateKeyHex)).toThrow(/invalid operation payload/)
    expect(() => createSocialOperation({ ...common, type: 'profile.update', payload: { bio: 'x'.repeat(501) } }, IDENTITY.privateKeyHex)).toThrow(/invalid operation payload/)
  })

  it('does not create an operation when the supplied private key cannot sign for its public key', () => {
    expect(() => createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create',
      actorId: IDENTITY.orbitId, signingKey: IDENTITY.publicKeyHex,
      actorSequence: 1, previousOperationId: null, createdAt: 1, objectId: 'post-1',
      payload: { contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, OTHER.privateKeyHex)).toThrow(/invalid signature/)
  })

  it('authorizes ownership, causal edits, tombstones, comments, and reactions', () => {
    const history: SocialOperation[] = []
    const verifiedManifests = new Map<string, { ownerId: string; contentCid: string; mimeType: string; sizeBytes: number }>()
    const make = (identity: typeof IDENTITY, type: string, objectId: string, payload: Record<string, unknown>) => {
      const prior = history.filter((entry) => entry.actorId === identity.orbitId)
        .sort((a, b) => b.actorSequence - a.actorSequence)[0]
      const operation = createSocialOperation({
        protocol: 'gmatch-social', version: 1, type, actorId: identity.orbitId,
        signingKey: identity.publicKeyHex, actorSequence: (prior?.actorSequence ?? 0) + 1,
        previousOperationId: prior?.operationId ?? null, createdAt: 1, objectId, payload,
      }, identity.privateKeyHex)
      if (type === 'post.create' || type === 'post.edit') {
        verifiedManifests.set(payload.manifestHash as string, {
          ownerId: identity.orbitId, contentCid: payload.contentCid as string,
          mimeType: payload.mimeType as string, sizeBytes: payload.sizeBytes as number,
        })
      }
      return operation
    }
    const append = (identity: typeof IDENTITY, type: string, objectId: string, payload: Record<string, unknown>) => {
      const operation = make(identity, type, objectId, payload)
      expect(authorizeSocialOperation(operation, history, { verifiedManifests })).toBeNull()
      history.push(operation)
      return operation
    }

    const post = append(IDENTITY, 'post.create', 'post-1', {
      contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1,
    })
    const outsiderEdit = make(OTHER, 'post.edit', 'post-1', {
      supersedes: [post.operationId], contentCid: 'c'.repeat(64), manifestHash: 'd'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1,
    })
    expect(authorizeSocialOperation(outsiderEdit, history, { verifiedManifests })).toMatch(/only the post author/)

    const edit = append(IDENTITY, 'post.edit', 'post-1', {
      supersedes: [post.operationId], contentCid: 'c'.repeat(64), manifestHash: 'd'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1,
    })
    const staleEdit = make(IDENTITY, 'post.edit', 'post-1', {
      supersedes: [post.operationId], contentCid: 'e'.repeat(64), manifestHash: 'f'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1,
    })
    expect(authorizeSocialOperation(staleEdit, history, { verifiedManifests })).toMatch(/current post heads/)

    const comment = append(OTHER, 'comment.create', 'comment-1', { postId: 'post-1', parentCommentId: null, body: 'hello' })
    const unauthorizedDelete = make(IDENTITY, 'comment.delete', 'comment-1', { targetOperationId: comment.operationId })
    expect(authorizeSocialOperation(unauthorizedDelete, history, { verifiedManifests })).toMatch(/only the comment author/)
    append(OTHER, 'comment.delete', 'comment-1', { targetOperationId: comment.operationId })

    const add = append(OTHER, 'reaction.add', 'reaction-1', { targetType: 'post', targetId: 'post-1', reaction: 'like' })
    const removeByOther = make(IDENTITY, 'reaction.remove', 'reaction-remove-1', { targetAddOperationIds: [add.operationId] })
    expect(authorizeSocialOperation(removeByOther, history, { verifiedManifests })).toMatch(/not owned by actor/)
    append(OTHER, 'reaction.remove', 'reaction-remove-2', { targetAddOperationIds: [add.operationId] })

    // Profile updates: the actor restates own fields anytime. An objectId
    // that is not the actor itself never even passes creation (see the
    // validation test above).
    append(OTHER, 'profile.update', OTHER.orbitId, { displayName: 'other-nova', bio: '' })

    const deletePost = append(IDENTITY, 'post.delete', 'post-1', { targetOperationId: post.operationId })
    expect(deletePost.operationId).toBeTruthy()
    const afterDelete = make(OTHER, 'comment.create', 'comment-2', { postId: 'post-1', parentCommentId: null, body: 'late' })
    expect(authorizeSocialOperation(afterDelete, history, { verifiedManifests })).toMatch(/post is unavailable/)
    expect(edit.operationId).not.toBe(post.operationId)
  })

  it('rejects sequence reuse and predecessor mismatches', () => {
    const first = createFixture()
    const history = [first]
    const reused = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 1, previousOperationId: null,
      createdAt: 2, objectId: 'post-2',
      payload: { contentCid: 'c'.repeat(64), manifestHash: 'd'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    expect(authorizeSocialOperation(reused, history)).toMatch(/sequence already used/)
    const missingParent = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 3, previousOperationId: 'f'.repeat(64),
      createdAt: 3, objectId: 'post-3',
      payload: { contentCid: 'e'.repeat(64), manifestHash: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    expect(authorizeSocialOperation(missingParent, history)).toMatch(/predecessor is missing/)
  })

  it('requires a verified author manifest for post creation', () => {
    const post = createFixture()
    expect(authorizeSocialOperation(post, [])).toMatch(/verified author manifest/)
    expect(authorizeSocialOperation(post, [], {
      verifiedManifests: new Map([[post.payload.manifestHash as string, {
        ownerId: OTHER.orbitId,
        contentCid: post.payload.contentCid as string,
        mimeType: post.payload.mimeType as string,
        sizeBytes: post.payload.sizeBytes as number,
      }]]),
    })).toMatch(/verified author manifest/)
  })

  it('rejects equivocation and wrong-predecessor binding but allows detectable gaps', () => {
    const first = createFixture()
    const second = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 2, previousOperationId: first.operationId,
      createdAt: 2, objectId: 'post-2',
      payload: { contentCid: 'c'.repeat(64), manifestHash: 'd'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    const fork = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 2, previousOperationId: first.operationId,
      createdAt: 3, objectId: 'post-3',
      payload: { contentCid: 'e'.repeat(64), manifestHash: 'f'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    expect(authorizeSocialOperation(createFixture(), [first, second, fork])).toMatch(/equivocation/)
    // A predecessor that exists but binds to the wrong sequence is rejected...
    const misbound = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 3, previousOperationId: first.operationId,
      createdAt: 3, objectId: 'post-4',
      payload: { contentCid: 'a'.repeat(64), manifestHash: 'c'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    expect(authorizeSocialOperation(createFixture(), [first, misbound])).toMatch(/mismatched actor predecessor/)
    // ...while a pruned/partially-synced history (gap, absent predecessor) is
    // legal and detectable, so pruning never breaks self-authorization.
    const gapped = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: IDENTITY.orbitId,
      signingKey: IDENTITY.publicKeyHex, actorSequence: 5, previousOperationId: 'f'.repeat(64),
      createdAt: 5, objectId: 'post-5',
      payload: { contentCid: 'a'.repeat(64), manifestHash: 'c'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, IDENTITY.privateKeyHex)
    const unrelated = createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create', actorId: OTHER.orbitId,
      signingKey: OTHER.publicKeyHex, actorSequence: 1, previousOperationId: null,
      createdAt: 1, objectId: 'other-post',
      payload: { contentCid: 'a'.repeat(64), manifestHash: 'c'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, OTHER.privateKeyHex)
    expect(authorizeSocialOperation(unrelated, [first, gapped], {
      verifiedManifests: new Map([[unrelated.payload.manifestHash as string, {
        ownerId: OTHER.orbitId,
        contentCid: unrelated.payload.contentCid as string,
        mimeType: unrelated.payload.mimeType as string,
        sizeBytes: unrelated.payload.sizeBytes as number,
      }]]),
    })).toBeNull()
  })
})
