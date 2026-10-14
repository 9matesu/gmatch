// Electron-main libp2p node (Slice 1): TCP listen + mDNS discovery, Noise
// encryption + yamux multiplexing, persistent Ed25519 PeerId via an injected
// keyStore. No relay, no DHT, no bootstrap: without them a relayed path is a
// hard failure, never a silent fallback (see docs/NET.md).
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { ping } from '@libp2p/ping'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'

export const DEFAULT_LISTEN = ['/ip4/0.0.0.0/tcp/0']
export const LOOPBACK_LISTEN = ['/ip4/127.0.0.1/tcp/0']

// keyStore: { load(): Promise<Uint8Array|null>, save(bytes: Uint8Array): Promise<void> }
// Main wires it to secure-kv (main-only key, never over IPC); tests use memory.
export async function createP2PNode({ keyStore, listen = DEFAULT_LISTEN, enableMdns = true } = {}) {
  if (typeof keyStore?.load !== 'function' || typeof keyStore?.save !== 'function') {
    throw new Error('p2p-node: keyStore { load, save } is required')
  }
  const saved = await keyStore.load()
  // v3 PeerIds carry no private key, and createLibp2p wants the key *object*,
  // so the protobuf bytes in the store are the persistence format and the
  // object is rehydrated on every boot.
  const key = saved ? privateKeyFromProtobuf(saved) : await generateKeyPair('Ed25519')
  const node = await createLibp2p({
    privateKey: key,
    addresses: { listen: [...listen] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: enableMdns ? [mdns()] : [],
    services: { ping: ping() },
  })
  await node.start()
  if (!saved) await keyStore.save(privateKeyToProtobuf(key))
  return {
    node,
    peerId: node.peerId,
    multiaddrs: () => node.getMultiaddrs(),
    multiaddrStrings: () => node.getMultiaddrs().map(String),
    ping: (peer, signal) => node.services.ping.ping(peer, { signal }),
    stop: () => node.stop(),
  }
}

// Fail-closed guard for the proof: a relayed hop must never count as direct.
export function isRelayed(multiaddrs) {
  return multiaddrs.some((m) => m.includes('/p2p-circuit'))
}
