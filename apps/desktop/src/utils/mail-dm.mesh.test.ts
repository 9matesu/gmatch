// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { seal1to1, open1to1, parseSwarmFrame } from '@orbit/protocol'
import { DmStore, DmManager, encodeDmBody, type DmMessage } from './mail-dm'
import { handleSwarmMessage, setSwarmDmHandler } from './p2pSwarm'

// A sealed DM that rides the MESH (SWARM_DM) must decode to the EXACT message
// the courier mailbox path produces: the mesh only moves the same Envelope v2
// ciphertext, and the receiver authorizes by the same signature check
// (open1to1). This is the proof that mesh-carried DMs are not a second format.

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

function storeFor(identity: typeof bob): DmStore {
  return new DmStore(identity)
}

function managerFor(identity: typeof bob, store: DmStore) {
  const mail = { send: async () => { throw new Error('no mailbox in this test') } }
  return new DmManager({ mail: mail as never, store, identity, onThreadChanged: () => {} })
}

describe('mesh-carried sealed DM (SWARM_DM)', () => {
  beforeEach(() => {
    localStorage.clear()
    setSwarmDmHandler(null)
  })

  it('a DM sealed for the mesh decodes to the same stored message as the courier path', async () => {
    const body = encodeDmBody({
      id: 'dm-mesh-1', peerId: bob.orbitId, own: true, text: 'over the mesh', ts: 1234, status: 'sent', senderName: 'Alice',
    } satisfies DmMessage)
    const env = seal1to1(body, 'mail', alice, bob)

    // The courier path: open the envelope, hand it to the manager.
    const courierStore = storeFor(bob)
    managerFor(bob, courierStore).handleOpened(open1to1(env, bob.encryptionPrivHex), env)
    const courierMsg = courierStore.thread(alice.orbitId)[0]

    // The mesh path: the SAME envelope wrapped in a SWARM_DM frame, narrowed by
    // the shared contract, routed through handleSwarmMessage to the wired DM
    // handler (which opens + stores exactly as the courier path does).
    const meshStore = storeFor(bob)
    const meshMgr = managerFor(bob, meshStore)
    setSwarmDmHandler((incoming) => {
      meshMgr.handleOpened(open1to1(incoming, bob.encryptionPrivHex), incoming)
    })
    const frame = parseSwarmFrame({ type: 'SWARM_DM', envelope: env })
    expect(frame?.type).toBe('SWARM_DM')
    const consumed = await handleSwarmMessage(frame!)
    expect(consumed).toBe(true)

    const meshMsg = meshStore.thread(alice.orbitId)[0]
    expect(meshMsg).toEqual(courierMsg)
    expect(meshMsg.text).toBe('over the mesh')
    expect(meshMsg.senderName).toBe('Alice')
    expect(meshMsg.own).toBe(false)
  })

  it('a tampered/foreign envelope is dropped, never stored', async () => {
    const body = encodeDmBody({ id: 'dm-evil', peerId: bob.orbitId, own: true, text: 'x', ts: 1, status: 'sent' })
    const env = seal1to1(body, 'mail', alice, bob)
    // Flip a byte of the ciphertext: the signature/ECIES check must fail.
    const sealed = Buffer.from(env.sealed, 'base64')
    sealed[0] ^= 0x01
    const tampered = { ...env, sealed: sealed.toString('base64') }

    const store = storeFor(bob)
    const mgr = managerFor(bob, store)
    setSwarmDmHandler((incoming) => {
      try {
        mgr.handleOpened(open1to1(incoming, bob.encryptionPrivHex), incoming)
      } catch { /* bad signature: drop */ }
    })
    const frame = parseSwarmFrame({ type: 'SWARM_DM', envelope: tampered })
    await handleSwarmMessage(frame!)
    expect(store.thread(alice.orbitId)).toHaveLength(0)
  })

  it('an ack over the mesh marks the sender message delivered', async () => {
    // Recipient acks a DM it received; the ack rides back as its own SWARM_DM.
    const ackBody = JSON.stringify({ t: 'dm_ack', id: 'dm-mesh-1' })
    const ackEnv = seal1to1(ackBody, 'mail', bob, alice)

    const aliceStore = storeFor(alice)
    aliceStore.appendLocal({ id: 'dm-mesh-1', peerId: bob.orbitId, own: true, text: 'hi', ts: 1, status: 'sent' })
    const aliceMgr = managerFor(alice, aliceStore)
    setSwarmDmHandler((incoming) => {
      aliceMgr.handleOpened(open1to1(incoming, alice.encryptionPrivHex), incoming)
    })
    const frame = parseSwarmFrame({ type: 'SWARM_DM', envelope: ackEnv })
    await handleSwarmMessage(frame!)
    expect(aliceStore.thread(bob.orbitId)[0].status).toBe('delivered')
  })
})