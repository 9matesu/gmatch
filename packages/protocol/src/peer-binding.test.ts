import { describe, expect, it } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { createPeerBinding, PEER_BINDING_DOMAIN, verifyPeerBinding } from './peer-binding'

// Fixed vector (test-only key 0xaa…; generated with noble, same semantics as
// @orbit/crypto). Also embedded in apps/desktop/electron/p2p-protocol.test.mjs
// as the cross-implementation parity pin: both verifiers must accept it, and
// the domain string must never drift.
const VECTOR = {
  orbitId: '448f04ffcba874db93d9fd02520daa583a92b1f20b100ff791202a6d7a93e0de',
  orbitPubkeyHex: 'e734ea6c2b6257de72355e472aa05a4c487e6b463c029ed306df2f01b5636b58',
  peerId: '12D3KooWTestVector000000000000000000000000000001',
  sigHex: '41d4d659da13e64814bd4d5b687f38c3e19ed7143594ed9a4cb7b2187db52aaf93af64d4b578daccd8d3e216d9ceb45a02cc965cf6300ef3a56a15e42456730a',
}

describe('peer-binding', () => {
  it('accepts the fixed cross-implementation vector', () => {
    expect(PEER_BINDING_DOMAIN).toBe('gmatch-peer-binding-v1')
    expect(verifyPeerBinding(VECTOR)).toBe(true)
  })

  it('round-trips create -> verify', () => {
    const id = generateIdentity()
    const b = createPeerBinding(id, '12D3KooWRoundTrip0000000000000000000000000002')
    expect(verifyPeerBinding(b)).toBe(true)
  })

  it('rejects tampered peerId, orbitId and signature', () => {
    const id = generateIdentity()
    const b = createPeerBinding(id, '12D3KooWPeer000000000000000000000000000003')
    expect(verifyPeerBinding({ ...b, peerId: b.peerId + 'X' })).toBe(false)
    expect(verifyPeerBinding({ ...b, orbitId: '00' + b.orbitId.slice(2) })).toBe(false)
    expect(verifyPeerBinding({ ...b, sigHex: 'ff' + b.sigHex.slice(2) })).toBe(false)
  })

  it('rejects a binding whose orbitId is not sha256(pubkey)', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const forged = createPeerBinding(a, '12D3KooWPeer000000000000000000000000000004')
    expect(verifyPeerBinding({ ...forged, orbitId: b.orbitId })).toBe(false)
  })

  it('rejects non-objects and malformed shapes', () => {
    for (const bad of [null, 42, 'x', {}, { ...VECTOR, sigHex: 'zz' }, { ...VECTOR, peerId: '' }]) {
      expect(verifyPeerBinding(bad)).toBe(false)
    }
  })
})
