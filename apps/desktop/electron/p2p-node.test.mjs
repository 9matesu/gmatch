// node p2p-node.test.mjs — Slice 1 tests for the Electron-main libp2p node.
// Loopback only (deterministic, no multicast); mDNS is configured in the
// module and proven on LAN in the Slice 4 procedure, not here.
import assert from 'node:assert'
import { createP2PNode, isRelayed, LOOPBACK_LISTEN } from './p2p-node.mjs'

const timeout = (ms) => AbortSignal.timeout(ms)

function memStore() {
  let bytes = null
  let saves = 0
  return {
    load: async () => bytes,
    save: async (b) => { bytes = b; saves++ },
    saved: () => bytes,
    saveCount: () => saves,
  }
}

async function withNodes(fn) {
  const stops = []
  try {
    await fn(stops)
  } finally {
    await Promise.allSettled(stops.map((s) => s()))
  }
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

// 1. Two nodes, distinct ids, direct TCP dial + ping, never relayed.
await withNodes(async (stops) => {
  await check('direct TCP dial+ping between two nodes', async () => {
    const a = await createP2PNode({ keyStore: memStore(), listen: LOOPBACK_LISTEN, enableMdns: false })
    const b = await createP2PNode({ keyStore: memStore(), listen: LOOPBACK_LISTEN, enableMdns: false })
    stops.push(a.stop, b.stop)
    assert.notEqual(a.peerId.toString(), b.peerId.toString(), 'peer ids must differ')
    await a.node.dial(b.multiaddrs(), { signal: timeout(8000) })
    const ms = await a.ping(b.multiaddrs(), timeout(8000))
    assert.ok(Number.isFinite(ms), 'ping must return latency, got ' + ms)
    const conns = a.node.getConnections(b.peerId)
    assert.ok(conns.length > 0, 'expected an open connection')
    const addr = conns[0].remoteAddr.toString()
    assert.match(addr, /^\/ip4\/127\.0\.0\.1\/tcp\//, 'transport must be direct TCP, got ' + addr)
    assert.ok(!isRelayed([addr]), 'relayed hop must never count as direct')
    assert.ok(!isRelayed(a.multiaddrStrings()), 'no relay addrs may be announced')
  })
})

// 2. Same store across restarts keeps the PeerId; save happens once.
await withNodes(async (stops) => {
  await check('peer id persists across restarts, saved once', async () => {
    const store = memStore()
    const first = await createP2PNode({ keyStore: store, listen: LOOPBACK_LISTEN, enableMdns: false })
    const id = first.peerId.toString()
    await first.stop()
    const second = await createP2PNode({ keyStore: store, listen: LOOPBACK_LISTEN, enableMdns: false })
    stops.push(second.stop)
    assert.equal(second.peerId.toString(), id, 'restart must keep the peer id')
    assert.equal(store.saveCount(), 1, 'key saved once, got ' + store.saveCount())
  })
})

// 3. Fail-closed: unreachable peer errors, it never silently relays.
await withNodes(async (stops) => {
  await check('unreachable dial fails closed', async () => {
    const a = await createP2PNode({ keyStore: memStore(), listen: LOOPBACK_LISTEN, enableMdns: false })
    stops.push(a.stop)
    await assert.rejects(
      a.node.dial(['/ip4/127.0.0.1/tcp/9'], { signal: timeout(5000) }),
      'dial to a closed port must throw, never relay',
    )
  })
})

// 4. keyStore is mandatory (fail fast, not a half-started node).
await check('keyStore is required', async () => {
  await assert.rejects(createP2PNode({ listen: LOOPBACK_LISTEN }), /keyStore/)
})

if (failures.length > 0) {
  console.error(failures.length + ' failing: ' + failures.join(', '))
  process.exit(1)
}
console.log('p2p-node: all pass')
