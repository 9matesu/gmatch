import { describe, expect, it, beforeEach } from 'vitest'
import { SwarmTestNetwork, expectDurableBytes } from './swarmHarness'
import {
  __resetLocalObjectCacheForTests,
  __resetReceiptStateForTests,
  __resetWantedObjectsForTests,
} from './p2pSwarm'

/** Small payload: fits one chunk. */
const PAYLOAD = new TextEncoder().encode('l3 in-process harness payload')
/** Large payload: spans multiple chunks (partition scenario needs a partial). */
const BIG_PAYLOAD = new TextEncoder().encode('z'.repeat(6 * 1024))

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

async function sha256Of(payload: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('L3 in-process multi-instance harness', () => {
  let contentId: string
  let bigContentId: string

  beforeEach(async () => {
    __resetReceiptStateForTests()
    __resetLocalObjectCacheForTests()
    __resetWantedObjectsForTests()
    contentId = await sha256Of(PAYLOAD)
    bigContentId = await sha256Of(BIG_PAYLOAD)
  })

  it('A publishes, B replicates with a receipt, then C replicates from B while A is gone', async () => {
    const net = new SwarmTestNetwork()
    const a = net.createNode('A')
    const b = net.createNode('B')
    net.createNode('C')

    // A publishes (its durable store IS the session store in the harness).
    a.durable.set(contentId, new Blob([PAYLOAD]))

    // B fetches from the swarm; A serves, challenges, and records B's receipt.
    await b.session.requestObject(contentId, 5000, contentId)
    await settle()
    expect(await expectDurableBytes(b, contentId)).toBe(contentId)
    expect(net.node('A').session.receiptRoles.getDurableReplication(contentId)?.receipt.receiverId)
      .toBe(b.identity!.orbitId)

    // A leaves the network entirely.
    net.isolate('A')

    // C fetches the same object — now served by B, which earned durable
    // custody and can attest it. A is gone; no central API is involved.
    const c = net.node('C')
    await c.session.requestObject(contentId, 5000, contentId)
    await settle()
    expect(await expectDurableBytes(c, contentId)).toBe(contentId)
    const bReceipt = b.session.receiptRoles.getDurableReplication(contentId)
    expect(bReceipt?.receipt.receiverId).toBe(c.identity!.orbitId)
    expect(bReceipt?.receipt.objectCid).toBe(contentId)
  })

  it('nodes restart onto their durable stores and keep serving with fresh receipts', async () => {
    const net = new SwarmTestNetwork()
    net.createNode('A').durable.set(contentId, new Blob([PAYLOAD]))
    const b = net.createNode('B')
    await b.session.requestObject(contentId, 5000, contentId)
    await settle()
    // Receipt A holds for B (from the first transfer).
    const firstReceipt = net.node('A').session.receiptRoles.getDurableReplication(contentId)!

    // Both fetcher and seeder "restart": fresh sessions over the same
    // durable bytes and identity. The old sessions are abandoned.
    net.restart('A')
    net.restart('B')

    const c = net.createNode('C')
    await c.session.requestObject(contentId, 5000, contentId)
    await settle()

    // Restarted B served the object from its durable store and recorded a
    // fresh receipt for C — with a challenge that did not exist before.
    const b2 = net.node('B')
    expect(await expectDurableBytes(b2, contentId)).toBe(contentId)
    const newReceipt = b2.session.receiptRoles.getDurableReplication(contentId)!
    expect(newReceipt.receipt.receiverId).toBe(c.identity!.orbitId)
    expect(newReceipt.receipt.challenge).not.toBe(firstReceipt.receipt.challenge)
  })

  it('frame duplication never corrupts a fetch or double-records a receipt', async () => {
    const net = new SwarmTestNetwork()
    net.createNode('A').durable.set(contentId, new Blob([PAYLOAD]))
    const b = net.createNode('B')
    net.createNode('C')
    net.duplicateFrom('A')

    await b.session.requestObject(contentId, 5000, contentId)
    await settle()
    // Bytes verified exactly once; the duplicated receipt (a replay of a
    // consumed challenge) is ignored, so exactly one record exists on A.
    expect(await expectDurableBytes(b, contentId)).toBe(contentId)
    const recorded = net.node('A').session.receiptRoles.getDurableReplication(contentId)
    expect(recorded).not.toBeNull()
    expect(recorded!.receipt.receiverId).toBe(b.identity!.orbitId)
  })

  it('a mid-transfer partition fails the fetch; reconnect and re-request recover', async () => {
    const net = new SwarmTestNetwork()
    net.createNode('A').durable.set(bigContentId, new Blob([BIG_PAYLOAD]))
    const b = net.createNode('B')

    // Deliver only chunk 0 of the multi-chunk object, drop the rest.
    const cancelDrop = net.dropWhere((from, msg) =>
      from === 'A' && msg.type === 'SWARM_CHUNK' && msg.index > 0)
    await expect(b.session.requestObject(bigContentId, 250, bigContentId)).rejects.toThrow(/Timed out/)
    expect(b.durable.has(bigContentId)).toBe(false)
    // No receipt was recorded for an incomplete transfer.
    expect(net.node('A').session.receiptRoles.getDurableReplication(bigContentId)).toBeNull()

    cancelDrop()
    await b.session.requestObject(bigContentId, 5000, bigContentId)
    await settle()
    expect(await expectDurableBytes(b, bigContentId)).toBe(bigContentId)
    const receipt = net.node('A').session.receiptRoles.getDurableReplication(bigContentId)
    expect(receipt?.receipt.receiverId).toBe(b.identity!.orbitId)
  })
})
