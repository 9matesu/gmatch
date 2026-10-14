// node p2p-protocol.test.mjs — Slice 2 tests: binding parity, frame codec,
// live two-node /gmatch/1.0.0 exchange (loopback, deterministic).
import assert from 'node:assert'
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, randomBytes } from '@noble/hashes/utils'
import { createP2PNode, LOOPBACK_LISTEN } from './p2p-node.mjs'
import {
  FRAME_MAX_BYTES,
  decodeFrame,
  encodeFrame,
  registerGmatchProtocol,
  sendFrame,
  verifyPeerBinding,
} from './p2p-protocol.mjs'

// Same fixed vector as packages/protocol/src/peer-binding.test.ts — the parity pin.
const VECTOR = {
  orbitId: '448f04ffcba874db93d9fd02520daa583a92b1f20b100ff791202a6d7a93e0de',
  orbitPubkeyHex: 'e734ea6c2b6257de72355e472aa05a4c487e6b463c029ed306df2f01b5636b58',
  peerId: '12D3KooWTestVector000000000000000000000000000001',
  sigHex: '41d4d659da13e64814bd4d5b687f38c3e19ed7143594ed9a4cb7b2187db52aaf93af64d4b578daccd8d3e216d9ceb45a02cc965cf6300ef3a56a15e42456730a',
}

const timeout = (ms) => AbortSignal.timeout(ms)

function memStore() {
  let bytes = null
  return { load: async () => bytes, save: async (b) => { bytes = b } }
}

// Independent binding signer (noble directly — cross-checks the main verifier
// instead of reusing the TS implementation).
function signBinding(peerId) {
  const priv = randomBytes(32)
  const pub = ed25519.getPublicKey(priv)
  const orbitId = bytesToHex(sha256(pub))
  const sig = bytesToHex(ed25519.sign(new TextEncoder().encode(`gmatch-peer-binding-v1|${peerId}|${orbitId}`), priv))
  return { orbitId, orbitPubkeyHex: bytesToHex(pub), peerId, sigHex: sig }
}

const fakeEnvelope = (id) => ({ v: 2, kind: 'mail', to: 'tok', id, sealed: 'c2VhbGVk' })

const failures = []
async function check(name, fn) {
  try {
    await fn()
    console.log('ok -', name)
  } catch (err) {
    failures.push(name)
    console.error('FAIL -', name, '-', err.message)
  }
}

await check('parity: fixed vector verifies, tampered does not', async () => {
  assert.equal(verifyPeerBinding(VECTOR), true)
  assert.equal(verifyPeerBinding({ ...VECTOR, sigHex: '00' + VECTOR.sigHex.slice(2) }), false)
  assert.equal(verifyPeerBinding({ ...VECTOR, peerId: VECTOR.peerId + '!' }), false)
  assert.equal(verifyPeerBinding(null), false)
})

await check('codec round-trips; oversize and malformed frames throw', async () => {
  const text = encodeFrame(VECTOR, fakeEnvelope('a'))
  const back = decodeFrame(text)
  assert.equal(back.envelope.id, 'a')
  assert.equal(back.binding.orbitId, VECTOR.orbitId)
  assert.throws(() => encodeFrame(VECTOR, fakeEnvelope('big-' + 'x'.repeat(FRAME_MAX_BYTES))), /over cap/)
  assert.throws(() => decodeFrame('not json'), /not JSON/)
  assert.throws(() => decodeFrame(JSON.stringify({ binding: VECTOR, envelope: { v: 1 } })), /bad envelope/)
  assert.throws(() => decodeFrame(JSON.stringify({ binding: { nope: 1 }, envelope: fakeEnvelope('b') })), /bad binding/)
})

await check('live: valid frame delivered with transport; bad binding dropped', async () => {
  const a = await createP2PNode({ keyStore: memStore(), listen: LOOPBACK_LISTEN, enableMdns: false })
  const b = await createP2PNode({ keyStore: memStore(), listen: LOOPBACK_LISTEN, enableMdns: false })
  try {
    const got = []
    const drops = []
    await registerGmatchProtocol(b.node, {
      onFrame: (f) => got.push(f),
      onDrop: (d) => drops.push(d),
    })
    await a.node.dial(b.multiaddrs(), { signal: timeout(8000) })

    const binding = signBinding(a.peerId.toString())
    await sendFrame(a.node, b.peerId, binding, fakeEnvelope('live-1'), timeout(8000))
    const deadline = Date.now() + 8000
    while (got.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.equal(got.length, 1, 'valid frame must be delivered')
    assert.equal(got[0].envelope.id, 'live-1')
    assert.equal(got[0].binding.orbitId, binding.orbitId)
    assert.match(got[0].transport, /\/tcp\//, 'transport must be direct TCP, got ' + got[0].transport)
    assert.ok(!got[0].transport.includes('/p2p-circuit'), 'never relayed')

    const bad = { ...signBinding(a.peerId.toString()), sigHex: 'ff' + signBinding(a.peerId.toString()).sigHex.slice(2) }
    await sendFrame(a.node, b.peerId, bad, fakeEnvelope('live-2'), timeout(8000))
    const dDeadline = Date.now() + 5000
    while (drops.length === 0 && Date.now() < dDeadline) await new Promise((r) => setTimeout(r, 50))
    assert.equal(got.length, 1, 'bad binding must not deliver')
    assert.equal(drops.length, 1)
    assert.match(drops[0].reason, /bad binding/)
  } finally {
    await Promise.allSettled([a.stop(), b.stop()])
  }
})

if (failures.length > 0) {
  console.error(failures.length + ' failing: ' + failures.join(', '))
  process.exit(1)
}
console.log('p2p-protocol: all pass')
