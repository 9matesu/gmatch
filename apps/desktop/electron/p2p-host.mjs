// P2P host glue for main.cjs (Slice 3): lazy libp2p node lifecycle, keyStore
// wired to the DPAPI secure KV under a main-only key (never exposed over the
// secure:* bridge), inbound frames fanned out to all windows. No Electron
// import here — webContents/sendToRenderer are injected, so this is testable
// with plain node. Renderer speaks sealed Envelope-v2 only; main never sees
// plaintext (see docs/NET.md).
import { createP2PNode, isRelayed } from './p2p-node.mjs'
import { registerGmatchProtocol, sendFrame, verifyPeerBinding } from './p2p-protocol.mjs'

export const P2P_PEER_KEY = 'p2p_peer_key'

export function createP2PHost({ secureKV, listen, enableMdns, webContents, log = () => {} } = {}) {
  if (!secureKV?.get || !secureKV?.set) throw new Error('p2p-host: secureKV { get, set } is required')
  let started = null

  const keyStore = {
    load: async () => {
      const b64 = await secureKV.get(P2P_PEER_KEY)
      return typeof b64 === 'string' && b64.length > 0 ? Buffer.from(b64, 'base64') : null
    },
    save: async (bytes) => {
      await secureKV.set(P2P_PEER_KEY, Buffer.from(bytes).toString('base64'))
    },
  }

  const emit = (channel, payload) => {
    for (const wc of webContents()) {
      try { wc.send(channel, payload) } catch {}
    }
  }

  async function ensure() {
    if (!started) {
      started = (async () => {
        const h = await createP2PNode({ keyStore, listen, enableMdns })
        await registerGmatchProtocol(h.node, {
          onFrame: (f) => emit('p2p:message', f),
          onDrop: (d) => log(`p2p drop from ${d.peerId}: ${d.reason}`),
        })
        return h
      })().catch((err) => { started = null; throw err })
    }
    return started
  }

  async function peerRows(h) {
    const rows = []
    for (const id of h.node.getPeers()) {
      const addrs = h.node.getConnections(id).map((c) => c.remoteAddr.toString())
      rows.push({ id: id.toString(), addr: addrs[0] ?? null, relayed: isRelayed(addrs) })
    }
    return rows
  }

  return {
    // Lazy start: the node boots on first status/send call, not at app launch.
    async status() {      const h = await ensure()
      return { started: true, peerId: h.peerId.toString(), addrs: h.multiaddrStrings(), peers: await peerRows(h) }
    },
    async peers() {
      const h = await ensure()
      return peerRows(h)
    },
    // payload: { peer (PeerId or multiaddr string), binding, envelope }.
    // The binding must be ours (same peerId we listen as) and verify, or the
    // send is refused before anything is dialed.
    async send(payload) {
      const h = await ensure()
      const ownId = h.peerId.toString()
      const { peer, binding, envelope } = payload ?? {}
      if (typeof peer !== 'string' || peer.length === 0) return { ok: false, error: 'peer required' }
      if (!verifyPeerBinding(binding) || binding.peerId !== ownId) {
        return { ok: false, error: 'binding must be our own verified binding' }
      }
      try {
        await sendFrame(h.node, peer, binding, envelope)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    },
    // Full teardown (app quit, tests): next status()/send() boots a fresh node.
    async stop() {
      const p = started
      started = null
      if (!p) return
      try {
        await (await p).node.stop()
      } catch {}
    },
  }
}
