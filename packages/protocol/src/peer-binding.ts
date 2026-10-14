import { bytesToHex, hexToBytes, signMessage, verifySignature } from '@orbit/crypto'
import { sha256Hex } from './hash'

const enc = new TextEncoder()

/** Domain separation: a binding sig must never verify as anything else. */
export const PEER_BINDING_DOMAIN = 'gmatch-peer-binding-v1'

export interface PeerBinding {
  orbitId: string
  orbitPubkeyHex: string
  peerId: string
  sigHex: string
}

export interface OrbitSignKeys {
  privateKeyHex: string
  publicKeyHex: string
  orbitId: string
}

export function bindingBytes(peerId: string, orbitId: string): Uint8Array {
  return enc.encode(`${PEER_BINDING_DOMAIN}|${peerId}|${orbitId}`)
}

/** Bind a libp2p PeerId to the canonical orbit identity (signed by the orbit key). */
export function createPeerBinding(keys: OrbitSignKeys, peerId: string): PeerBinding {
  return {
    orbitId: keys.orbitId,
    orbitPubkeyHex: keys.publicKeyHex,
    peerId,
    sigHex: bytesToHex(signMessage(bindingBytes(peerId, keys.orbitId), keys.privateKeyHex)),
  }
}

function isHex(s: unknown, len: number): s is string {
  return typeof s === 'string' && s.length === len && /^[0-9a-f]+$/i.test(s)
}

/** Verify shape, orbitId derivation (sha256 of the raw pubkey) and the sig. */
export function verifyPeerBinding(b: unknown): b is PeerBinding {
  if (typeof b !== 'object' || b === null) return false
  const { orbitId, orbitPubkeyHex, peerId, sigHex } = b as Record<string, unknown>
  if (!isHex(orbitId, 64) || !isHex(orbitPubkeyHex, 64) || !isHex(sigHex, 128)) return false
  if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 256) return false
  if (sha256Hex(hexToBytes(orbitPubkeyHex)) !== (orbitId as string).toLowerCase()) return false
  try {
    return verifySignature(hexToBytes(sigHex as string), bindingBytes(peerId, orbitId as string), orbitPubkeyHex as string)
  } catch {
    return false
  }
}
