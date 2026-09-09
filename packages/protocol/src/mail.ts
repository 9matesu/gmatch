import { blake3 } from '@noble/hashes/blake3'
import { hexToBytes } from '@orbit/crypto'

/**
 * Blind-courier addressing (plan §2). A delivery token is a one-way hash of a
 * recipient's X25519 *encryption* public key. Anyone who knows the encPub can
 * derive the same token and therefore address mail to it, but the token leaks
 * nothing else: it is not the key (blake3 is one-way), so the courier cannot
 * reverse it to an identity, and identities (orbitId = sha256 of the *Ed25519*
 * key) are never on the routing field. The courier stores mail under a token
 * it cannot link to a person or to a session — it forwards addresses only.
 */
export function deliveryToken(encPubHex: string): string {
  return bytesToHexStatic(blake3(hexToBytes(encPubHex)))
}

/** Does this token correspond to the given encPub? (recipient-side lookup). */
export function tokenMatches(encPubHex: string, token: string): boolean {
  try {
    return deliveryToken(encPubHex) === token
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
