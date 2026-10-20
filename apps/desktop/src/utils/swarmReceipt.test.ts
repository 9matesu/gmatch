import { describe, expect, it, beforeEach } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { createReplicationReceipt, validateReplicationReceipt } from '@orbit/protocol'
import {
  __resetLocalObjectCacheForTests,
  __resetReceiptStateForTests,
  __resetWantedObjectsForTests,
  createSwarmSession,
  getDurableReplication,
  handleSwarmMessage,
  hydrateDurableReplications,
  registerLocalObject,
  setSwarmReceiptIdentity,
  setSwarmTransport,
  type SwarmMessage,
  type SwarmSession,
} from './p2pSwarm'

const FETCHER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

/** Real bytes; the object is registered under its own sha256 (content-addressed). */
const PAYLOAD = new TextEncoder().encode('replicated bytes for the receipt loop')

describe('swarm durable-replication receipts (L2 wiring)', () => {
  let contentId: string

  /** Two genuinely isolated peers wired frame-by-frame in both directions. */
  function wire(fetcherOverrides: Record<string, unknown> = {}): {
    a: SwarmSession; b: SwarmSession; frames: SwarmMessage[]
  } {
    const frames: SwarmMessage[] = []
    const a = createSwarmSession({ send: (m) => { frames.push(m); void b.handleMessage(m) } })
    const b = createSwarmSession({
      send: (m) => { frames.push(m); void a.handleMessage(m) },
      receiptIdentity: { orbitId: FETCHER.orbitId, publicKeyHex: FETCHER.publicKeyHex, privateKeyHex: FETCHER.privateKeyHex },
      ...fetcherOverrides,
    })
    return { a, b, frames }
  }

  beforeEach(async () => {
    const digest = await crypto.subtle.digest('SHA-256', PAYLOAD)
    contentId = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('')
  })

  /** The receipt lands asynchronously after the fetch resolves
   *  (read-back -> hash -> sign -> send); give it a macrotask. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('completes serve -> challenge -> durable persist -> validated receipt between two peers', async () => {
    const { a, b } = wire()
    a.registerLocalObject(contentId, new Blob([PAYLOAD], { type: 'text/plain' }))
    const received = await b.requestObject(contentId, 5000)
    expect(received.size).toBe(PAYLOAD.byteLength)
    await settle()

    const recorded = a.receiptRoles.getDurableReplication(contentId)
    expect(recorded).not.toBeNull()
    expect(validateReplicationReceipt(recorded!.receipt)).toBeNull()
    expect(recorded!.receipt.receiverKey).toBe(FETCHER.publicKeyHex)
    expect(recorded!.receipt.receiverId).toBe(FETCHER.orbitId)
    expect(recorded!.receipt.objectCid).toBe(contentId)
  })

  it('issues no receipt when the session has no signing identity', async () => {
    const { a, b, frames } = wire({ receiptIdentity: null })
    a.registerLocalObject(contentId, new Blob([PAYLOAD]))
    await b.requestObject(contentId, 5000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(frames.some((msg) => msg.type === 'SWARM_RECEIPT')).toBe(false)
    expect(a.receiptRoles.getDurableReplication(contentId)).toBeNull()
  })

  it('refuses to attest when the durable read-back fails', async () => {
    const { a, b, frames } = wire({ durableReadBack: async () => false })
    a.registerLocalObject(contentId, new Blob([PAYLOAD]))
    await b.requestObject(contentId, 5000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(frames.some((msg) => msg.type === 'SWARM_RECEIPT')).toBe(false)
    expect(a.receiptRoles.getDurableReplication(contentId)).toBeNull()
  })

  it('ignores tampered, stale-challenge, and unsolicited receipts', async () => {
    const { a, b } = wire()
    a.registerLocalObject(contentId, new Blob([PAYLOAD], { type: 'text/plain' }))
    await b.requestObject(contentId, 5000)
    await settle()
    const first = a.receiptRoles.getDurableReplication(contentId)!

    // Re-serve from A mints a FRESH challenge; the fetcher (already durable)
    // re-attests, so the recorded receipt must change.
    await a.handleMessage({ type: 'SWARM_WANT', id: contentId })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = a.receiptRoles.getDurableReplication(contentId)!
    expect(second.receipt.challenge).not.toBe(first.receipt.challenge)

    // Tampered payload (signature no longer matches) is ignored.
    await a.handleMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt: { ...second.receipt, objectCid: 'f'.repeat(64) } })
    expect(a.receiptRoles.getDurableReplication(contentId)!.confirmedAt).toBe(second.confirmedAt)

    // A receipt answering the consumed (stale) challenge is a replay, ignored.
    await a.handleMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt: first.receipt })
    expect(a.receiptRoles.getDurableReplication(contentId)!.confirmedAt).toBe(second.confirmedAt)

    // Unsolicited (no outstanding challenge at all) never resurrects evidence.
    a.receiptRoles.reset()
    await a.handleMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt: second.receipt })
    expect(a.receiptRoles.getDurableReplication(contentId)).toBeNull()
  })

  it('mints no challenge for non-content-addressed ids', async () => {
    const { a, b, frames } = wire()
    a.registerLocalObject('plain-object-id', new Blob(['x']))
    await b.handleMessage({ type: 'SWARM_WANT', id: 'plain-object-id' })
    expect(frames.some((msg) => msg.type === 'SWARM_CHALLENGE')).toBe(false)
  })

  it('wires the module-level singleton: mint on serve, validate and replay-guard on receipt', async () => {
    __resetReceiptStateForTests()
    __resetLocalObjectCacheForTests()
    __resetWantedObjectsForTests()
    const sent: SwarmMessage[] = []
    setSwarmTransport((m) => { sent.push(m) })
    setSwarmReceiptIdentity({ orbitId: FETCHER.orbitId, publicKeyHex: FETCHER.publicKeyHex, privateKeyHex: FETCHER.privateKeyHex })
    try {
      registerLocalObject(contentId, new Blob([PAYLOAD], { type: 'text/plain' }))
      await handleSwarmMessage({ type: 'SWARM_WANT', id: contentId })
      const challengeFrame = sent.find((m) => m.type === 'SWARM_CHALLENGE') as { challenge: string } | undefined
      expect(challengeFrame).toBeTruthy()

      // The receipt a fetcher would send, fed to the module's seeder side.
      const receipt = createReplicationReceipt({
        protocol: 'gmatch-social', version: 1,
        receiverId: FETCHER.orbitId, receiverKey: FETCHER.publicKeyHex,
        objectCid: contentId, manifestHash: contentId, durable: true,
        challenge: challengeFrame!.challenge, createdAt: Date.now(),
      }, FETCHER.privateKeyHex)
      await handleSwarmMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt })
      expect(getDurableReplication(contentId)?.receipt.challenge).toBe(challengeFrame!.challenge)

      // Replaying the same receipt changes nothing (challenge consumed).
      const confirmedAt = getDurableReplication(contentId)!.confirmedAt
      await handleSwarmMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt })
      expect(getDurableReplication(contentId)!.confirmedAt).toBe(confirmedAt)
    } finally {
      setSwarmTransport(null)
      __resetReceiptStateForTests()
    }
  })

  it('fires the persistence hook exactly once per accepted receipt', async () => {
    const recorded: Array<{ id: string; confirmedAt: number }> = []
    const frames: SwarmMessage[] = []
    const a = createSwarmSession({
      send: (m) => { frames.push(m); void b.handleMessage(m) },
      onRecord: (id, entry) => { recorded.push({ id, confirmedAt: entry.confirmedAt }) },
    })
    const b = createSwarmSession({
      send: (m) => { frames.push(m); void a.handleMessage(m) },
      receiptIdentity: { orbitId: FETCHER.orbitId, publicKeyHex: FETCHER.publicKeyHex, privateKeyHex: FETCHER.privateKeyHex },
    })
    a.registerLocalObject(contentId, new Blob([PAYLOAD]))
    await b.requestObject(contentId, 5000)
    await settle()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].id).toBe(contentId)
    expect(a.receiptRoles.getDurableReplication(contentId)!.confirmedAt).toBe(recorded[0].confirmedAt)
    // Rejections never trigger the hook.
    await a.handleMessage({ type: 'SWARM_RECEIPT', id: contentId, receipt: { tampered: true } })
    expect(recorded).toHaveLength(1)
  })

  it('hydrates persisted receipts as historical evidence', async () => {
    const roles = createSwarmSession({
      send: () => {},
      receiptIdentity: { orbitId: FETCHER.orbitId, publicKeyHex: FETCHER.publicKeyHex, privateKeyHex: FETCHER.privateKeyHex },
    }).receiptRoles
    const good = createReplicationReceipt({
      protocol: 'gmatch-social', version: 1,
      receiverId: FETCHER.orbitId, receiverKey: FETCHER.publicKeyHex,
      objectCid: 'a'.repeat(64), manifestHash: 'a'.repeat(64), durable: true,
      challenge: 'b'.repeat(64), createdAt: Date.now(),
    }, FETCHER.privateKeyHex)
    // note() is the hydrator's trusted path (rows are re-validated before it);
    // the receipt survives as historical evidence with its original timestamp.
    roles.note('a'.repeat(64), { receipt: good, confirmedAt: 1234 })
    expect(roles.getDurableReplication('a'.repeat(64))?.confirmedAt).toBe(1234)

    // Without IndexedDB (node env) hydration is a safe zero, never a throw.
    __resetReceiptStateForTests()
    await expect(hydrateDurableReplications()).resolves.toBe(0)
  })
})
