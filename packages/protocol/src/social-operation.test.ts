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
    payload: { caption: 'hi' },
  }, IDENTITY.privateKeyHex)
}

describe('proposed social operation v1', () => {
  it('matches the fixed operation ID and signature vector', () => {
    const operation = createFixture()
    expect(operation.operationId).toBe('288e80bb62e4b43c7af401ea01ca545382235ae55718aa5f6c94798944246eaa')
    expect(operation.signature).toBe('d22d8b07f34309ab2def312f247dcd3719c17ace744b14a6f2bb1a5c77905b26bb3faf3cbb6e3e1981168b22d9d39868e4e3213a16dffc3eafe93656c8e0af07')
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
    const left = createSocialOperation({ ...base, payload: { caption: 'hi', tags: ['a', 'b'] } }, IDENTITY.privateKeyHex)
    const right = createSocialOperation({ ...base, payload: { tags: ['a', 'b'], caption: 'hi' } }, IDENTITY.privateKeyHex)
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
})
