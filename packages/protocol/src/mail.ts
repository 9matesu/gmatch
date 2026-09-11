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

/**
 * Wave 2 (C2): rotating session handle — blake3(pubkey || epoch). The epoch
 * is a 32-hex random the owner regenerates every boot; the courier sees a
 * fresh unlinkable token per session and cannot correlate yesterday's box
 * with today's. The static home token stays valid as fallback for senders
 * that have not received the announce yet.
 */
export function sessionDeliveryToken(pubKeyHex: string, epochHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(pubKeyHex) || !/^[0-9a-f]{32}$/i.test(epochHex)) {
    throw new Error('sessionDeliveryToken: bad key or epoch')
  }
  return bytesToHexStatic(blake3(concat(hexToBytes(pubKeyHex), hexToBytes(epochHex))))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
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
