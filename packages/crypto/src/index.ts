import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export { bytesToHex, hexToBytes };

export interface OrbitIdentity {
  privateKeyHex: string;
  publicKeyHex: string;
  encryptionPrivHex: string;
  encryptionPubHex: string;
  orbitId: string;
}

export function generateIdentity(): OrbitIdentity {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const orbitIdBytes = sha256(publicKey);
  
  // Also generate a dedicated X25519 keypair for E2EE
  const encPriv = x25519.utils.randomPrivateKey();
  const encPub = x25519.getPublicKey(encPriv);

  return {
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKey),
    encryptionPrivHex: bytesToHex(encPriv),
    encryptionPubHex: bytesToHex(encPub),
    orbitId: bytesToHex(orbitIdBytes),
  };
}

export function restoreIdentity(privateKeyHex: string, encryptionPrivHex: string): OrbitIdentity {
  const privateKey = hexToBytes(privateKeyHex);
  const publicKey = ed25519.getPublicKey(privateKey);
  const orbitIdBytes = sha256(publicKey);
  
  const encPriv = hexToBytes(encryptionPrivHex);
  const encPub = x25519.getPublicKey(encPriv);

  return {
    privateKeyHex,
    publicKeyHex: bytesToHex(publicKey),
    encryptionPrivHex,
    encryptionPubHex: bytesToHex(encPub),
    orbitId: bytesToHex(orbitIdBytes),
  };
}

/**
 * A fresh X25519 key pair. Used where a one-shot key is better than a
 * long-lived one — e.g. the swarm transfer key offer, so a compromise of one
 * transfer key never touches the identity's encryption key.
 */
export function generateEphemeralEncryptionKey(): { privateKeyHex: string; publicKeyHex: string } {
  const priv = x25519.utils.randomPrivateKey();
  return {
    privateKeyHex: bytesToHex(priv),
    publicKeyHex: bytesToHex(x25519.getPublicKey(priv)),
  };
}

export function signMessage(message: Uint8Array, privateKeyHex: string): Uint8Array {
  return ed25519.sign(message, hexToBytes(privateKeyHex));
}

export function verifySignature(signature: Uint8Array, message: Uint8Array, publicKeyHex: string): boolean {
  return ed25519.verify(signature, message, hexToBytes(publicKeyHex));
}

export function computeObjectHash(data: Uint8Array): { blake3Hex: string, sha256Hex: string } {
  return {
    blake3Hex: bytesToHex(blake3(data)),
    sha256Hex: bytesToHex(sha256(data))
  };
}

