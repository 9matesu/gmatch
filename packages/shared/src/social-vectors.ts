/**
 * Cross-workspace conformance vectors for the proposed `gmatch-social` v1
 * protocol (docs/PROTOCOL-V1.md, roadmap L0).
 *
 * Every value is language-independent: fixed hex strings, UTF-8 text, and
 * fixed keys — no JSON-specific structures. Both the protocol package and the
 * API workspace verify these bytes in their test suites, so any second
 * implementation (or a future rewrite) can check itself against the same
 * fixtures. Never put a real user key here.
 */

export const SOCIAL_VECTOR_IDENTITY = {
  ed25519PrivateKeyHex: '00'.repeat(32),
  ed25519PublicKeyHex:
    '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29',
  orbitId:
    '139e3940e64b5491722088d9a0d741628fc826e09475d341a780acde3c4b8070',
  signatureMessage: 'gmatch-social|1|test|{}',
  signatureHex:
    'abe93333b41bfde024bb2ec60ccc8a9ae78d50f4ed2a57e60b063559526dc2ec2603518ba8a576ae7f940b1f9a72815cbe42a143d0993aec407aaeaad54d6c0b',
} as const

export const SOCIAL_VECTOR_DIGESTS = [
  { inputUtf8: '', sha256Hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { inputUtf8: 'abc', sha256Hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
] as const

export const SOCIAL_VECTOR_OPERATION = {
  protocol: 'gmatch-social',
  version: 1,
  type: 'post.create',
  actorId:
    '139e3940e64b5491722088d9a0d741628fc826e09475d341a780acde3c4b8070',
  signingKey:
    '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29',
  actorSequence: 1,
  previousOperationId: null,
  createdAt: 1,
  objectId: 'obj-1',
  payload: {
    contentCid: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    caption: 'hi',
  },
  operationId:
    'e9ff6abe1464a887d72a691741284f148eab6f59039c1da517a3b98a247bc8de',
  signatureHex:
    '09925018a56486ac57f248e2e630097dd5457b135893f8db9f10a5706a496c68e56647fe80b55d7868bf2c277f49c92cb99feb370d66677758e1f59d4d0d0e07',
} as const

export const SOCIAL_VECTOR_AEAD = {
  keyHex: '07'.repeat(32),
  nonceHex: '09'.repeat(24),
  aadUtf8: 'gmatch-social|1|content-chunk|vector',
  plaintextUtf8: 'vector plaintext',
  ciphertextHex:
    'c81781fe13d85912987361521c167f9f118448b5aa447f0097220dd0a3114b9f',
} as const

export const SOCIAL_VECTOR_DEK_WRAP = {
  recipientEncryptionPubHex:
    '7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13',
  recipientEncryptionPrivHex: '11'.repeat(32),
  ephemeralPrivHex: '44'.repeat(32),
  nonceHex: '99'.repeat(24),
  contextUtf8: 'gmatch-social|1|content-key|obj-1|epoch-1',
  dekHex: '07'.repeat(32),
  wrappedHex:
    'ff2ee45601ec1b67310c7790404585ae697331eee1c1f8cf2419731c1fff3e6b999999999999999999999999999999999999999999999999065289cad0fa8d80087cc4157f1e9c48247cc433fce1640ff71089713022f2aa72cbea30453ccbcd68355f15ac0710cd',
} as const
