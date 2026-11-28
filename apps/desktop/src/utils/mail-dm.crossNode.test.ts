// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { deliveryToken } from '@orbit/protocol'
import { DmStore, DmManager } from './mail-dm'
import { rememberPeerNode } from './peerNodes'
import { DEFAULT_CENTRAL_URL } from './central'

/**
 * A peer that lives on ANOTHER node keeps its mailbox there. The sealed
 * envelope must be dropped into THAT node's courier, not into ours — the
 * ciphertext is the same either way (the node cannot open it).
 */
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage

const alice = generateIdentity()
const bob = generateIdentity()

describe('DM to a peer on another node', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key]
  })

  it('routes the envelope to the node the peer lives on', async () => {
    const sent: Array<{ body: string; recipient: { publicKeyHex: string; encryptionPubHex: string }; opts?: { base?: string } }> = []
    const mail = {
      send: vi.fn(async (body: string, _kind: string, recipient: { publicKeyHex: string; encryptionPubHex: string }, opts?: { base?: string }) => {
        sent.push({ body, recipient, opts })
        return { v: 2 as const, kind: 'mail' as const, to: deliveryToken(recipient.publicKeyHex), id: 'env-1', sealed: 'x', fromEph: alice.encryptionPubHex }
      }),
    }
    const store = new DmStore(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    rememberPeerNode(bob.orbitId, 'http://bob-node.test:8790')

    const mgr = new DmManager({ mail: mail as any, store, identity: alice, onThreadChanged: vi.fn() })
    await mgr.send(bob.orbitId, 'hello across nodes')

    expect(sent).toHaveLength(1)
    expect(sent[0].opts?.base).toBe('http://bob-node.test:8790')
  })

  it('falls back to the blind rendezvous when the peer node is a private LAN address', async () => {
    const sent: Array<{ opts?: { base?: string } }> = []
    const mail = {
      send: vi.fn(async (body: string, _kind: string, recipient: { publicKeyHex: string; encryptionPubHex: string }, opts?: { base?: string }) => {
        sent.push({ opts })
        return { v: 2 as const, kind: 'mail' as const, to: deliveryToken(recipient.publicKeyHex), id: 'env-1', sealed: 'x', fromEph: alice.encryptionPubHex }
      }),
    }
    const store = new DmStore(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    // Their signed beacon names a LAN address on THEIR network — a PUT there
    // times out here, though they can still drain the shared worker.
    rememberPeerNode(bob.orbitId, 'http://192.168.1.215:8790')

    const mgr = new DmManager({ mail: mail as any, store, identity: alice, onThreadChanged: vi.fn() })
    await mgr.send(bob.orbitId, 'hello across two LANs')

    expect(sent).toHaveLength(1)
    // Token-addressed and sealed-only: both peers drain it, so this lands.
    expect(sent[0].opts?.base).toBe(DEFAULT_CENTRAL_URL)
    expect(sent[0].opts?.base).not.toBe('http://192.168.1.215:8790')
  })

  it('uses our own node when the peer lives here', async () => {
    const sent: Array<{ opts?: { base?: string } }> = []
    const mail = {
      send: vi.fn(async (body: string, _kind: string, recipient: { publicKeyHex: string; encryptionPubHex: string }, opts?: { base?: string }) => {
        sent.push({ opts })
        return { v: 2 as const, kind: 'mail' as const, to: deliveryToken(recipient.publicKeyHex), id: 'env-1', sealed: 'x', fromEph: alice.encryptionPubHex }
      }),
    }
    const store = new DmStore(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })

    const mgr = new DmManager({ mail: mail as any, store, identity: alice, onThreadChanged: vi.fn() })
    await mgr.send(bob.orbitId, 'hello same node')

    expect(sent).toHaveLength(1)
    expect(sent[0].opts?.base).toBeUndefined()
  })
})
