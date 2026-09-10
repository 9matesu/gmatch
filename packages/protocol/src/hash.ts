import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@orbit/crypto'

/** sha256 hex — same derivation @orbit/crypto uses for orbitId from Ed25519 pubkey. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}