export function encryptPayload(plaintext: Uint8Array, senderPrivHex: string, recipientPubHex: string): Uint8Array {
  // Compute shared secret using ECDH
  const sharedSecret = x25519.getSharedSecret(hexToBytes(senderPrivHex), hexToBytes(recipientPubHex));
  
  // Use BLAKE3 to derive a 32-byte key from the shared secret
  const key = blake3(sharedSecret);
  
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  // Prepend nonce to ciphertext
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

export function decryptPayload(encryptedPayload: Uint8Array, recipientPrivHex: string, senderPubHex: string): Uint8Array {
  const sharedSecret = x25519.getSharedSecret(hexToBytes(recipientPrivHex), hexToBytes(senderPubHex));
  const key = blake3(sharedSecret);
  
  const nonce = encryptedPayload.slice(0, 24);
  const ciphertext = encryptedPayload.slice(24);
  
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

export interface EncryptedContent {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag?: Uint8Array;
}

export interface WrappedKey {
  recipientPubHex: string;
  wrappedDekHex: string;
}

export interface ContentManifest {
  version: number;
  cid: string;
  totalSize: number;
  chunkSize: number;
  chunks: Array<{
    cid: string;
    offset: number;
    size: number;
    nonceHex: string;
  }>;
  mimeType: string;
  creatorId: string;
  createdAt: number;
  wrappedKeys: WrappedKey[];
  signatureHex?: string;
  metadata?: {
    encryptedCaption?: string;
    encryptedTags?: string;
  };
}

function manifestSigningBytes(manifest: ContentManifest): Uint8Array {
  const { signatureHex: _signatureHex, ...unsignedManifest } = manifest;
  return new TextEncoder().encode(JSON.stringify(unsignedManifest));
}

export function signContentManifest(manifest: ContentManifest, privateKeyHex: string): string {
  return bytesToHex(signMessage(manifestSigningBytes(manifest), privateKeyHex));
}

export function verifyContentManifest(manifest: ContentManifest, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return verifySignature(hexToBytes(signatureHex), manifestSigningBytes(manifest), publicKeyHex);
  } catch {
    return false;
  }
}

export const DEFAULT_CHUNK_SIZE = 256 * 1024;

export function generateDek(): Uint8Array {
  return randomBytes(32);
}

export function encryptWithDek(plaintext: Uint8Array, dek: Uint8Array): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(dek, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  return { ciphertext, nonce };
}

export function decryptWithDek(ciphertext: Uint8Array, dek: Uint8Array, nonce: Uint8Array): Uint8Array {
  const cipher = xchacha20poly1305(dek, nonce);
  return cipher.decrypt(ciphertext);
}

/** Encrypt with caller-supplied authenticated context; legacy helpers stay wire-compatible. */
export function encryptWithDekAndAad(
  plaintext: Uint8Array,
  dek: Uint8Array,
  additionalData: Uint8Array,
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(dek, nonce, additionalData);
  return { ciphertext: cipher.encrypt(plaintext), nonce };
}

export function decryptWithDekAndAad(
  ciphertext: Uint8Array,
  dek: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Uint8Array {
  return xchacha20poly1305(dek, nonce, additionalData).decrypt(ciphertext);
}

/** Domain separator for the v2 recipient wrap; never reuse for other purposes. */
const DEK_WRAP_V2_DOMAIN = 'gmatch-social|1|dek-wrap|';

/**
 * Recipient-bound DEK wrap, protocol proposal v2 (experimental).
 *
 * Improvements over the legacy `wrapDekForRecipient`/`encryptPayload` format:
 * - Ephemeral sender X25519 key per wrap: no sender-key reuse across objects.
 * - Domain-separated BLAKE3 KDF binding shared secret + both public keys +
 *   the caller context (owner/object/key epoch), so a wrapped DEK cannot be
 *   replayed onto another object or recipient.
 * - XChaCha20-Poly1305 with the same context as AAD.
 *
 * Wire layout: ephemeralPub(32) || nonce(24) || ciphertext+tag(48).
 * The legacy format above remains only to read existing data; new private
 * v1 content must use this wrap once the protocol proposal is accepted.
 */
export function wrapDekForRecipientV2(
  dek: Uint8Array,
  recipientPubHex: string,
  context: Uint8Array,
  pinned?: { ephemeralPrivHex: string; nonceHex?: string },
): Uint8Array {
  if (dek.length !== 32) throw new Error('DEK must be 32 bytes');
  const ephPriv = pinned ? hexToBytes(pinned.ephemeralPrivHex) : x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const recipientPub = hexToBytes(recipientPubHex);
  const sharedSecret = x25519.getSharedSecret(ephPriv, recipientPub);
  const domain = new TextEncoder().encode(DEK_WRAP_V2_DOMAIN);
  const kdfInput = new Uint8Array(domain.length + sharedSecret.length + ephPub.length + recipientPub.length + context.length);
  let offset = 0;
  kdfInput.set(domain, offset); offset += domain.length;
  kdfInput.set(sharedSecret, offset); offset += sharedSecret.length;
  kdfInput.set(ephPub, offset); offset += ephPub.length;
  kdfInput.set(recipientPub, offset); offset += recipientPub.length;
  kdfInput.set(context, offset);
  const key = blake3(kdfInput);
  const aad = new Uint8Array(domain.length + context.length);
  aad.set(domain, 0);
  aad.set(context, domain.length);
  const nonce = pinned?.nonceHex ? hexToBytes(pinned.nonceHex) : randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(dek);
  const out = new Uint8Array(32 + 24 + ciphertext.length);
  out.set(ephPub, 0);
  out.set(nonce, 32);
  out.set(ciphertext, 56);
  return out;
}

export function unwrapDekV2(wrapped: Uint8Array, recipientPrivHex: string, context: Uint8Array): Uint8Array {
  if (wrapped.length !== 32 + 24 + 32 + 16) throw new Error('malformed DEK wrap');
  const ephPub = wrapped.slice(0, 32);
  const nonce = wrapped.slice(32, 56);
  const ciphertext = wrapped.slice(56);
  const recipientPub = x25519.getPublicKey(hexToBytes(recipientPrivHex));
  const sharedSecret = x25519.getSharedSecret(hexToBytes(recipientPrivHex), ephPub);
  const domain = new TextEncoder().encode(DEK_WRAP_V2_DOMAIN);
  const kdfInput = new Uint8Array(domain.length + sharedSecret.length + ephPub.length + recipientPub.length + context.length);
  let offset = 0;
  kdfInput.set(domain, offset); offset += domain.length;
  kdfInput.set(sharedSecret, offset); offset += sharedSecret.length;
  kdfInput.set(ephPub, offset); offset += ephPub.length;
  kdfInput.set(recipientPub, offset); offset += recipientPub.length;
  kdfInput.set(context, offset);
  const key = blake3(kdfInput);
  const aad = new Uint8Array(domain.length + context.length);
  aad.set(domain, 0);
  aad.set(context, domain.length);
  return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
}

export function wrapDekForRecipient(dek: Uint8Array, senderPrivHex: string, recipientPubHex: string): Uint8Array {
  return encryptPayload(dek, senderPrivHex, recipientPubHex);
}

export function unwrapDek(wrappedDek: Uint8Array, recipientPrivHex: string, senderPubHex: string): Uint8Array {
  return decryptPayload(wrappedDek, recipientPrivHex, senderPubHex);
}

export function wrapDekForMultipleRecipients(
  dek: Uint8Array,
  senderPrivHex: string,
  recipientPubKeys: string[]
): WrappedKey[] {
  return recipientPubKeys.map(recipientPubHex => ({
    recipientPubHex,
    wrappedDekHex: bytesToHex(wrapDekForRecipient(dek, senderPrivHex, recipientPubHex)),
  }));
}

export interface ChunkedEncryptionResult {
  chunks: Array<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    cid: string;
    offset: number;
    size: number;
  }>;
  totalSize: number;
  contentCid: string;
}

export function computeChunkCid(ciphertext: Uint8Array, nonce: Uint8Array): string {
  const combined = new Uint8Array(ciphertext.length + nonce.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return bytesToHex(sha256(combined));
}

export function encryptContent(
  plaintext: Uint8Array,
  dek: Uint8Array,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): ChunkedEncryptionResult {
  const chunks: ChunkedEncryptionResult['chunks'] = [];
  let offset = 0;
  const allChunkHashes: Uint8Array[] = [];
  
  while (offset < plaintext.length) {
    const chunk = plaintext.subarray(offset, offset + chunkSize);
    const { ciphertext, nonce } = encryptWithDek(chunk, dek);
    const cid = computeChunkCid(ciphertext, nonce);
    
    chunks.push({
      ciphertext,
      nonce,
      cid,
      offset,
      size: chunk.length,
    });
    
    allChunkHashes.push(hexToBytes(cid));
    offset += chunkSize;
  }
  
  const totalHashLen = allChunkHashes.reduce((sum, h) => sum + h.length, 0);
  const concatHashes = new Uint8Array(totalHashLen);
  let pos = 0;
  for (const h of allChunkHashes) { concatHashes.set(h, pos); pos += h.length; }
  const contentCid = bytesToHex(sha256(concatHashes));
  
  return {
    chunks,
    totalSize: plaintext.length,
    contentCid,
  };
}

export function decryptContent(
  encryptedChunks: Array<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    offset: number;
    size: number;
  }>,
  dek: Uint8Array,
  totalSize: number
): Uint8Array {
  const result = new Uint8Array(totalSize);
  
  for (const chunk of encryptedChunks) {
    const decrypted = decryptWithDek(chunk.ciphertext, dek, chunk.nonce);
    result.set(decrypted, chunk.offset);
  }
  
  return result;
}

export function encryptMetadata(metadata: { caption?: string; tags?: string[] }, dek: Uint8Array): { encryptedCaption?: string; encryptedTags?: string } {
  const result: { encryptedCaption?: string; encryptedTags?: string } = {};
  
  if (metadata.caption) {
    const { ciphertext, nonce } = encryptWithDek(new TextEncoder().encode(metadata.caption), dek);
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.length);
    result.encryptedCaption = bytesToHex(combined);
  }
  
  if (metadata.tags && metadata.tags.length > 0) {
    const { ciphertext, nonce } = encryptWithDek(new TextEncoder().encode(JSON.stringify(metadata.tags)), dek);
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.length);
    result.encryptedTags = bytesToHex(combined);
  }
  
  return result;
}

export function decryptMetadata(encrypted: { encryptedCaption?: string; encryptedTags?: string }, dek: Uint8Array): { caption?: string; tags?: string[] } {
  const result: { caption?: string; tags?: string[] } = {};
  
  if (encrypted.encryptedCaption) {
    const combined = hexToBytes(encrypted.encryptedCaption);
    const nonce = combined.slice(0, 24);
    const ciphertext = combined.slice(24);
    const decrypted = decryptWithDek(ciphertext, dek, nonce);
    result.caption = new TextDecoder().decode(decrypted);
  }
  
  if (encrypted.encryptedTags) {
    const combined = hexToBytes(encrypted.encryptedTags);
    const nonce = combined.slice(0, 24);
    const ciphertext = combined.slice(24);
    const decrypted = decryptWithDek(ciphertext, dek, nonce);
    result.tags = JSON.parse(new TextDecoder().decode(decrypted));
  }
  
  return result;
}
