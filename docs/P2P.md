# gmatch 1.6.x — P2P, do jeito que funciona

> **Status:** current. This is the readable map of the P2P system as shipped in
> 1.6.x. The deep protocol spec is `docs/ARCHITECTURE-P2P.md`; where the two
> disagree, the code wins and this file is the bug.
>
> **What this app is NOT:** there is no hosted data server, no central
> account, no DHT, no libp2p, no BitTorrent tracker, no TURN. Everything below
> runs on the install's own node plus a blind rendezvous on Cloudflare Pages.

---

## 1. The rule: provenance, not reachability

Every packaged install hosts its **own node** (bundled Bun sidecar on
`127.0.0.1:8790`) and that node is the default. A second world is never
dialed because it merely answers: a saved server is judged by **where the
pointer came from** (`apps/desktop/electron/server-mode-core.cjs`).

| stored pointer | on launch | what the UI says |
|---|---|---|
| no `v` (written before 1.6.5) | never dialed; stays paused, `pausedReason: 'legacy'` | "saved node predates this app" |
| `v: 2` | one bounded `/api/health` probe (2.5 s) | silence → paused, `pausedReason: 'unreachable'` |
| mode `host` (default) | bundled sidecar boots | normal |

Either way the app prefers hosting locally and surfaces the reason in
Settings → Server instead of pretending to be connected.

## 2. Identity and crypto

- One Ed25519 identity per install; `orbitId = sha256(publicKeyHex)`. Every
  envelope body is author-signed, and `author_id` must equal the hash of the
  enclosed key — a valid key cannot sign under someone else's id.
- A separate X25519 keypair encrypts 1-to-1 payloads (ECIES → XChaCha20-
  Poly1305). Keys live in the DPAPI-protected secure store (`secure-kv.bin`),
  never uploaded.
- Delivery tokens are `blake3(recipient public key)` (64 hex). The courier
  routes by token and can open nothing.

## 3. Discovery (who is online, where)

1. **Presence beacon.** Every 60 s an active peer posts a signed `announce`
   envelope to a well-known public mailbox token
   (`sha256Hex('orbit-global-presence-v1')`). The signed payload includes the
   **node URL** the peer is connected to (`presence-v1|orbitId|pubkey|ts|node`),
   so a relay that rewrites the address breaks the signature and the beacon is
   dropped.
2. **Roster.** Clients read that token on their node and on the nodes the
   directory lists; beacons are dropped unless fresh (≤120 s, not >30 s in the
   future), correctly signed, and `sha256(pubkey) === orbitId`.
3. **Node directory.** A node in host mode re-registers itself every 15 min
   (`useServerHeartbeat` → `POST <directory>/api/servers`) with name,
   description, a LAN endpoint hint and optional counts. Rows go stale after
   24 h. `GET https://gmatch.pages.dev/api/servers` returning `{"servers": []}`
   is honest and normal: it means nobody is hosting a registered node right
   now, not that discovery is broken.
4. **Peer-node hints.** `utils/peerNodes.ts` keeps a bounded localStorage hint
   (peer id → node URL) fed by beacons and the directory. Losing it costs one
   rediscovery, never a message.

## 4. Signaling (how two peers start talking)

There is no `/api/signal/*` route. Connection setup is three sealed envelope
kinds dropped into the peer's mailbox:

| payload | content |
|---|---|
| `offer` | session id, sender orbit id / pubkey / encryption pubkey, SDP |
| `answer` | same shape, answering SDP |
| `ice` | session id, one candidate |

ICE candidates are buffered until the remote description exists and deduped;
private LAN candidates are stripped before dispatch so the courier never sees
an internal address. The Cloudflare courier has no WebSocket, so `MailClient`
polls it (~20 s); a full node offers `/api/mail/ws` and pushes.

## 5. Transport: one mesh, two lanes

The production transport is a **WebRTC DataChannel mesh** (`gmatch-mesh`),
not libp2p. Each peer has a phase in `utils/transportState.ts`:

| phase | meaning |
|---|---|
| `idle` | no attempt yet |
| `connecting-direct` | direct dial in flight; relay session alive meanwhile |
| `direct` | **validated**: the DataChannel opened (the only promotion path) |
| `relay` | direct failed or its 12 s deadline expired; frames ride the node |
| `failed` | no path at all; UI says `sem rota` |

Rules: promotion requires an open DataChannel; retries back off 1.5 s →
30 s (±25 % jitter); a validated direct path is never demoted. The chat
roster labels the truth: `P2P direto`, `relay via nó (NAT)`, `sem rota`.

The relay lane (`SWARM_FRAME` over the node's socket) is the guaranteed
fallback: it works when a direct hole cannot be punched, at the cost of the
node's latency plus metadata visibility (who wants which object id — never
the media, see §6).

## 6. Media: swarm-v1, sealed end to end

- Objects are content-addressed by SHA-256 and transferred in 4 KiB chunks
  (`SWARM_CHUNK`, capped at 64 MiB per object).
- The **fetcher** generates an ephemeral X25519 key per transfer and puts the
  public half in `SWARM_WANT.offerPub`. The **seeder** seals a fresh data key
  to it (`SWARM_KEY`); the seeder cannot read the key it hands out.
