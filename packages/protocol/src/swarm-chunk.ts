import { randomBytes } from '@noble/hashes/utils'
import {
  bytesToHex,
  decryptPayload,
  decryptWithDekAndAad,
  encryptPayload,
  encryptWithDekAndAad,
  generateEphemeralEncryptionKey,
  hexToBytes,
} from '@orbit/crypto'

/**
 * Swarm chunk encryption, version 1 (roadmap L2/P0: the relay must not be
 * able to read the media it forwards).
 *
 * The problem: the swarm's transport is not always trusted. The direct
 * WebRTC DataChannel is DTLS-encrypted between the two peers, but the
 * fallback path rides the node's WebSocket relay \u2014 and the chunks travelled
 * there in PLAINTEXT (only hash-verified). A node therefore saw every byte
 * of every image it relayed.
 *
 * The fix keeps the storage format untouched (the stored bytes are still the
 * plaintext, content-addressed by sha256 \u2014 so nothing migrates and the
 * content hash still proves the object) and encrypts only the WIRE:
 *
 * - The FETCHER generates a fresh ephemeral X25519 key pair per transfer and
 *   puts its public key in the WANT frame (\`offerPub\`).
 * - The SEEDER generates a random DEK for that transfer and seals it to the
 *   offerer's public key. The wrapped DEK travels in a SWARM_KEY frame: the
 *   relay can copy it, but only the requester can open it.
 * - Every chunk is encrypted with the DEK (XChaCha20-Poly1305) and the
 *   additional authenticated data binds the chunk to its TRANSFER, its
 *   OBJECT, its POSITION and both PEERS. A chunk moved to another transfer,
 *   another object, another position or another swarm fails to authenticate.
 *
 * Consequences that matter:
 * - The relay (and every other peer of the node) learns nothing about the
 *   media: it holds ciphertext and a DEK it cannot open.
 * - A peer that merely JOINED the swarm cannot decrypt: it does not hold the
 *   requester's ephemeral private key.
 * - The DEK is per transfer: no long-lived key to distribute, rotate or
 *   revoke. A transfer that dies takes its key with it; a retry is a new
 *   transfer with a new key.
 * - The plaintext's sha256 is still verified after decryption, so the
 *   ciphertext path cannot substitute content.
 */

export const SWARM_CHUNK_ENC = 'swarm-v1'
export const SWARM_KEY_ENC = 'swarm-v1'

/**
 * The context every chunk of one transfer is bound to.
 */
export interface SwarmChunkContext {
  /** Content id (sha256 of the plaintext) or the legacy object id. */
  objectId: string
  index: number
  total: number
  /** Random per transfer; binds the chunks to one request. */
  transferId: string
  /** The peer that sealed the bytes (its own orbitId; self-described). */
  senderOrbitId: string
  /**
   * Hex of the requester's EPHEMERAL public key — the only receiver binding a
   * seeder can honestly authenticate: it comes from the WANT frame that asked
   * for the transfer, and only the holder of the matching private key can
   * decrypt. A claimed orbitId is not a binding (it cannot be verified by the
   * seeder); the offer key is.
   */
  receiverOfferPub: string
}

/**
 * Canonical AAD. The ids are constrained (hex ids, [A-Za-z0-9_-] object ids,
 * hex transfer ids), so the '|' separator cannot be forged by shifting a
 * field into the next one.
 */
export function swarmChunkAad(ctx: SwarmChunkContext): Uint8Array {
  const parts = [
    'gmatch-swarm|1',
    ctx.objectId,
    String(ctx.index),
    String(ctx.total),
    ctx.transferId,
    ctx.senderOrbitId,
    ctx.receiverOfferPub,
  ]
  return new TextEncoder().encode(parts.join('|'))
}

/** Encrypt one chunk with the transfer DEK. */
export function encryptSwarmChunk(
  dek: Uint8Array,
  plaintext: Uint8Array,
  ctx: SwarmChunkContext,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (dek.length !== 32) throw new Error('swarm DEK must be 32 bytes')
  const { ciphertext, nonce } = encryptWithDekAndAad(plaintext, dek, swarmChunkAad(ctx))
  return { nonce, ciphertext }
}

/**
 * Decrypt one chunk. Throws when the ciphertext, the nonce or the context do
 * not match: a modified chunk is a hard failure, never a silent pass.
 */
export function decryptSwarmChunk(
  dek: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  ctx: SwarmChunkContext,
): Uint8Array {
  if (dek.length !== 32) throw new Error('swarm DEK must be 32 bytes')
  if (nonce.length !== 24) throw new Error('swarm nonce must be 24 bytes')
  return decryptWithDekAndAad(ciphertext, dek, nonce, swarmChunkAad(ctx))
}

/**
 * Seal a transfer DEK to the requester's ephemeral public key.
 *
 * The seeder uses its OWN ephemeral key (no reuse of a long-lived identity
 * key across transfers) and the requester's public key; the shared secret is
 * hashed with BLAKE3 and used as the XChaCha20-Poly1305 key.
 */
export function sealSwarmKey(dek: Uint8Array, offerPubHex: string): Uint8Array {
  if (dek.length !== 32) throw new Error('swarm DEK must be 32 bytes')
  const eph = generateEphemeralEncryptionKey()
  const sealed = encryptPayload(dek, eph.privateKeyHex, offerPubHex)
  // ephPub(32) || nonce(24) || ciphertext+tag
  const out = new Uint8Array(32 + sealed.length)
  out.set(hexToBytes(eph.publicKeyHex), 0)
  out.set(sealed, 32)
  return out
}

/** Open a sealed transfer DEK (only the requester can). */
export function openSwarmKey(wrapped: Uint8Array, offerPrivHex: string): Uint8Array {
  if (wrapped.length < 32 + 24 + 16) throw new Error('malformed swarm key')
  const ephPub = bytesToHex(wrapped.subarray(0, 32))
  const sealed = wrapped.subarray(32)
  return decryptPayload(sealed, offerPrivHex, ephPub)
}

/** A fresh ephemeral key pair for one transfer (the requester's side). */
export function createSwarmOffer(): { privateKeyHex: string; publicKeyHex: string } {
  const key = generateEphemeralEncryptionKey()
  return { privateKeyHex: key.privateKeyHex, publicKeyHex: key.publicKeyHex }
}

/** A random transfer DEK (the seeder's side). */
export function createSwarmDek(): Uint8Array {
  return randomBytes(32)
}
