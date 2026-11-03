// Replication targeting (Priority 6): a receipt is accepted only through the
// real challenge→attest→receive flow, so one identity is NEVER two holders;
// the persisted row keeps the distinct-holder list across restarts; and the
// peer-online HAVE wave advertises under-target objects first (the
// HAVE-retrigger for replication recovery).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSwarmOffer, createReplicationReceipt } from '@orbit/protocol'
import { generateIdentity } from '@orbit/crypto'
import {
  __resetLocalObjectCacheForTests,
  __resetReceiptStateForTests,
  announceHeldObjects,
  durableCustodyHolders,
  getDurableReplication,
  handleSwarmMessage,
  heldSwarmObjectIds,
  hydrateDurableReplications,
  prioritizeUnderReplicated,
  registerLocalObject,
  setSwarmTransport,
  sha256HexBlob,
  SWARM_REPLICATION_TARGET,
  type SwarmMessage,
} from './p2pSwarm'

/** The persisted receipt store, mocked end to end so the write-then-hydrate
 *  round-trip of the distinct-holder list is exercised against real rows. */
const receiptRows = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  saveObject: vi.fn(async () => false),
  getObject: vi.fn(async () => null),
  saveSwarmReceipt: vi.fn(async (entry: unknown) => {
    const row = entry as { objectCid: string }
    receiptRows.set(row.objectCid, entry)
  }),
  getAllSwarmReceipts: vi.fn(async () => [...receiptRows.values()]),
}))

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

beforeEach(() => {
  receiptRows.clear()
  __resetReceiptStateForTests()
  __resetLocalObjectCacheForTests()
  setSwarmTransport(null)
})

/** One full serve flow: seeder answers an offered WANT (KEY+CHUNKS+CHALLENGE)
 *  and `holder` — a REAL identity (fresh unless given) — signs the
 *  read-back-attested receipt back into the module engine. */
async function attestToSeeder(id: string, holder: ReturnType<typeof generateIdentity> | null = null): Promise<void> {
  const identity = holder ?? generateIdentity()
  const sent: SwarmMessage[] = []
  setSwarmTransport((msg) => sent.push(msg))
  const offer = createSwarmOffer()
  await handleSwarmMessage({ type: 'SWARM_WANT', id, transferId: 'ab'.repeat(32), offerPub: offer.publicKeyHex })
  setSwarmTransport(null)
  const challenge = sent.find((m) => m.type === 'SWARM_CHALLENGE') as { id: string; challenge: string } | undefined
  expect(challenge, 'seeder served the offered WANT with a challenge').toBeTruthy()
  const receipt = createReplicationReceipt({
    protocol: 'gmatch-social',
    version: 1,
    receiverId: identity.orbitId,
    receiverKey: identity.publicKeyHex,
    objectCid: id,
    manifestHash: id,
    durable: true,
    challenge: challenge!.challenge,
    createdAt: Date.now(),
  }, identity.privateKeyHex)
  await handleSwarmMessage({ type: 'SWARM_RECEIPT', id, receipt })
  await settle()
}

describe('distinct verified custody holders', () => {
  it('the seeder itself is exactly one holder before any receipt exists', async () => {
    const id = await sha256HexBlob(new Blob(['unsourced']))
    registerLocalObject(id, new Blob(['unsourced']))
    expect(durableCustodyHolders(id)).toBe(1)
  })

  it('counts distinct receipts and replays/per-identity duplicates only once', async () => {
    const id = await sha256HexBlob(new Blob(['duplicated']))
    registerLocalObject(id, new Blob(['duplicated']))

    // The SAME identity attests twice (two fresh serve flows): one holder.
    const repeated = generateIdentity()
    await attestToSeeder(id, repeated)
    await attestToSeeder(id, repeated)
    expect(durableCustodyHolders(id)).toBe(2) // self + one distinct identity
    expect(getDurableReplication(id)?.receipt.receiverId).toBe(repeated.orbitId)

    // A second distinct identity: two holders — never folded into one.
    await attestToSeeder(id)
    expect(durableCustodyHolders(id)).toBe(SWARM_REPLICATION_TARGET)
  })

  it('a receipt is never accepted without the outstanding challenge (no fabricated custody)', async () => {
    const id = await sha256HexBlob(new Blob(['unsolicited']))
    registerLocalObject(id, new Blob(['unsolicited']))
    const holder = generateIdentity()
    const receipt = createReplicationReceipt({
      protocol: 'gmatch-social',
      version: 1,
      receiverId: holder.orbitId,
      receiverKey: holder.publicKeyHex,
      objectCid: id,
      manifestHash: id,
      durable: true,
      challenge: 'ee'.repeat(32),
      createdAt: Date.now(),
    }, holder.privateKeyHex)
    await handleSwarmMessage({ type: 'SWARM_RECEIPT', id, receipt })
    await settle()
    expect(getDurableReplication(id)).toBeNull()
    expect(durableCustodyHolders(id)).toBe(1)
  })
})

