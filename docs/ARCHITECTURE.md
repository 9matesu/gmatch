# gmatch 1.5.5 — Architecture

> **Status:** Authoritative for the `recover/1.5.5-base` line.
> 1.5.5 ships the verified 1.5.3 code + recovery docs; the reconstruction
> backlog (`docs/RECONSTRUCTION.md`) and framework target (`docs/DECISIONS.md`)
> are queued, not claimed done.

## 1. Components and boundaries

```
+------------------+   IPC (preload bridge)   +----------------------+
| Renderer         |<------------------------->| Electron main        |
| Vite + React 19  |  torrentStore/apply,     | sidecar spawn, seeder|
| local replica    |  vault, imgcache, LAN    | WebTorrent, trackers,|
| (IndexedDB)      |  beacon, secure-kv       | LAN beacon, DPAPI    |
+--------+---------+                           +----------+-----------+
         | sealed HTTPS/WSS                               | spawn/env
         v                                                v
+------------------+                          +----------------------+
| Blind courier    |  (target: none)          | Local node sidecar   |
| mail + TURN only |                          | Bun + Hono + SQLite  |
| 404s content     |                          | orbit.sqlite + blobs |
+------------------+                          +----------------------+
         ^                                                ^
         | direct WebRTC mesh (target: libp2p)            | localhost :8790
+--------+---------+                           +----------+-----------+
| Peer installs    |<===== direct PC↔PC =======>| Peer installs        |
+------------------+                           +----------------------+
```

- **Renderer** is sandboxed: never holds keys in clear beyond session use, never
  derives tracker URLs (main re-derives), talks to main over IPC.
- **Electron main** owns: sidecar lifecycle, WebTorrent seeding, AES-GCM image
  cache (`userData/imgcache`), LAN beacon, secure store (`secure-kv.bin`).
- **Sidecar (per-install Bun/Hono/SQLite)** is the local replica authority:
  no central database exists. Snapshot export/import is the handoff.
- **Courier** (Render, `SITE_SERVICES=mail,turn,admin`) routes sealed envelopes
  and TURN; stores nothing readable; 404s content by design. Target: removed
  per ADR-1.5.5-05.

## 2. Operating states (canonical)

- **Offline:** app starts, identity/keys/data persist, local feed/gallery/DM
  history readable, composed messages queue durably. No network required.
- **Direct P2P:** two PCs on a reachable network exchange envelopes + media
  with all hosted infrastructure disabled. Anything else is not called direct.
- **Fallback:** explicit opt-in relay/rendezvous assists connectivity (labeled
  *relayed* in UI). Disabling it must not break Offline or Direct.

## 3. Data flow (envelope path)

Author signs → local apply → local replica → fan-out (direct transport;
courier mailbox for off-mesh in 1.5.5) → receiving node re-validates as if
from the author → applies/parks/forwards (bounded) → counts derived as
`COUNT(*)` folds locally. Media: forge → payload store → seed → infohash
address gossiped → fetch → verify → re-seed (every leecher a seeder).

## 4. Glossary (UI-canonical, one label per concept)

peer, identity (Ed25519), orbit id, delivery token, envelope, gossip,
replica, **direct** (no intermediary) vs **relayed** (a relay carried it),
connection status (transport liveness) vs sync status (replica convergence),
fallback (opt-in assist infra), tombstone (withdrawal/takedown record).
