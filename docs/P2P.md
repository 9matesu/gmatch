# gmatch 1.5.5 — P2P

> Authoritative for this line. Behavior here is 1.5.3-verified unless marked
> (target). Protocol detail: `docs/ARCHITECTURE-P2P.md`.

## 1. Identity and cryptography

- Per-install Ed25519 identity (`@orbit/crypto`): `orbitId = sha256(pubkey)`.
  Separate X25519 keypair for E2EE (`blake3(ECDH)` → xchacha20poly1305).
- Keys live locally: `secure-kv.bin` (DPAPI) packaged, `localStorage` fallback
  in browser dev. No accounts, no central identity, no key upload.
- Every envelope body is author-signed; ids are content-addressed so replays
  dedupe and unlikes cannot collide with likes.

## 2. Discovery (1.5.5 → target)

| Path | 1.5.5 | Target |
| :--- | :--- | :--- |
| LAN | UDP multicast beacons, identity-only, cap 8 | libp2p mDNS |
| Node directory | gossiped signed node records, provenance-ranked, bundled floor | libp2p DHT + LAN |
| Presence rendezvous | shared mailbox token (single-host default — see limitation) | DHT/pubsub, multi-homed now (RECONSTRUCTION §5.6) |

## 3. Transports and replication

- 1.5.5: direct WebRTC DataChannels (`gmatch-mesh`), `SWARM_WANT/CHUNK` 5 KiB frames
  legacy media path, BitTorrent v1 (real infohashes, self-hosted blind wss
  trackers, no public trackers, no DHT), sealed courier mailboxes for
  off-mesh/DM/signal. Target: js-libp2p (WebRTC-direct, relay-v2 explicit
  fallback); custom signaling/presence/trackers retire as equivalents land.
- Replication: gossip apply-on-receipt semantics, bounded forward (≤8, once
  per target), parked out-of-order reactions, per-upstream cursors — queued
  from RECONSTRUCTION §3, not yet on this line.
- Sync vs connection: the UI must show transport liveness and replica
  convergence separately; relayed links are labeled relayed.

## 4. Fallback

Opt-in only (ADR-1.5.5-06). Disabling all fallback leaves Offline + Direct
intact. NAT симmetric / no-inbound networks: direct may be impossible — the UI
says so instead of silently relaying.

## 5. Limitations (tested where feasible; rest stated)

- Signaling/presence still rendezvous via hosted mailbox in 1.5.5; removing the
  host removes off-mesh reachability until the libp2p move lands.
- No peer-address exchange between peers yet; no DHT; symmetric NAT needs relay.
- `/api/objects/register` stays client-claimed (zero-media limit); proxied and
  multipart uploads are server-hashed.
