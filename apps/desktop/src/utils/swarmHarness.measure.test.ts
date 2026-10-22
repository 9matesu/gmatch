import { describe, expect, it } from 'vitest'
import { SwarmTestNetwork, expectDurableBytes } from './swarmHarness'
import { sha256HexBlob } from './p2pSwarm'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { acceptInboundOperation } from '../services/socialOpTransport'
import { publishSignedPostOperation } from '../services/socialPublish'
import { projectPosts } from '../services/socialFeedProjection'
import { restoreIdentity } from '@orbit/crypto'

/**
 * Measurement + verification suite for peer-to-peer file dissemination
 * (roadmap L3/L8 evidence).
 *
 * It answers three questions with numbers instead of claims:
 * 1. Does a file actually reach a peer AND STAY there (durable persistence,
 *    including after that peer's session restarts)?
 * 2. How much does it cost? (wall time, CPU time, frames on the wire)
 * 3. Where does the CPU go? (chunk assembly / base64 framing is the hot path)
 *
 * Limits, stated honestly: both nodes live in ONE process, so this is protocol
 * and persistence evidence, not NAT evidence. Real disk cost is measured
 * separately by `node scripts/measure-disk.cjs`.
 */

const MIB = 1024 * 1024

function randomBytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size)
  let state = seed >>> 0
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = state & 0xff
  }
  return out
}

function measure() {
  const before = process.cpuUsage()
  const started = Date.now()
  return {
    elapsed: () => Date.now() - started,
    cpu: () => {
      const now = process.cpuUsage(before)
      return { userMs: now.user / 1000, systemMs: now.system / 1000, totalMs: (now.user + now.system) / 1000 }
    },
  }
}

describe('peer file dissemination (measured)', () => {
  it('moves a 4 MiB file to a peer, persists it, survives a restart, and re-seeds a third peer', async () => {
    const network = new SwarmTestNetwork()
    const a = network.createNode('A')
    const b = network.createNode('B')

    const bytes = randomBytes(4 * MIB, 42)
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' })
    const cid = await sha256HexBlob(blob)
    a.session.registerLocalObject(cid, blob)

    // 1. Dissemination: B asks for the object, the bytes must arrive intact.
    const transfer = measure()
    const framesBefore = network.delivered.length
    const fetched = await b.session.requestObject(cid, 30000, cid)
    const transferMs = transfer.elapsed()
    const cpu = transfer.cpu()
    const frames = network.delivered.length - framesBefore

    expect(fetched.size).toBe(4 * MIB)
    expect(await sha256HexBlob(fetched)).toBe(cid)
    expect(network.delivered.some((d) => d.msg.type === 'SWARM_WANT')).toBe(true)
    const chunkFrames = network.delivered.filter((d) => d.msg.type === 'SWARM_CHUNK').length
    const histogram = network.delivered.reduce<Record<string, number>>((acc, d) => {
      acc[d.msg.type] = (acc[d.msg.type] ?? 0) + 1
      return acc
    }, {})
    console.log('frame histogram:', JSON.stringify(histogram))
    // Frames are 4 KiB plaintext chunks (the relay's JSON budget with the
    // AEAD nonce+tag overhead of swarm-v1), not 64 KiB.
    expect(chunkFrames).toBe(Math.ceil((4 * MIB) / (4 * 1024)))

    // 2. Persistence: the bytes are in B's DURABLE store, not just in flight.
    expect(await expectDurableBytes(b, cid)).toBe(cid)

    // 3. Restart: a new session over the same durable store still holds them.
    const b2 = network.restart('B')
    expect(await expectDurableBytes(b2, cid)).toBe(cid)

    // 4. Re-seeding: the restarted peer can now serve the file to a third peer.
    const c = network.createNode('C')
    const reseed = measure()
    const fetchedByC = await c.session.requestObject(cid, 30000, cid)
    const reseedMs = reseed.elapsed()
    expect(await sha256HexBlob(fetchedByC)).toBe(cid)
    expect(await expectDurableBytes(c, cid)).toBe(cid)

    const mib = 4
    console.log(
      [
        '--- peer file dissemination (4 MiB, in-process, 2 peers) ---',
        `transfer: ${transferMs} ms wall, ${cpu.totalMs.toFixed(0)} ms cpu (user ${cpu.userMs.toFixed(0)} / sys ${cpu.systemMs.toFixed(0)})`,
        `throughput: ${(mib / (transferMs / 1000)).toFixed(1)} MiB/s, ${(mib / (cpu.totalMs / 1000)).toFixed(1)} MiB/s per cpu-second`,
        `wire: ${frames} frames (${chunkFrames} chunks of 64 KiB)`,
        `re-seed after restart: ${reseedMs} ms wall`,
      ].join('\n'),
    )
  }, 60000)

  it('fans a file out to several peers and keeps each copy durable', async () => {
    const network = new SwarmTestNetwork()
    const a = network.createNode('A')
    const bytes = randomBytes(2 * MIB, 7)
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' })
    const cid = await sha256HexBlob(blob)
    a.session.registerLocalObject(cid, blob)

    const peers = ['B', 'C', 'D'].map((id) => network.createNode(id))
    const fanout = measure()
    await Promise.all(peers.map((peer) => peer.session.requestObject(cid, 30000, cid)))
    const fanoutMs = fanout.elapsed()
    for (const peer of peers) {
      expect(await expectDurableBytes(peer, cid)).toBe(cid)
    }
    console.log(
      [
        '--- fan-out (2 MiB to 3 peers) ---',
        `${fanoutMs} ms wall for 3 durable copies`,
        `effective dissemination: 3/3 peers hold the bytes durably`,
      ].join('\n'),
    )
  }, 60000)
})