describe('the HAVE wave is replication-targeting', () => {
  it('floats under-target held objects to the front of the advertisement', async () => {
    const starvingId = await sha256HexBlob(new Blob(['needs-a-holder']))
    const fedId = await sha256HexBlob(new Blob(['already-durable']))
    // Recency: fed registered LAST, so a most-recent-first wave would offer
    // it first; the under-replicated copy must outrank it.
    registerLocalObject(starvingId, new Blob(['needs-a-holder']))
    registerLocalObject(fedId, new Blob(['already-durable']))
    await attestToSeeder(fedId)
    await attestToSeeder(fedId)
    expect(durableCustodyHolders(fedId)).toBe(3)

    const ordered = prioritizeUnderReplicated(heldSwarmObjectIds())
    expect(ordered[0]).toBe(starvingId)
    expect(ordered).toContain(fedId)
    expect(ordered).toHaveLength(2)
    expect(ordered.indexOf(starvingId)).toBeLessThan(ordered.indexOf(fedId))
  })

  it('announceHeldObjects sends the under-replicated slice first', async () => {
    const starvingId = await sha256HexBlob(new Blob(['advertise-me']))
    const fedId = await sha256HexBlob(new Blob(['well-served']))
    registerLocalObject(starvingId, new Blob(['advertise-me']))
    registerLocalObject(fedId, new Blob(['well-served']))
    await attestToSeeder(fedId)
    await attestToSeeder(fedId)

    const sent: SwarmMessage[] = []
    setSwarmTransport((msg) => sent.push(msg))
    expect(announceHeldObjects()).toBe(2)
    const have = sent[0] as { type: string; ids: string[] }
    expect(have.type).toBe('SWARM_HAVE')
    expect(have.ids[0]).toBe(starvingId)
  })

  it('stays silent, and quiet, without a transport', () => {
    const id = 'x'.repeat(64)
    registerLocalObject(id, new Blob(['no-wire']))
    expect(announceHeldObjects()).toBe(0)
  })
})

describe('holder evidence survives a restart', () => {
  it('persists the distinct-holder list and reloads it (new row shape)', async () => {
    const id = await sha256HexBlob(new Blob(['survives']))
    registerLocalObject(id, new Blob(['survives']))
    await attestToSeeder(id)
    await attestToSeeder(id)
    expect(durableCustodyHolders(id)).toBe(3)
    expect(receiptRows.get(id)).toMatchObject({ objectCid: id })
    expect((receiptRows.get(id) as { holders?: unknown[] }).holders).toHaveLength(2)

    __resetReceiptStateForTests()
    expect(durableCustodyHolders(id)).toBe(1)
    const loaded = await hydrateDurableReplications()
    expect(loaded).toBe(1)
    expect(durableCustodyHolders(id)).toBe(3)
  })

  it('a legacy row without a holder list still reads back as its one receipt', async () => {
    const id = await sha256HexBlob(new Blob(['legacy-row']))
    const holder = generateIdentity()
    // Written before holder bookkeeping existed: receipt + confirmedAt only.
    receiptRows.set(id, {
      objectCid: id,
      receipt: createReplicationReceipt({
        protocol: 'gmatch-social',
        version: 1,
        receiverId: holder.orbitId,
        receiverKey: holder.publicKeyHex,
        objectCid: id,
        manifestHash: id,
        durable: true,
        challenge: 'cd'.repeat(32),
        createdAt: Date.now() - 1000,
      }, holder.privateKeyHex),
      confirmedAt: Date.now(),
      // no `holders`
    } as unknown as Record<string, unknown>)
    expect(await hydrateDurableReplications()).toBe(1)
    expect(durableCustodyHolders(id)).toBe(2)
  })
})
