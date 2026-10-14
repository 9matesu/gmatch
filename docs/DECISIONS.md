# Architectural decisions — 1.5.5 line

> Statuses: **accepted** (binds this line), **target** (approved direction, not
> yet implemented). Rejected alternatives stay recorded so they are not relitigated.

## ADR-1.5.5-01 — SSBC ecosystem: rejected as a dependency (accepted)

- **Evaluated:** `ssb-server`, `ssb-db`/`ssb-db2`, `ssb-keys`, `secret-stack`.
- **Evidence:** `ssb-server` last push 2022-06-17; `ssb-db2@8.1.0` published
  2023-11-21 (npm health: "appears abandoned / poorly maintained"); secret-stack
  is Node-only + pull-stream + no TS/ESM; `ssb-db2` is LGPL-3.0-only.
- **Decision:** Do not adopt. Porting our Vite + React 19 + Electron 33 + Bun +
  Hono + SQLite/IndexedDB stack onto an archived Node-only framework means
  forking unmaintained code — the opposite of recovery.
- **Kept:** the *properties* SSB got right are already ours — Ed25519-signed
  author feeds, content-addressed envelope ids, blind relay storing verbatim
  bytes, counts as folds over replicated facts. `docs/P2P.md` maps each.

## ADR-1.5.5-02 — Target framework: js-libp2p (target)

- **Evidence (2026-10):** actively maintained (releases Oct 2026, used in
  Ethereum/IPFS); `webrtc-direct-v2` merged 2026-10-03 with browser↔Node
  interop tested; browser + Node + **Electron-main listen** explicitly
  supported; Noise encryption, PeerId identity, circuit-relay-v2, DHT/peer
  discovery in-tree.
- **Decision:** Pack the mesh onto **js-libp2p** as the transport/identity/
  discovery framework: WebRTC-direct first, circuit-relay-v2 as the *explicit,
  labeled* fallback (never presented as direct), Kademlia/DHT + LAN (mDNS)
  discovery replacing the courier rendezvous.
- **Consequence:** our custom pieces shrink to what libp2p does not provide:
  envelope shapes/validation, gossip apply rules, torrent payload store,
  moderation tombstones, local replica schema. Custom WebRTC dial code,
  presence-mailbox rendezvous, and per-node wss trackers retire as libp2p
  equivalents land.

## ADR-1.5.5-03 — Hyperswarm/Hypercore: rejected for the renderer (accepted)

- Hyperswarm needs Node (native UTP); there is no browser/renderer story, so it
  cannot serve the Vite renderer and would split the stack in two. Rejected;
  revisit only for an Electron-main-only seeder role if libp2p disappoints.

## ADR-1.5.5-04 — Keep the custom stack minimized as the stepping stone (accepted)

- Per Ponytail rung 2 (already in this codebase): the custom
  Ed25519/X25519 + Envelope-v2 + gossip-apply + blind-mail + torrent-seed stack
  is tested and understood. 1.5.5 ships it as triaged (§RECONSTRUCTION).
  libp2p replaces it piece by piece behind the same envelope API — no flag day.

## ADR-1.5.5-05 — Remove the courier, remove the servers (target)

- Direction: **no blind courier, no mandatory servers**. Each install is a peer:
  local identity + local replica + direct transports.
- Ordered removal path (each step independently shippable):
  1. Multi-home the rendezvous (courier + attached full node + LAN) — kills the
     single-host hardcode (`presenceRendezvous` redesign).
  2. Move signaling + presence onto libp2p (DHT/LAN/relay) — courier mail drops
     to legacy-compat.
  3. Move content resolution onto libp2p + torrent DHT — node GET lanes become
     libp2p fetches; node trackers retire.
  4. Delete courier mode, keep-alive workflow, and `SITE_SERVICES` gating once
     nothing dials them (keeping the code would be a second stack to secure).
- Each step must preserve the §ARCHITECTURE operating states; a step that
  regresses Offline or Direct is reverted, not mitigated.

## ADR-1.5.5-06 — Fly.io: optional explicit fallback only (accepted)

- Fly/Render host at most a rendezvous/relay volunteers opt into. The app must
  start, persist, and sync PC↔PC with all hosted infrastructure disabled.
  Relayed traffic is labeled relayed in the UI (`docs/P2P.md` glossary).

## ADR-1.5.5-07 — Minimization policy (accepted)

- One implementation per responsibility; port fixes, not layouts (§RECONSTRUCTION
  §4/§6 duplicates must collapse on port: payload stores, chunk contracts,
  `validateInfohash` twins, register paths, booru barrel, `App.tsx` god-diff).
- No new dependency without a rung-5 justification recorded here first.
- Speculative tunables stay constants with tests; generalization needs a second
  measurement.

## ADR-1.5.5-08 — Slice 1 libp2p dependencies (accepted)

- Added to `apps/desktop` runtime deps (Spike 0 proven, `docs/NET.md` §7):
  `libp2p@^3.3.12` (core), `@libp2p/tcp@^11.0.29` (listen/dial),
  `@libp2p/mdns@^12.0.33` (LAN discovery), `@chainsafe/libp2p-noise@^17.0.0`
  (mandatory encryption), `@chainsafe/libp2p-yamux@^8.0.1` (muxer),
  `@libp2p/ping@^3.1.14` (liveness proof), `@libp2p/crypto@^5.1.24`
  (keypair generate/marshal — v3 PeerIds carry no private key and
  `createLibp2p` wants the key object, so generation + protobuf persistence
  cannot reuse anything in-tree).
- Rung-5 check: no stdlib/native/installed alternative exists for
  Noise-encrypted P2P transports; each package is one responsibility, all from
  the maintained libp2p project. No relay/DHT/gossipsub packages: the slice is
  fail-closed by construction.