describe('operation replication cost (measured)', () => {
  it('replicates a 512-operation wave with one store scan and projects it cheaply', async () => {
    const store = new Map<string, LoggedOperation>()
    const backend: OperationLogBackend & { store: Map<string, LoggedOperation> } = {
      store,
      async put(entry) { store.set(entry.operationId, entry) },
      async get(id) { return store.get(id) ?? null },
      async getAll() { return [...store.values()] },
      async delete(id) { store.delete(id) },
    }

    const author = restoreIdentity('00'.repeat(32), '11'.repeat(32))
    const authorLog = new SocialOperationLog(backend)
    // The peer has its OWN store (a different machine), and its read cost is
    // what the wave measurement is about.
    let peerScans = 0
    const peerStore = new Map<string, LoggedOperation>()
    const peerBackend: OperationLogBackend = {
      async put(entry) { peerStore.set(entry.operationId, entry) },
      async get(id) { return peerStore.get(id) ?? null },
      async getAll() { peerScans += 1; return [...peerStore.values()] },
      async delete(id) { peerStore.delete(id) },
    }
    const peerLog = new SocialOperationLog(peerBackend)

    const wave = measure()
    let authorMs = 0
    let peerMs = 0
    for (let i = 0; i < 512; i += 1) {
      const authorStart = Date.now()
      const operation = await publishSignedPostOperation(author, {
        objectId: `post-${i}`,
        contentCid: `${i}`.repeat(64).slice(0, 64),
        mimeType: 'image/jpeg',
        sizeBytes: 1000 + i,
        caption: `post ${i}`,
      }, authorLog)
      authorMs += Date.now() - authorStart
      const peerStart = Date.now()
      const outcome = await acceptInboundOperation(peerLog, operation)
      peerMs += Date.now() - peerStart
      expect(outcome).toBe('accepted')
    }
    const waveMs = wave.elapsed()
    const waveCpu = wave.cpu()
    const scansAfterWave = peerScans

    const projection = measure()
    const projected = projectPosts(await peerLog.listAllOperations())
    const projectionMs = projection.elapsed()

    expect(projected).toHaveLength(512)
    console.log(
      [
        '--- operation replication wave (512 signed posts) ---',
        `${waveMs} ms wall, ${waveCpu.totalMs.toFixed(0)} ms cpu for 512 sign+validate+append cycles`,
        `author side (sign + authorize + append): ${authorMs} ms total, ${(authorMs / 512).toFixed(2)} ms per op`,
        `peer side (validate + authorize + append): ${peerMs} ms total, ${(peerMs / 512).toFixed(2)} ms per op`,
        `total cpu per operation: ${(waveCpu.totalMs / 512).toFixed(2)} ms`,
        `store scans on the peer during the wave: ${scansAfterWave} (one per read, not one per operation)`,
        `projection of 512 operations: ${projectionMs} ms`,
      ].join('\n'),
    )
  }, 120000)
})
