# NET — libp2p integration design (1.5.5 line)

> **Status:** Accepted design for the vertical slice. Code lands per this doc;
> deviations update this doc first. Parent decisions: ADR-02/04/05/07.

## 1. Ownership

- The libp2p node lives in **Electron main**: `apps/desktop/electron/p2p-node.cjs`
  (CJS, like the rest of main). Rationale: browsers dial but never listen, so
  the renderer can never accept a server-free direct connection; Bun hosting is
  unverified for js-libp2p/WebRTC and gets its own spike only if needed.
- The renderer never imports libp2p. It sends/receives **existing Envelope-v2
  bytes** (`@orbit/protocol`: `seal1to1` / `open1to1`, sig rules unchanged).

## 2. Identity and binding (app key stays canonical)

- libp2p PeerId keypair (Ed25519) persists at `userData/p2p-peer-key`
  (0600 file). Preferred: reuse the existing `secure-kv.bin` via main's
  `secureKV` under a main-only key (`p2p_peer_key`) — same DPAPI file, no
  renderer change, never exposed over IPC. File fallback only if the KV shape
  fights binary bytes; the spike decides.
- Binding: the orbit identity signs the PeerId public bytes
  (`signMessage(peerIdPubBytes, orbitPrivHex)` via `packages/crypto`).
  On stream open each side presents `{ orbitId, orbitPubkey, peerId,
  sig }`; the receiver checks `verifySignature` + `orbitId == sha256(pubkey)`
  before accepting any envelope. Unknown/unbound peers are rejected.
- No identity migration. The libp2p key is a transport key, not a user.

## 3. IPC seam (minimal, four channels)

Preload exposes only: `p2p:status` (listen addrs, peer count, per-peer
transport label), `p2p:peers`, `p2p:send` (peerId + sealed-envelope bytes),
`p2p:on-message` (peerId + sealed-envelope bytes + transport label).
Main never sees plaintext; the renderer keeps all crypto.

## 4. Slice transports and discovery

- Listen: TCP `/ip4/0.0.0.0/tcp/0` (OS port; LAN-dialable addrs announced).
  `connectionEncrypters: [noise()]`, `streamMuxers: [yamux()]`.
- Discovery: mDNS (`@libp2p/mdns`, LAN) + **manual invitation** (full multiaddr
  pasted out-of-band — covers non-LAN without building discovery).
- **No relay, no DHT, no bootstrap in the slice.** The node is configured
  without them so a relayed path is a hard failure, not a silent fallback.
- Every connection record keeps `{ multiaddr, transport }`; the proof asserts
  transport is TCP, never relay.

## 5. App protocol

- Protocol id `/gmatch/1.0.0`. Frames: `{ binding, envelope }` where `envelope`
  is a sealed Envelope-v2 (`kind: 'mail'`, `to: deliveryToken`).
- Receiver: verify binding → `open1to1` with the orbit encryption key →
  existing validators (shape, author-sig, expiry, replay-dedupe) → deliver to
  renderer via `p2p:on-message`. Anything failing is dropped + counted, never
  rendered.

## 6. Failure and privacy posture

- No listen addr / dial timeout / NAT without port-forward → explicit
  `unreachable-direct` state. The UI says so; nothing auto-relays in the slice.
- Observables: direct peers see our listen IP + PeerId + orbit profile we
  publish. No anonymity claim (see `SECURITY.md` §4). Logs carry PeerIds and
  multiaddrs only at debug level, never private keys or plaintext.
- Relay (circuit-relay-v2, explicit + labeled) and DHT bootstraps are
  post-slice work behind this same seam.

## 7. Spike 0 record

- Location: `I:\Temp\p2p-spike` (throwaway, outside the repo — keeps the
  branch clean; results recorded here, not the code).
- Procedure: `npm i libp2p @libp2p/tcp @libp2p/mdns @chainsafe/libp2p-noise
  @chainsafe/libp2p-yamux`; two nodes, separate datadirs, TCP listen,
  dial-by-multiaddr, ping + echo-protocol message.
- Result: **PASS (2026-10-14).** Two nodes, distinct PeerIds, TCP listen on
  OS ports, dial-by-multiaddr, ping 3–4 ms, echo message both directions
  (`hello-from-A` → `pong-from-B`), connection `remoteAddr` confirms transport
  `/ip4/.../tcp/.../p2p/...` — no relay configured or involved.
- Versions: `libp2p@3.3.12`, `@libp2p/tcp@11.0.29`,
  `@chainsafe/libp2p-noise@17.0.0`, `@chainsafe/libp2p-yamux@8.0.1`,
  `@libp2p/ping@3.1.14` (+ `@libp2p/mdns@12.0.33` installed, unused in spike),
  Node v26.1.0. Install: 120 packages, 48 s from warm cache.
- v3 API gotchas found (apply in Slice 1): `node.handle()` is **async and must
  be awaited** (else silent registration race); inbound handler signature is
  **positional `(stream, connection)`**, not `({ stream })` (destructuring
  yields `undefined` and the stream resets); bare-PeerId dial needs known
  addresses or discovery — dial-by-multiaddr for the invitation flow;
  `getProtocols()` + `DEBUG=libp2p*` diagnose negotiation.
- Verdict: **js-libp2p is compatible** with our Node runtime for the slice
  (TCP + Noise + yamux + custom protocol). No app dependency added yet —
  Slice 1 pins these versions in `apps/desktop/package.json` with the ADR-07
  justification.