- Every chunk is XChaCha20-Poly1305 ciphertext with a fresh nonce; AAD binds
  version, object id, chunk index/total, transfer id, sender and fetcher key,
  so replay, reorder or re-aim fails. The receiver verifies AEAD **before**
  hashing, then verifies SHA-256 against the object id before persisting.
- Multi-seeder races are bounded (≤4 candidate keys); bad chunks are dropped
  and counted. Duplicate delivery is an idempotent no-op.
- Objects persist to IndexedDB (`orbit-gallery`) and are re-hydrated on boot
  (`hydrateLocalObjects`), so every peer that holds bytes seeds them. RAM
  cache is an LRU (64 objects / 96 MB).
- `SWARM_HAVE` advertises ≤64 held ids after boot and on peer-online, at most
  once per 10 s; receivers ask only for ids they already want (≤3 concurrent).
- **Replication receipts** (signed, challenge-bound, capped 256) are the
  level-4 evidence ("peer-confirmed durable") and survive restarts.

Missing bytes never fake it: a tile whose seeder is offline renders the
offline SVG placeholder and retries when a peer comes back.

## 7. Messages, rooms, groups (all over mailboxes)

There is no `/api/pm`. A DM is an ordinary sealed envelope distinguished by
the decrypted body kind (`utils/mail-dm.ts`):

| kind | rule |
|---|---|
| `dm` | signed, sealed to the recipient's encryption key |
| `dm_ack` | flips the sender's row to `delivered` |
| `dm_read` | read watermark; only applies when `readTs >= msg.ts` |
| `dm_edit` / `dm_del` | author-only; last-write-wins / tombstone (replay cannot resurrect) |
| `dm_react` | aggregated per actor |
| `dm_typing` | transient, never persisted, throttled 3 s, fresh 8 s |

A group is a sealed room: `group_<id>` is derived locally (no lookup), the DEK
travels only inside the signed 1:1 invite, and each message is group-sealed
once and ECIES-copied to every member's mailbox. The node relays ciphertext it
cannot open. Unread state is derived from the local store (the store is the
only source of truth), identity-scoped, and a read receipt requires a real
user action.

## 8. Social operations and profiles

Posts, likes, comments, follows, reports, `profile.update` and
`post.delete` are signed operations replicated over the mesh. Profile merges
are deterministic and clock-free: per actor, fold accepted `profile.update`
entries in `actorSequence` order (omitted field = unchanged, empty string =
explicit clear). A deletion is a tombstone that also purges the bytes the
replica holds — but a replica can only purge what it has and only after it
hears the tombstone. Deletion is a request, not remote control.

## 9. Durability levels (never conflated)

1. **Local** — row + bytes on this machine (IndexedDB/vault; post outbox
   commits before any network call). The only level guaranteed with no peers.
2. **Direct P2P** — a connected peer received the bytes; not proof of their
   durability, not universal.
3. **Courier rendezvous** — sealed envelopes move between nodes; the courier
   stores no content and is never the authority.
4. **Multi-peer replication** — bytes verified (SHA-256) on ≥1 other durable
   store, with a signed receipt.

## 10. Honest boundaries

- **Symmetric NAT without a reachable node** cannot be traversed. STUN covers
  most home NATs; the relay lane saves the session only if some node is
  reachable. The cross-NAT runbook (`apps/desktop/nat-lab/README.md`) is not
  executed in this environment.
- **The relay lane** costs latency and lets the node see object ids and sizes
  (never media, never DM/room plaintext).
- **The directory can be empty.** Registration is host-mode only and prunes in
  24 h; an empty list is a fact, not an error.
- **The courier is not durable storage.** A message to an offline peer with no
  seeder is not kept forever and the app does not claim otherwise.
- **Server mode is local-first by design**; a saved node that predates 1.6.5
  is paused instead of dialed, and the UI says why.

## 11. Executed evidence (not claims)

| check | result |
|---|---|
| `node scripts/p2p-two-process.mjs` (two real OS processes, untrusted relay) | PASS: 48 KiB byte-identical; one flipped byte → AEAD failure, nothing persisted; no plaintext media slice in any relayed frame |
| `npm run test` | desktop 263 files / 1990 tests, API 102 files / 994 tests (1.6.5 gate) |
| standalone `electron/*.test.cjs` | 21/21 PASS |
| `node site/check.mjs` | OK |
| live courier | `GET https://gmatch.pages.dev/api/health` → `{"mode":"courier","services":["mail","directory"]}`; stateful routes 404 |
| live manifest | `GET https://gmatch.pages.dev/release.json` → 1.6.5 + sha256 of the CI asset |

What is **not** proven here: real cross-internet NAT traversal between two
networks. Same-machine processes exercise the protocol and the sealing, not
the internet.

## 12. Retired designs

- **libp2p / mDNS / DHT slice** (ADR-1.5.5-02, ADR-1.5.5-08): landed in
  `electron/p2p-*.mjs`, never wired to a renderer path, and unshippable —
  packaged builds exclude `node_modules`. Removed 2026-10-28
  (ADR-2026-10-28-01). `docs/NET.md` is kept as history.
- **BitTorrent trackers, TURN relay, central signaling, `/api/pm`**: retired;
  no route and no client path remains.
