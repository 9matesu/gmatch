import { describe, it, expect, vi } from 'vitest'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import type { User } from '@orbit/shared'
import { publishPresenceForHeartbeat, isCrossNodePeerUrl } from './useP2P'

/**
 * The 60s heartbeat must publish the signed beacon to the shared rendezvous
 * for ANY signed-in identity. The old `courierOnlyWs &&` gate left full nodes
 * (npm run dev / unpackaged Electron) sending only over their own node's WS,
 * so two apps on different nodes never saw each other and the beacon decayed
 * to a nameless row after the 120s mailbox TTL.
 */
describe('publishPresenceForHeartbeat (hosted presence on every heartbeat)', () => {
  const identity = generateIdentity() as OrbitIdentity
  const self: User = {
    id: identity.orbitId,
    publicKey: identity.publicKeyHex,
    encryptionPubKey: identity.encryptionPubHex,
    createdAt: new Date(0).toISOString(),
    display_name: 'Alice',
    pfp_url: 'https://example.com/alice.png',
  }

  it('publishes to the hosted rendezvous on every signed-in heartbeat', () => {
    const publish = vi.fn()
    expect(publishPresenceForHeartbeat(identity, self, publish)).toBe(true)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(identity, {
      displayName: 'Alice',
      pfpUrl: 'https://example.com/alice.png',
    })
  })

  it('treats only a different node URL as cross-node', () => {
    expect(isCrossNodePeerUrl('http://node-b:8790', 'http://node-a:8790')).toBe(true)
    expect(isCrossNodePeerUrl('http://node-a:8790/', 'http://node-a:8790')).toBe(false)
    expect(isCrossNodePeerUrl(undefined, 'http://node-a:8790')).toBe(false)
    expect(isCrossNodePeerUrl('', 'http://node-a:8790')).toBe(false)
  })

  it('publishes nothing when signed out', () => {
    const publish = vi.fn()
    expect(publishPresenceForHeartbeat(null, self, publish)).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })
})
