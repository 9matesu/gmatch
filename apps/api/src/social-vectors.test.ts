import { describe, expect, it } from 'vitest'
import {
  SOCIAL_VECTOR_AEAD,
  SOCIAL_VECTOR_DEK_WRAP,
  SOCIAL_VECTOR_DIGESTS,
  SOCIAL_VECTOR_IDENTITY,
  SOCIAL_VECTOR_OPERATION,
} from '@orbit/shared'
import {
  bytesToHex,
  computeObjectHash,
  decryptWithDekAndAad,
  hexToBytes,
  restoreIdentity,
  signMessage,
  unwrapDekV2,
  verifySignature,
} from '@orbit/crypto'
import { gossipSigningMessage, stableStringify } from '@orbit/shared'
import { createSocialOperation, validateSocialOperation } from '@orbit/protocol'

/**
 * L0 conformance from the API side: the server workspace must verify the same
 * cross-workspace fixtures as the protocol package (docs/PROTOCOL-V1.md
 * "Required conformance vectors" — fixtures pass in both workspaces).
 */
describe('shared social protocol vectors (API workspace)', () => {
  it('reproduces the fixed identity and signature', () => {
    const identity = restoreIdentity(SOCIAL_VECTOR_IDENTITY.ed25519PrivateKeyHex, SOCIAL_VECTOR_IDENTITY.ed25519PrivateKeyHex)
    expect(identity.publicKeyHex).toBe(SOCIAL_VECTOR_IDENTITY.ed25519PublicKeyHex)
    expect(identity.orbitId).toBe(SOCIAL_VECTOR_IDENTITY.orbitId)
    const message = new TextEncoder().encode(SOCIAL_VECTOR_IDENTITY.signatureMessage)
    expect(bytesToHex(signMessage(message, identity.privateKeyHex))).toBe(SOCIAL_VECTOR_IDENTITY.signatureHex)
    expect(verifySignature(hexToBytes(SOCIAL_VECTOR_IDENTITY.signatureHex), message, identity.publicKeyHex)).toBe(true)
  })

  it('reproduces the standard SHA-256 digests', () => {
    for (const vector of SOCIAL_VECTOR_DIGESTS) {
      expect(computeObjectHash(new TextEncoder().encode(vector.inputUtf8)).sha256Hex).toBe(vector.sha256Hex)
    }
  })

  it('reproduces the fixed social operation and canonical serialization', () => {
    const { operationId, signatureHex, ...unsigned } = SOCIAL_VECTOR_OPERATION
    const operation = createSocialOperation(unsigned, SOCIAL_VECTOR_IDENTITY.ed25519PrivateKeyHex)
    expect(operation.operationId).toBe(operationId)
    expect(operation.signature).toBe(signatureHex)
    expect(validateSocialOperation({ ...operation, operationId, signature: signatureHex })).toBeNull()
    // Canonical form is key-order independent in this workspace too.
    const reordered = { caption: 'hi', sizeBytes: 1234, mimeType: 'image/jpeg', manifestHash: 'b'.repeat(64), contentCid: 'a'.repeat(64) }
    expect(stableStringify(reordered)).toBe(stableStringify(unsigned.payload))
  })

  it('reproduces the fixed AEAD content vector', () => {
    const plaintext = decryptWithDekAndAad(
      hexToBytes(SOCIAL_VECTOR_AEAD.ciphertextHex),
      hexToBytes(SOCIAL_VECTOR_AEAD.keyHex),
      hexToBytes(SOCIAL_VECTOR_AEAD.nonceHex),
      new TextEncoder().encode(SOCIAL_VECTOR_AEAD.aadUtf8),
    )
    expect(new TextDecoder().decode(plaintext)).toBe(SOCIAL_VECTOR_AEAD.plaintextUtf8)
  })

  it('reproduces the fixed recipient-bound DEK wrap', () => {
    const dek = unwrapDekV2(
      hexToBytes(SOCIAL_VECTOR_DEK_WRAP.wrappedHex),
      SOCIAL_VECTOR_DEK_WRAP.recipientEncryptionPrivHex,
      new TextEncoder().encode(SOCIAL_VECTOR_DEK_WRAP.contextUtf8),
    )
    expect(bytesToHex(dek)).toBe(SOCIAL_VECTOR_DEK_WRAP.dekHex)
  })

  it('keeps the legacy gossip signing domain separate from social operations', () => {
    // The two signature domains must never verify against each other.
    const message = new TextEncoder().encode(SOCIAL_VECTOR_IDENTITY.signatureMessage)
    expect(verifySignature(hexToBytes(SOCIAL_VECTOR_IDENTITY.signatureHex), message, SOCIAL_VECTOR_IDENTITY.ed25519PublicKeyHex)).toBe(true)
    const gossipMessage = gossipSigningMessage({
      id: SOCIAL_VECTOR_OPERATION.objectId,
      owner_id: SOCIAL_VECTOR_OPERATION.actorId,
      author_pubkey: SOCIAL_VECTOR_OPERATION.signingKey,
      author_name: 'x',
      mime_type: 'image/jpeg',
      size_bytes: 1234,
      content_url: 'magnet:?xt=urn:btih:abc',
      caption: null,
      location: null,
      post_tags: null,
      post_group: null,
      content_hash: null,
      created_at: '2026-10-20T00:00:00.000Z',
    })
    expect(verifySignature(hexToBytes(SOCIAL_VECTOR_IDENTITY.signatureHex), gossipMessage, SOCIAL_VECTOR_IDENTITY.ed25519PublicKeyHex)).toBe(false)
  })
})
