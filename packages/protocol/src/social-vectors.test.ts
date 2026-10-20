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
import { createSocialOperation, validateSocialOperation } from './social-operation'

/**
 * L0 conformance: the protocol package must reproduce every cross-workspace
 * fixture exactly (docs/PROTOCOL-V1.md "Required conformance vectors").
 */
describe('shared social protocol vectors', () => {
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

  it('reproduces the fixed social operation', () => {
    const { operationId, signatureHex, ...unsigned } = SOCIAL_VECTOR_OPERATION
    const operation = createSocialOperation(unsigned, SOCIAL_VECTOR_IDENTITY.ed25519PrivateKeyHex)
    expect(operation.operationId).toBe(operationId)
    expect(operation.signature).toBe(signatureHex)
    expect(validateSocialOperation({ ...operation, operationId, signature: signatureHex })).toBeNull()
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
})
