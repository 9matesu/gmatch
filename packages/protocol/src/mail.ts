import { blake3 } from '@noble/hashes/blake3'
import { hexToBytes } from '@orbit/crypto'

/**
 * Blind-courier addressing (plan §2). A delivery token is a one-way hash of
 * a public key — by convention the recipient's Ed25519 *identity* pubkey, so
 * the courier can verify an ack signature against the same key the token was
 * derived from (token = blake3(pubkey)). Anyone who knows the pubkey can
 * derive the token and address mail to it, but the token leaks nothing else:
 * blake3 is one-way, so the courier cannot reverse it to an identity, and it
 * is NOT the orbitId (sha256) — the routing label is unlinkable to the
 * account id by anyone who does not already hold the pubkey.
 */
export function deliveryToken(pubKeyHex: string): string {
  return bytesToHexStatic(blake3(hexToBytes(pubKeyHex)))
}

/** Does this token correspond to the given pubkey? (recipient-side lookup). */
export function tokenMatches(pubKeyHex: string, token: string): boolean {
  try {
    return deliveryToken(pubKeyHex) === token
  } catch {
    return false
  }
}

// Local hex encoder (avoids a runtime dep on Buffer in browser builds).
function bytesToHexStatic(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
