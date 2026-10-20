import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { createReplicationReceipt, MAX_RECEIPT_AGE_MS, validateReplicationReceipt } from './replication-receipt'
const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))

function createFixture(createdAt = 1) {
  return createReplicationReceipt({
    protocol: 'gmatch-social',
    version: 1,
    receiverId: IDENTITY.orbitId,
    receiverKey: IDENTITY.publicKeyHex,
    objectCid: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    durable: true,
    challenge: 'c'.repeat(64),
    createdAt,
  }, IDENTITY.privateKeyHex)
}

describe('replication receipt (proposal v1)', () => {
  it('matches the fixed signature vector and validates at its timestamp', () => {
    const receipt = createFixture()
    expect(receipt.signature).toBe('9bfcc4c5282db5192007a5edcd791e44f9294f1eb85fc4f9aa2fd05b26f55d6bbe8d0ca5379bd61ad6e573a6dcc27e674fa5fa18d816c89f6cf368a8b7ea6509')
    expect(validateReplicationReceipt(receipt, 1)).toBeNull()
  })

  it('rejects tampering on every signed field and the receiver binding', () => {
    const receipt = createFixture()
    const cases = [
      { ...receipt, objectCid: 'f'.repeat(64) },
      { ...receipt, manifestHash: 'f'.repeat(64) },
      { ...receipt, challenge: 'f'.repeat(64) },
      { ...receipt, createdAt: 2 },
      { ...receipt, receiverId: 'f'.repeat(64) },
      { ...receipt, receiverKey: 'f'.repeat(64) },
      { ...receipt, unknownField: true },
    ]
    for (const invalid of cases) {
      expect(validateReplicationReceipt(invalid, 1)).not.toBeNull()
    }
  })

  it('refuses to create a receipt whose receiver id is not its signing key identity', () => {
    const other = restoreIdentity('22'.repeat(32), '33'.repeat(32))
    expect(() => createReplicationReceipt({
      protocol: 'gmatch-social',
      version: 1,
      receiverId: other.orbitId,
      receiverKey: IDENTITY.publicKeyHex,
      objectCid: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      durable: true,
      challenge: 'c'.repeat(64),
      createdAt: 1,
    }, IDENTITY.privateKeyHex)).toThrow(/receiver id does not match/)
  })

  it('never treats a non-durable read-back as replication evidence', () => {
    expect(() => createReplicationReceipt({
      protocol: 'gmatch-social',
      version: 1,
      receiverId: IDENTITY.orbitId,
      receiverKey: IDENTITY.publicKeyHex,
      objectCid: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      durable: false,
      challenge: 'c'.repeat(64),
      createdAt: 1,
    }, IDENTITY.privateKeyHex)).toThrow(/not durable/)
  })

  it('enforces the freshness backstop while the challenge stays the primary replay guard', () => {
    const receipt = createFixture(1000)
    expect(validateReplicationReceipt(receipt, 1000 + MAX_RECEIPT_AGE_MS - 1)).toBeNull()
    expect(validateReplicationReceipt(receipt, 1000 + MAX_RECEIPT_AGE_MS + 1)).toMatch(/stale/)
    // Small forward clock skew is tolerated...
    expect(validateReplicationReceipt(receipt, 1)).toBeNull()
    // ...but a far-future-dated receipt cannot extend its own validity.
    const future = createFixture(60_000)
    expect(validateReplicationReceipt(future, 1)).toMatch(/stale/)
  })
})
