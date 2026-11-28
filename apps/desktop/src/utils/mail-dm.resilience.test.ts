// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { deliveryToken } from '@orbit/protocol'
import {
  DmManager,
  DmStore,
  decodeBody,
  isDmRetrying,
} from './mail-dm'
import { registerLocalObject, __resetLocalObjectCacheForTests } from './p2pSwarm'

/**
 * A DM attachment is a LOCAL object id: the message carries no hash, so the
 * recipient's node 404s and the swarm is asked for an alias nobody can verify.
 * The sender must put the content hash in the sealed body. A failed send must
 * then keep trying (outbox) instead of sitting failed forever.
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

/** jsdom's Blob here has no arrayBuffer(); the real app's does. */
function testBlob(text: string): Blob {
  const blob = new Blob([text], { type: 'image/png' }) as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (!blob.arrayBuffer) {
    blob.arrayBuffer = async () => new TextEncoder().encode(text).buffer as ArrayBuffer
  }
  return blob
}

function harness() {
  for (const key of Object.keys(storage)) delete storage[key]
  const sent: string[] = []
  const send = vi.fn(async (body: string) => {
    sent.push(body)
    return {
      v: 2 as const, kind: 'mail' as const,
      to: deliveryToken(bob.publicKeyHex), id: `env-${sent.length}`,
      sealed: 'x', fromEph: alice.encryptionPubHex,
    }
  })
  const store = new DmStore(alice)
  const mgr = new DmManager({
    mail: { send } as any, store, identity: alice, onThreadChanged: vi.fn(),
  })
  store.rememberPeer(bob.orbitId, {
    publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex,
  })
  return { mgr, store, send, sent }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DM media carries a content address', () => {
  beforeEach(() => {
    __resetLocalObjectCacheForTests()
  })

  it('seals the attachment hash, not just the local object id', async () => {
    const bytes = testBlob('a private picture')
    const { sha256HexBlob } = await import('./p2pSwarm')
    const hash = await sha256HexBlob(bytes)
    registerLocalObject('chat-object-1', bytes)

    const { mgr, sent } = harness()
    await mgr.send(bob.orbitId, 'look', 'chat-object-1', 'Alice')

    // The recipient can only verify bytes by content: a bare UUID is a dead end
    // on their node (/api/objects/<uuid> 404s there).
    expect(decodeBody(sent[0])).toMatchObject({ a: hash })
  })
})

describe('failed DMs keep trying', () => {
  it('retries on a bounded interval and reports the in-flight attempt', async () => {
    vi.useFakeTimers()
    const { mgr, store, send } = harness()
    send.mockRejectedValueOnce(new Error('courier down'))
    const first = await mgr.send(bob.orbitId, 'keep trying')
    expect(first.status).toBe('failed')
    expect(send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(store.thread(bob.orbitId)[0].status).toBe('sent')
    mgr.dispose()
  })

  it('retries immediately when a peer comes online', async () => {
    const { mgr, store, send } = harness()
    send.mockRejectedValueOnce(new Error('courier down'))
    await mgr.send(bob.orbitId, 'after online')
    expect(send).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new CustomEvent('orbit-peer-online', { detail: { peerId: bob.orbitId } }))
    await vi.waitFor(() => expect(store.thread(bob.orbitId)[0].status).toBe('sent'))
    expect(send).toHaveBeenCalledTimes(2)
    mgr.dispose()
  })

  it('marks a send retrying only while the attempt is in flight', async () => {
    const { mgr, store, send } = harness()
    send.mockRejectedValueOnce(new Error('courier down'))
    const msg = await mgr.send(bob.orbitId, 'in flight')

    let release!: () => void
    send.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({
        v: 2 as const, kind: 'mail' as const,
        to: deliveryToken(bob.publicKeyHex), id: 'env-late', sealed: 'x',
        fromEph: alice.encryptionPubHex,
      })
    }))
    const retry = mgr.resendFailed()
    expect(isDmRetrying(msg.id)).toBe(true)
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    release()
    await retry
    expect(isDmRetrying(msg.id)).toBe(false)
    expect(store.thread(bob.orbitId)[0].status).toBe('sent')
    mgr.dispose()
  })
})
