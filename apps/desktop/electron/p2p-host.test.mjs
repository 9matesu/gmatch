// node p2p-host.test.mjs — Slice 3 tests: host lifecycle over injected fakes,
// key persistence through the secure KV, full A->B frame delivery with the
// binding enforced, sends refused without our own verified binding.
import assert from 'node:assert'
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, randomBytes } from '@noble/hashes/utils'
import { createP2PHost, P2P_PEER_KEY } from './p2p-host.mjs'
import { LOOPBACK_LISTEN } from './p2p-node.mjs'

function memKV() {
  const map = new Map()
  return {
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, String(v)) },
  }
}

function signBinding(peerId) {
  const priv = randomBytes(32)
  const pub = ed25519.getPublicKey(priv)
  const orbitId = bytesToHex(sha256(pub))
  const sig = bytesToHex(ed25519.sign(new TextEncoder().encode(`gmatch-peer-binding-v1|${peerId}|${orbitId}`), priv))
  return { orbitId, orbitPubkeyHex: bytesToHex(pub), peerId, sigHex: sig }
}

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

await check('status lazy-starts, persists key in secure KV, reports peers', async () => {
  const kv = memKV()
  const received = []
  const host = createP2PHost({
    secureKV: kv,
    listen: LOOPBACK_LISTEN,
    enableMdns: false,
    webContents: () => [{ send: (ch, p) => received.push([ch, p]) }],
  })
  const s1 = await host.status()
  assert.equal(s1.started, true)
  assert.match(s1.peerId, /^12D3Koo/)
  assert.ok(s1.addrs.some((a) => a.includes('/tcp/')), 'must announce a TCP addr, got ' + JSON.stringify(s1.addrs))
  assert.ok((await kv.get(P2P_PEER_KEY))?.length > 0, 'peer key must persist in secure KV')
  assert.deepEqual(await host.peers(), [])
  await host.stop()
  const s2 = await host.status()
  assert.equal(s2.started, true, 'stop resets so status reboots')
  await host.stop()
})

await check('A->B delivery through two hosts; transport direct; bad binding refused', async () => {
  const inboxB = []
  const hostA = createP2PHost({ secureKV: memKV(), listen: LOOPBACK_LISTEN, enableMdns: false, webContents: () => [] })
  const hostB = createP2PHost({
    secureKV: memKV(), listen: LOOPBACK_LISTEN, enableMdns: false,
    webContents: () => [{ send: (ch, p) => { if (ch === 'p2p:message') inboxB.push(p) } }],
  })
  const [sa, sb] = await Promise.all([hostA.status(), hostB.status()])
  assert.notEqual(sa.peerId, sb.peerId)

  const binding = signBinding(sa.peerId)
  const envelope = { v: 2, kind: 'mail', to: 'tok', id: 'host-live-1', sealed: 'c2VhbGVk' }
  // Peer unknown by multiaddr: pass B's listen addr directly (invitation flow).
  const bAddr = sb.addrs.find((a) => a.includes('/tcp/'))
  const res = await hostA.send({ peer: bAddr, binding, envelope })
  assert.deepEqual(res, { ok: true })
  const deadline = Date.now() + 8000
  while (inboxB.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  assert.equal(inboxB.length, 1, 'B must receive exactly one frame')
  assert.equal(inboxB[0].envelope.id, 'host-live-1')
  assert.equal(inboxB[0].binding.orbitId, binding.orbitId)
  assert.match(inboxB[0].transport, /\/tcp\//, 'transport must be direct TCP')
  assert.ok(!inboxB[0].transport.includes('/p2p-circuit'), 'never relayed')

  const peers = await hostB.peers()
  assert.equal(peers.length, 1)
  assert.equal(peers[0].relayed, false)

  const refused = await hostA.send({ peer: bAddr, binding: { ...binding, sigHex: '00' + binding.sigHex.slice(2) }, envelope })
  assert.equal(refused.ok, false, 'forged binding must be refused before dial')
  const foreign = signBinding('12D3KooWSomebodyElse00000000000000000000000000')
  const refused2 = await hostA.send({ peer: bAddr, binding: foreign, envelope })
  assert.equal(refused2.ok, false, 'another peerId binding must be refused')
  assert.equal(await hostA.send({ peer: '', binding, envelope }).then((r) => r.ok), false)
  await Promise.allSettled([hostA.stop(), hostB.stop()])
})

if (failures.length > 0) {
  console.error(failures.length + ' failing: ' + failures.join(', '))
  process.exit(1)
}
console.log('p2p-host: all pass')
