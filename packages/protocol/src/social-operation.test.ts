import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import {
  createSocialOperation,
  validateSocialOperation,
  type SocialOperation,
} from './social-operation'

const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))

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

  it('does not create an operation when the supplied private key cannot sign for its public key', () => {
    const other = restoreIdentity('22'.repeat(32), '33'.repeat(32))
    expect(() => createSocialOperation({
      protocol: 'gmatch-social', version: 1, type: 'post.create',
      actorId: IDENTITY.orbitId, signingKey: IDENTITY.publicKeyHex,
      actorSequence: 1, previousOperationId: null, createdAt: 1, objectId: 'post-1',
      payload: { contentCid: 'a'.repeat(64), manifestHash: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1 },
    }, other.privateKeyHex)).toThrow(/invalid signature/)
  })
})
