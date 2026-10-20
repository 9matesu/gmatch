import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  restoreIdentity,
  signMessage,
  verifySignature,
  encryptPayload,
  decryptPayload,
  generateDek,
  encryptContent,
  decryptContent,
  wrapDekForMultipleRecipients,
  unwrapDek,
  hexToBytes,
  signContentManifest,
  verifyContentManifest,
  bytesToHex,
  computeObjectHash,
  encryptWithDekAndAad,
  decryptWithDekAndAad,
} from './index';

describe('Crypto Identity & Encryption', () => {
  it('should generate a valid Ed25519 identity', () => {
    const identity = generateIdentity();
    expect(identity.privateKeyHex).toBeTypeOf('string');
    expect(identity.privateKeyHex.length).toBe(64); // 32 bytes = 64 hex chars
    expect(identity.publicKeyHex).toBeTypeOf('string');
    expect(identity.publicKeyHex.length).toBe(64);
    expect(identity.orbitId).toBeTypeOf('string');
    expect(identity.orbitId.length).toBe(64); // SHA-256
  });

  it('should restore an identity from a private key hex', () => {
    const original = generateIdentity();
    const restored = restoreIdentity(original.privateKeyHex, original.encryptionPrivHex);
    
    expect(restored.privateKeyHex).toBe(original.privateKeyHex);
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
    expect(restored.orbitId).toBe(original.orbitId);
  });

  it('should sign and verify a message correctly', () => {
    const identity = generateIdentity();
    const message = new TextEncoder().encode('Hello, ORBIT!');
    
    const signature = signMessage(message, identity.privateKeyHex);
    expect(signature.length).toBe(64); // Ed25519 signature is 64 bytes
    
    const isValid = verifySignature(signature, message, identity.publicKeyHex);
    expect(isValid).toBe(true);

    const isInvalid = verifySignature(signature, new TextEncoder().encode('Tampered message'), identity.publicKeyHex);
    expect(isInvalid).toBe(false);
  });

  it('matches the fixed Ed25519 identity and signature interoperability vector', () => {
    const identity = restoreIdentity('00'.repeat(32), '11'.repeat(32));
    const message = new TextEncoder().encode('gmatch-social|1|test|{}');
    const signature = signMessage(message, identity.privateKeyHex);

    expect(identity.publicKeyHex).toBe('3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29');
    expect(identity.orbitId).toBe('139e3940e64b5491722088d9a0d741628fc826e09475d341a780acde3c4b8070');
    expect(bytesToHex(signature)).toBe('abe93333b41bfde024bb2ec60ccc8a9ae78d50f4ed2a57e60b063559526dc2ec2603518ba8a576ae7f940b1f9a72815cbe42a143d0993aec407aaeaad54d6c0b');
    expect(verifySignature(signature, message, identity.publicKeyHex)).toBe(true);
    expect(verifySignature(signature, new TextEncoder().encode('gmatch-social|1|test|{"x":1}'), identity.publicKeyHex)).toBe(false);
  });

  it('matches standard SHA-256 object digest vectors', () => {
    expect(computeObjectHash(new Uint8Array()).sha256Hex)
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(computeObjectHash(new TextEncoder().encode('abc')).sha256Hex)
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('should encrypt and decrypt payloads with X25519 shared secret', () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const originalText = 'Secret Orbit Image Data payload 12345';
    const plaintext = new TextEncoder().encode(originalText);

    // Alice encrypts for Bob
    const encrypted = encryptPayload(plaintext, alice.encryptionPrivHex, bob.encryptionPubHex);
    expect(encrypted.length).toBeGreaterThan(24);

    // Bob decrypts from Alice
    const decrypted = decryptPayload(encrypted, bob.encryptionPrivHex, alice.encryptionPubHex);
    expect(new TextDecoder().decode(decrypted)).toBe(originalText);
  });

  it('encrypts content into verifiable chunks and decrypts it', () => {
    const dek = generateDek();
    const plaintext = new TextEncoder().encode('a'.repeat(700_000));
    const encrypted = encryptContent(plaintext, dek, 64 * 1024);

    expect(encrypted.chunks.length).toBeGreaterThan(1);
    expect(encrypted.chunks.every((chunk) => chunk.cid.length === 64)).toBe(true);

    const decrypted = decryptContent(encrypted.chunks, dek, encrypted.totalSize);
    expect(decrypted).toEqual(plaintext);
  });

  it('authenticates chunk context as well as ciphertext', () => {
    const dek = new Uint8Array(32).fill(7);
    const plaintext = new TextEncoder().encode('private chunk bytes');
    const context = new TextEncoder().encode('gmatch-social|1|object-1|chunk-0');
    const encrypted = encryptWithDekAndAad(plaintext, dek, context);
    expect(decryptWithDekAndAad(encrypted.ciphertext, dek, encrypted.nonce, context)).toEqual(plaintext);
    expect(() => decryptWithDekAndAad(encrypted.ciphertext, dek, encrypted.nonce, new TextEncoder().encode('other object'))).toThrow();
    const tampered = encrypted.ciphertext.slice();
    tampered[0] ^= 1;
    expect(() => decryptWithDekAndAad(tampered, dek, encrypted.nonce, context)).toThrow();
  });

  it('decrypts the fixed XChaCha20-Poly1305 content-context vector', () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(9);
    const aad = new TextEncoder().encode('gmatch-social|1|content-chunk|vector');
    const ciphertext = Uint8Array.from(Buffer.from(
      'c81781fe13d85912987361521c167f9f118448b5aa447f0097220dd0a3114b9f',
      'hex',
    ));
    expect(new TextDecoder().decode(decryptWithDekAndAad(ciphertext, key, nonce, aad))).toBe('vector plaintext');
    expect(() => decryptWithDekAndAad(ciphertext, key, nonce, new TextEncoder().encode('wrong context'))).toThrow();
  });

  it('wraps one DEK for multiple recipients without sharing the DEK itself', () => {
    const sender = generateIdentity();
    const alice = generateIdentity();
    const bob = generateIdentity();
    const dek = generateDek();
    const wrapped = wrapDekForMultipleRecipients(dek, sender.encryptionPrivHex, [
      alice.encryptionPubHex,
      bob.encryptionPubHex,
    ]);

    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].wrappedDekHex).not.toContain(Buffer.from(dek).toString('hex'));

    const aliceDek = unwrapDek(hexToBytes(wrapped[0].wrappedDekHex), alice.encryptionPrivHex, sender.encryptionPubHex);
    const bobDek = unwrapDek(hexToBytes(wrapped[1].wrappedDekHex), bob.encryptionPrivHex, sender.encryptionPubHex);
    expect(aliceDek).toEqual(dek);
    expect(bobDek).toEqual(dek);
  });

  it('signs a manifest and rejects tampering', () => {
    const creator = generateIdentity();
    const manifest = {
      version: 1,
      cid: 'content-cid',
      totalSize: 12,
      chunkSize: 256,
      chunks: [],
      mimeType: 'image/png',
      creatorId: creator.orbitId,
      createdAt: Date.now(),
      wrappedKeys: [],
    };
    const signature = signContentManifest(manifest, creator.privateKeyHex);
    expect(verifyContentManifest(manifest, signature, creator.publicKeyHex)).toBe(true);
    expect(verifyContentManifest({ ...manifest, mimeType: 'text/plain' }, signature, creator.publicKeyHex)).toBe(false);
  });
});
