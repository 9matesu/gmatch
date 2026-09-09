import { describe, it, expect } from 'vitest'
import { blake3 } from '@noble/hashes/blake3'
import { generateIdentity, signMessage, verifySignature, hexToBytes, bytesToHex } from '@orbit/crypto'
import { deliveryToken, tokenMatches } from './mail'

describe('delivery tokens (blind-courier addressing)', () => {
  it('token is deterministic, 64-hex, and NOT the pubkey itself', () => {
    const alice = generateIdentity()
    const t = deliveryToken(alice.encryptionPubHex)
    expect(t).toMatch(/^[0-9a-f]{64}$/)
    expect(t).not.toBe(alice.encryptionPubHex.toLowerCase())
    expect(deliveryToken(alice.encryptionPubHex)).toBe(t)
  })

  it('different keys -> different tokens', () => {
    expect(deliveryToken(generateIdentity().encryptionPubHex)).not.toBe(
      deliveryToken(generateIdentity().encryptionPubHex),
    )
  })

  it('token is verifiably derived from the encPub (courier learns nothing more)', () => {
    const bob = generateIdentity()
    const t = deliveryToken(bob.encryptionPubHex)
    expect(tokenMatches(bob.encryptionPubHex, t)).toBe(true)
    expect(tokenMatches(generateIdentity().encryptionPubHex, t)).toBe(false)
  })

  it('sanity: blake3 hex matches our derivation (test mirrors impl for one vector)', () => {
    const bob = generateIdentity()
    const expected = Buffer.from(
      blake3(hexToBytes(bob.encryptionPubHex)),
    ).toString('hex')
    expect(deliveryToken(bob.encryptionPubHex)).toBe(expected)
  })
})

describe('identity primitives remain usable for envelope signatures', () => {
  it('Ed25519 sign/verify round-trip over canonical bytes', () => {
    const alice = generateIdentity()
    const msg = new TextEncoder().encode('v2|mail|abc|token|body')
    const sig = signMessage(msg, alice.privateKeyHex)
    expect(verifySignature(sig, msg, alice.publicKeyHex)).toBe(true)
    expect(verifySignature(sig, new TextEncoder().encode('v2|mail|abd|token|body'), alice.publicKeyHex)).toBe(false)
  })
})
