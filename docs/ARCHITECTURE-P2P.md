# gmatch P2P / Swarm Architecture Specification

> **Status:** Authoritative (v1.5.0+)  
> **Core Principle:** Blind Courier Routing + Zero-Knowledge WebRTC Mesh + Local-First Swarm Seeding.

---

## 1. System Overview

Since 2026-10-21 there is **no central deployment at all**. Both hostings
(`gmatch-wcz1.onrender.com` and `gmatch.fly.dev`) were decommissioned — the
accounts cannot be paid for — and every packaged copy of the app runs **its own
node** (host mode is the default). A node is still a *blind, stateless courier*
for its own clients: it holds no user profiles, no presence, no posts, no feeds
and no media objects. It only moves sealed envelopes and relays swarm frames.

The courier role moved from "one central host" to "the node each client is
connected to":

```
        +-------------------------+            +-------------------------+
        |      Node A (you)       |            |      Node B (friend)    |
        |  bundled Bun, :8790     |            |  bundled Bun, :8790     |
        |  blind courier for its  |            |  blind courier for its  |
        |  own clients            |            |  own clients            |
        +-------------------------+            +-------------------------+
             ^          |                             ^          |
   sealed mail |        | presence beacon              |        | presence beacon
   (opaque)    |        | (signed, names the node)     |        |
                +------------ WebRTC mesh ----------------+
                (direct: media chunks, signed operations)
```

Two clients on the SAME node find each other through that node (it relays the
presence beacons and the swarm frames) and then talk **directly** over WebRTC.
Two clients on DIFFERENT nodes meet through the directory: a beacon names the
node a peer lives on, so the sealed envelope is dropped straight into that
node's mailbox — the node still cannot open it.

### Core Architecture Pillars

1. **Blind Courier Relay (`/api/mail/:token` & `/api/mail/ws`):**
   - The courier only handles sealed binary envelopes (`Envelope v2`) addressed by 64-hex BLAKE3 delivery tokens.
   - The courier learns nothing about the sender's identity, the message body, or the routing kind.
   - Deliberately returns `404 Not Found` for legacy central endpoints: `/api/users/online`, `/api/posts`, `/api/objects`, and `/api/signal/*`.

2. **Ephemeral Presence Discovery:**
   - Peers discover each other by broadcasting signed presence beacons to a shared public presence mailbox token (`sha256Hex('orbit-global-presence-v1')`).
   - The courier stores no roster database. Beacons have a 60-second TTL. Clients query the mailbox or watch it via WebSocket, maintaining an in-memory roster of currently active peers.

3. **Courier-Routed WebRTC Signaling:**
   - Peer connection setup (SDP Offers, SDP Answers, ICE Candidates) is routed via sealed 1-to-1 envelopes over the blind courier (`/api/mail/:token`).
   - Envelopes are encrypted using X25519 ECIES under the recipient's encryption public key. Even the signaling negotiation is completely zero-knowledge to the courier.

4. **WebRTC DataChannel Mesh & Chunked Swarm:**
   - Direct peer-to-peer data channels (`gmatch-mesh`) transmit social feeds, chats, and image/video media.
- Large media files are divided into 5 KiB chunks and distributed via `SWARM_WANT` and `SWARM_CHUNK` protocols.
- Every node that downloads or creates media persists it to local IndexedDB and acts as a seeder (`hydrateLocalObjects`).
- Swarm frames enforce chunk metadata/length bounds and a 64 MiB object ceiling. A fetched object is only reported as received after local persistence succeeds; session RAM caching alone is not durability evidence. Pending retry state is bounded and validates object IDs and SHA-256 hashes. Duplicate chunk re-delivery (relay/transport replay) is an idempotent no-op, never a fetch failure; every other malformed frame still aborts the transfer without storing bytes.

---

## 2. Presence & Discovery Protocol

### Global Presence Token

Peers derive the shared public presence mailbox token via a deterministic SHA-256 hash:

```typescript
const PRESENCE_TOKEN = sha256Hex('orbit-global-presence-v1')
```

### Presence Beacon Structure

Every 60 seconds (or immediately upon returning to foreground), an active peer generates and signs an announcement beacon:

```typescript
export interface PresenceBeacon {
  orbitId: string             // SHA-256 of Ed25519 public key
  publicKeyHex: string        // Ed25519 public key
  encryptionPubHex: string    // X25519 encryption public key
  displayName: string         // User's configured handle
  pfpUrl?: string             // Avatar URL or local object ID
  timestamp: number           // Current Unix epoch ms
  sig: string                 // Ed25519 signature over canonical beacon data
}
```

### Wire Transmission

The beacon is packed into an `announce` envelope and posted to the courier:

```http
PUT /api/mail/e5f3c1a... (PRESENCE_TOKEN)
Content-Type: application/json

{
  "env": {
    "v": 2,
    "kind": "announce",
    "to": "e5f3c1a...",
    "id": "e4a7b9c1d2e3f4a5",
    "sealed": "<base64 encoded inner beacon>",
    "exp": 1727180400000
  }
}
```

### Roster Compilation & Verification

Peers retrieve active beacons via `GET /api/mail/:PRESENCE_TOKEN` or listen in real-time via `wss://.../api/mail/ws`.
Upon receipt:
1. **Freshness Verification:** Drops any beacon where `Date.now() - beacon.timestamp > 120_000` ms (or in the future by > 30s).
2. **Signature Verification:** Verifies `beacon.sig` against `beacon.publicKeyHex`.
3. **Orbit ID Verification:** Ensures `sha256Hex(beacon.publicKeyHex) === beacon.orbitId`.
4. **Roster Synthesis:** Compiles the live peer list without any server-side database.

---

## 3. WebRTC Signaling Protocol

Legacy centralized signaling via `/api/signal/*` is deprecated on the blind courier. Signaling now occurs over E2E-encrypted mailboxes.

### Envelope Routing

1. Peer A determines Peer B's delivery token:
   $$\text{token} = \text{blake3}(\text{Peer B's Ed25519 Public Key})$$
2. Peer A seals the SDP Offer or ICE candidate using Peer B's X25519 `encryptionPubHex`:
   ```typescript
   seal1to1(payload, 'signal', senderKeys, recipientKeys, { to: token, exp: Date.now() + 60_000 })
   ```
3. Peer A sends the sealed envelope:
   ```http
   PUT /api/mail/<Peer B Token>
   ```
4. Peer B (watching its token on `/api/mail/ws`) receives the notification, fetches the envelope, decrypts the payload with its private X25519 key, and responds with an SDP Answer via Peer A's delivery token.

### Signaling Payload Formats

```typescript
type CourierSignalPayload =
  | {
      type: 'offer'
      sessionId: string
      fromOrbitId: string
      fromPubKeyHex: string
      fromEncPubHex: string
      sdp: RTCSessionDescriptionInit
    }
  | {
      type: 'answer'
      sessionId: string
      fromOrbitId: string
      fromPubKeyHex: string
      fromEncPubHex: string
      sdp: RTCSessionDescriptionInit
    }
  | {
      type: 'ice'
      sessionId: string
      fromOrbitId: string
      candidate: RTCIceCandidateInit
    }
```

### NAT Traversal & ICE Hygiene

- Peer connections configure STUN and TURN relays provided by the environment (`defaultIceConfig(readTurnEnv())`).
- Private LAN IP candidates are stripped/sanitized before dispatch over the courier (`sanitizeCandidate`) to prevent internal network leakage.

### Direct messages ride the same sealed path (no DM route)

There is no direct-message route. `/api/pm` is retired and 404s on every node —
its client-side edit/delete/report calls used to fail silently. Chat DMs are
ordinary sealed envelopes on the blind courier, distinguished only by the
decrypted body kind (`utils/mail-dm.ts`, one decoder):

| kind | meaning | auth/rule |
|---|---|---|
| `dm` | message (text + optional attachment id) | signed, sealed to the recipient's `encryptionPubHex` |
| `dm_ack` | delivery acknowledgement | flips the sender's row to `delivered` |
| `dm_read` | read watermark (`ts`) | flips to `Seen` only when `readTs >= msg.ts`, view-gated on the reader's side |
| `dm_edit` | correction | author-only, last-write-wins on `ts` |
| `dm_del` | delete-for-everyone | leaves a local tombstone; a replay cannot resurrect it |
| `dm_react` | emoji reaction | aggregated per actor; attributed to the thread peer |
| `dm_typing` | transient ping | never persisted; throttled 3s, fresh for 8s |

Unknown kinds are ignored by older clients (the body fails to decode), so the
courier needed no change and the store is still the only source of history.

**Drain correctness.** A notice is emitted only after the envelope is written,
so a box listing that was already running cannot contain it. `MailClient.pull()`
coalesces concurrent drains and queues one further pass whenever a notice
arrives mid-drain; absorbing it (the previous behaviour) left a message on the
courier until something unrelated pulled. The watch socket is built by
`wsUrlForBase` (`utils/api.ts`) so a relative API base (browser dev, riding the
Vite proxy) resolves to the page origin instead of the invalid `ws:///api/mail/ws`.

### The release feed travels between peers (2026-10-22)

The central release hosts are decommissioned with the rest, so the update
feed cannot be a website any more. A NODE serves it instead:

| route | what |
|---|---|
| `GET /release.json` | `{ file, version, sha256, sizeBytes }` — the manifest |
| `GET /releases/<file>` | the portable build |

The directory is `userData/releases` on a packaged install (empty by
default). `npm run dist` ends with `stage:release`, which copies the built
exe there and writes the manifest — so the builder's own node serves the new
build to everyone who joined it. The updater asks, in order: the node this
install is connected to, the node on this machine, then the old central hosts
(skipped when they are down). The manifest's sha256 is what makes the
download safe: the updater verifies it and discards a mismatch, and a plain
http feed is accepted only for a host on the user's own network (loopback or
a private LAN address) — never for a public one.

### Group chat is a sealed room (2026-10-22)

The node owns the GROUP; the ROOM carries the words. A group maps to a room
whose id is derived from the group id (`group_<id>`), so every member
computes the same room without a directory lookup. The DEK is the secret and
cannot be derived: it is created once and shipped inside the sealed 1:1
invite. Two members may open the group before they meet — the first room
wins the DEK and a later invite merges the membership instead of replacing
it (an equal epoch never replaces; a higher epoch — a leave — does).

Every message is group-sealed once and then ECIES-copied to each member's
mailbox, so the node relays ciphertext it cannot open. The node's own group
rows stay as the history from before the room existed; the two lists are
merged by id and ordered by time.

### A peer on another node (2026-10-21)

The courier is the node a client is connected to — there is no central one any
more. A peer that lives on a DIFFERENT node is still reachable, because:

- the presence beacon carries the **node URL** the peer is connected to, and
  the URL is inside the signed payload (`presence-v1|orbitId|pubkey|ts|node`).
  A relay that rewrites the address breaks the signature, so the beacon is
  dropped instead of being redirected. A beacon from a client that does not
  know the field still verifies against the old payload.
- the presence token is a well-known public constant, so a client can read the
  presence mailbox of any node it knows (ours, plus the nodes the directory
  lists). That is how a peer on another node enters the roster.
- the sealed envelope is then dropped into **that** node's mailbox
  (`MailClient.send(..., { base })`), not into ours. The ciphertext is
  identical either way: the node moves bytes it cannot open.

The registry (`utils/peerNodes.ts`) is a bounded localStorage hint: peer id →
node URL, plus the set of known nodes. It is fed by beacons and by the
directory (`/api/servers`), and it is a hint, never authority — losing it
costs one rediscovery, not a message.

**What this does not buy:** two peers whose nodes are both unreachable from
the public internet (behind a NAT with no port forward) still cannot meet.
Either node must be reachable, or a third node must relay for them. STUN
covers most home NATs; a symmetric NAT without a reachable node does not.

### What the relay fallback costs (the honest price of a blocked direct path)

When the direct WebRTC channel cannot be established, the swarm falls back to
the node's WebSocket relay (`SWARM_FRAME`), which is the guaranteed path: the
data still flows, through the node the user chose. Two things differ from the
direct path, and both are worth stating plainly:

- **The media is not end-to-end encrypted on that path.** The direct
  DataChannel is DTLS-encrypted between the two peers; the relay fallback
  carries the same chunk frames over the node's socket, so the node sees the
  bytes it forwards (the chunks are hash-verified, not sealed). DMs and room
  messages are unaffected: they are sealed envelopes the node cannot open.
- **The latency is the node's, not the peers'.**

So the direct path is not a nicety: it is what keeps the media private from
the node. A blocked direct path is a privacy downgrade, not just a slow
one. Closing that gap means encrypting the chunk stream itself (a session key
derived from the two peers), which is still open (L2).

**Node-hosted lanes are probed, not assumed.** `detectMailMode` reports "courier"
for both a full node and the blind courier, so it cannot gate gameplay. The UI
probes an unauthenticated `GET /api/lobby/invites`: 404 means the node does not
host stateful routes, and lobby/queue/group chat and game invites say so instead
of failing as 404s. Courier DMs and sealed rooms never touch the node and are
exempt.

### Persistence, unread state and the notification centre (2026-10-18)

The blind courier stores no per-user state, so **the message store is the only
source of truth** and everything the UI shows about unread messages is derived
from it:

- Threads and rooms are durable locally (DPAPI-scoped per identity). Message
  identity is the envelope id, so a replayed envelope, a retry, or an
  out-of-order arrival cannot duplicate or reorder a row.
- Read state (`dmSeen`/`roomSeen`, last-conversation pointer) is **identity
  scoped** (`utils/scopedSeen.ts`); it used to be plain localStorage, so a
  second identity inherited the first one's stamps. A one-time migration keeps
  existing read state.
- The unread badge in the chat view and the DM/room rows in the header
  notification centre are computed from the **same** stamps
  (`countThreadUnread` / `countMentions`) at render time — there is no second
  counter to drift, and a delivered-but-unread message is never reported as
  read.
- A read receipt is emitted only by a real user action: opening the
  conversation (view-gated on document visibility) or tapping its notification
  row. Neither the message loader nor expanding the notification centre marks
  anything read.
- If the control socket drops, frames pushed meanwhile were never received.
  `orbitWebSocket` emits `__ws_reconnected` and `useLobby` answers with **one**
  forced read of the lobby + notification/invite lists — a catch-up, not a
  polling loop.

The courier's store is not durable for a recipient that is offline with nobody
seeding to it: no relay keeps a DM for later, and the app does not claim
otherwise. Server-side engagement rows (`Notifications`) are a separate,
node-hosted system that does survive an offline client — the two are merged for
display only (SPEC §15) and never written into each other.

---

## 4. P2P Swarm & Content Sharing Protocol

### Swarm Framing

Media and posts are exchanged over the established WebRTC DataChannel (`gmatch-mesh`) using chunked frames:

```typescript
type SwarmMessage =
  | { type: 'SWARM_HAVE'; ids: string[] }
  | { type: 'SWARM_WANT'; id: string }
  | {
      type: 'SWARM_CHUNK'
      id: string
      index: number
      total: number
      mimeType: string
      dataBase64: string
    }
```

### Chunking Mechanics

- **Chunk Size:** 5 KiB (`5 * 1024` bytes) per chunk. The smaller size keeps the base64 JSON frame under the relay's frame-splitting threshold (`MAX_SWARM_FRAME_BYTES` = 8 KiB); the "64 KB" figure in earlier versions of this document was stale.
- **Request Cycle:** When a peer sees an image announcement or post referencing `objectId`, it broadcasts `SWARM_WANT` with the ID across:
  1. Active WebRTC mesh data channels (`broadcastMeshFrame`).
  2. Local tab cross-process `BroadcastChannel('orbit_p2p_swarm')`.
  3. The node's WS relay, wrapped as `{ type: 'SWARM_FRAME', swarm }` — the
     guaranteed fallback when no direct channel exists.
- **Response Cycle:** Any peer holding the object slices the binary buffer into 5 KiB chunks and sends sequential `SWARM_CHUNK` frames (4 MiB = 820 frames).
- **Reassembly:** The requesting peer tracks received chunk indices in memory. Once all chunks are present, it assembles the final `Blob`, verifies the SHA-256 digest against `objectId`, and commits it to local IndexedDB.

### SWARM_HAVE: advertise, don't broadcast the world (2026-10-19)

`SWARM_HAVE` used to be a no-op on receipt, so a peer that failed a fetch had
no way to learn that someone nearby held the bytes. It is now a deliberate
two-sided protocol:

- **Sending.** `announceHeldObjects()` advertises at most `SWARM_HAVE_LIMIT`
  (64) ids this session holds, most recent first. It fires after boot hydration
  and on `PEER_ONLINE_EVENT`, throttled to one advertisement per 10s so a
  flapping roster cannot become a HAVE storm.
- **Receiving.** A HAVE is an advertisement, not a mandate: the receiver asks
  only for ids it *already wants* (`wantSwarmObject`, populated by fetches that
  timed out and by tiles asking to be retried) and never for one it holds or
  has in flight. The wave is capped at 3 concurrent `SWARM_WANT`s and every
  request keeps its own timeout, so one slow id neither blocks the others nor
  fails them: each settles independently, and a failure stays *wanted* for the
  next advertisement instead of being forgotten.

Nothing is downloaded speculatively, so a peer advertising its whole library
costs a handful of round trips, not a library transfer.

### A descriptor is not bytes (2026-10-19)

An announcement carries an object's **provider link**, not its content. Older
builds encoded that link into the object's `data` field, so IndexedDB held a
row claiming to be media bytes while actually holding the URL text. Everything
downstream then treated the row as media: a blob URL of the URL string, a hash
that could never match the object id, a tile stuck on "Loading media…".

- **On write** (`utils/objectDescriptor.ts`, used by both the announce and the
  receive path of `useP2P`): the link is stored as `source_url`, `data` stays
  empty, and **real bytes are never overwritten by the link that points at
  them** — publishing or receiving an announcement for an object already held
  on disk leaves those bytes alone.
- **On read** (`App` gallery rebuild, `recoverDescriptorRow`): a row whose
  `data` decodes to a single short http(s)/`gmcache://`/`/api/objects/` URL is
  recognised as a descriptor. Detection is strict UTF-8 over a ≤4KB payload
  that must be exactly one URL, so real media can never be mistaken for a link.
  The recovery is **idempotent and non-destructive**: the row keeps its id and
  bytes, gains the `source_url` it was already carrying, and never
  re-imports. The gallery then renders it from that link instead of minting a
  blob of URL text.
- **Flags** are normalised by one function (`mediaFlag`: `1` / `0` / `null`).
  The two write paths used to drift — one mapped explicit `false` to `0`, the
  other wrote `null`, losing "explicitly private" — and an unknown flag is
  always `null`, never a guess.

### Who owns a relayed object (2026-10-19)

The relay socket proves its own sender at auth (a ticket), but the payload's
`user.id` and `owner_id` are just client-supplied text. So:

- The node stamps `relayedBy` with the authenticated identity on every
  client-to-client frame it forwards. A bare frame with a `type` key is still
  dropped (audit A2: a forged `feed`/`user_banned` must never shadow a
  server-published event) — only the explicit client-to-client allowlist
  relays, and always inside the `SWARM_FRAME` envelope.
- A receiver verifies the claim with `resolveClaimedOwner`: an `owner_id` equal
  to the proven sender is verified, an unattributed object belongs to the
  sender, and a claim that contradicts the sender is stored
  `owner_verified: false` and may never borrow that user's directory name or
  avatar. Relaying for someone else stays possible and visible; impersonating
  them does not.

### Local-First Seeding Lifecycle

1. **Upload/Creation:** When a user creates a post or story, the binary payload is forged locally (`forgeMediaLocally`) and stored directly in IndexedDB.
2. **Rehydration on Boot:** When the desktop app launches, `hydrateLocalObjects()` scans IndexedDB and mounts stored objects into the in-memory seeder index (`localObjects`).
3. **Zero Server Upload:** Media binaries are never uploaded to the courier. The courier only routes encrypted metadata. Content availability relies entirely on the peer swarm.

### Story tray warm-up (2026-09-25)

Browsing the feed should not pay a cold fetch per story. Three client-side
pieces, no protocol change:

- `useObjectImage` dedupes concurrent resolutions of the same object id
  (`inflight` map keyed like the LRU), so a feed tile and the story player can
  ask for the same object without racing — the loser previously orphaned a
  blob URL into leaked RAM.
- `prefetchObject(id, identity)` runs the same resolution path and populates
  the LRU, so a warm object costs nothing extra when it renders. The shell
  warms the leading stories (`STORY_PREFETCH_COUNT`, concurrency 3) whenever
  the list changes and the window is visible.
- The tray renders the localStorage boot mirror while the network revalidates
  (stale-first), instead of blanking itself for the whole first fetch.

### Bounded swarm RAM cache (2026-10-17)

`localObjects` in `utils/p2pSwarm.ts` — the in-heap copy of swarm bytes — is now
an LRU bounded to 64 objects / 96MB (a read refreshes recency). It used to be an
unbounded `Map`, so every object the app had ever seen stayed resident: the
"memory usage" symptom. Nothing durable is affected — bytes live in the vault
(disk) or IndexedDB, so an eviction costs one re-read — and boot hydration
(`hydrateLocalObjects`) fills to the same budget instead of 256MB.

---

## 5. Honest Boundaries & Fallback Behavior

| Feature | Courier (Render) | Peer Node (Client) |
| :--- | :--- | :--- |
| **User Accounts / Passwords** | None (Zero knowledge) | Self-generated Ed25519/X25519 Identity in local DPAPI / localStorage |
| **Media / Content Storage** | 404 (None stored) | Stored in local IndexedDB; seeded over WebRTC DataChannel |
| **Online Roster** | 404 (No server DB table) | In-memory roster synthesized from ephemeral 60s beacons |
| **Direct Messages** | Sealed 1-to-1 envelopes | Decrypted locally with private key; saved in local storage |
| **Network Relaying** | Blinds forwarding + TURN | Direct P2P transmission |

### Offline & Degraded Network Handling

- If no seeders are online for a requested media object, the client does not crash or hang: it renders an offline SVG placeholder indicating the media is currently dormant until a seeder comes online.
- When an offline peer returns, `announcePeerOnline` is triggered, causing failed tiles to re-issue `SWARM_WANT` requests.

### Watch-party rooms are persistent (2026-09-25)

A room outlives everyone in it, by design: `removeMember` never deletes, and
`serializeParties` writes name, media, queue, `current`, frame **and chat** to
`watchparties.json` every 30s (plus on SIGTERM). The *client* used to be the
weak link — a module-level store with no persistence, so a reload or a leave
forgot the room, and a **private** room you had left was unreachable because
the public listing hides private rooms.

- The client remembers joined room ids (`gmatch_watchparties_v1`, ids + name +
  last media URL only — never chat text) and re-joins on boot through the
  existing `GET /api/watchparty/:id`, whose snapshot carries the authoritative
  media, queue, position and chat. A `404` means the room really ended and the
  entry is forgotten; a network error keeps it for the next boot.
- Browse mode lists those remembered rooms as "Recently watched", which is the
  only way back into a private room you are not currently in.
- Because rooms are immortal, the server cap (`MAX_PARTIES`, 25) is the only
  reclaim path, and it now evicts **oldest-created-first** so a long-lived room
  you use daily is not the first casualty. A room with nobody in it stops
  holding its media blob after `EMPTY_MEDIA_LEASE_MS` (6h) - the room survives,
  the bytes do not.

#### Leaving is not closing (2026-10-17)

Two different acts, two different code paths:

- **Leave** (`leaveParty` → `watch.leave` → `removeMember`) is participant-only.
  The room, its queue, its chat and its remembered id all survive; the client
  keeps the id precisely because that is the only route back into a *private*
  room.
- **Close** (`disbandParty` → `watch.disband` → `disbandWatch`) is authorized:
  the server requires `party.hostId === userId` and the room is dropped for
  everyone (`watch.gone`).

The emptied-room branch of `removeMember` used to return before touching the
host seat, so a host who left a room as its last member kept `controlsParty()`
forever: the next person in (the room is still open) could not play, pause, seek
or advance anything, which reads as "leaving closed the room". It now stamps
`hostLeftAt` like the non-empty branch, so the crown is released after
`HOST_SEAT_GRACE_MS` (8s) and the first member to join controls the room. There
is **no automatic ownership transfer** beyond that first-member promotion: a
room whose owner has gone is a room anyone can take over, and that limitation is
documented rather than papered over.

#### Shared local media: transfer first, then play (2026-10-17)

A consent-shared file never has a local path or blob URL in the queue — the
entry carries `/api/objects/<id>` (register-only row) plus `hash`, and peers
retrieve the bytes over the swarm.

- **The player now starts that retrieval.** `useObjectImage`'s swarm window is
  5s (right for a clip, hopeless for a movie) and nothing else triggered a
  fetch, so a peer's viewport sat black while the bytes were one request away.
  When the entry about to play is a shared local file, `WatchPartySlot` starts
  `useLocalEntryTransfer` (integrity-checked, cancellable, progress) and shows
  the reason — waiting / receiving N% / failed with a retry — instead of a dead
  player. A verified transfer re-issues the `PEER_ONLINE_EVENT` retry wave so
  the already-failed tile re-resolves.
- **Posters are generated and distributed.** `makeVideoPoster` grabs a frame
  (~1s in, ≤1280px JPEG) at share time; it is forged as an ordinary swarm object
  and queued as `thumb`. The server whitelists only `/api/objects/…` or plain
  http(s) there — a sender's local path is dropped, the entry still plays — and
  peers resolve the poster over the same swarm path (`NativeVideoPlayer`
  `poster`). Generation is best-effort: no canvas/decode ⇒ no poster, never a
  failed share.
- **Quality is honest.** The watch path does not transcode: the server streams
  the stored bytes (or relays the upstream URL) and the only bitrate logic picks
  the *highest* variant of an upstream post. There is no rendition ladder to
  fall back to, and none is claimed.

---

## 6. Durability & replication levels (2026-10-15, data-integrity milestone)

Four distinct outcomes, never conflated in the UI or in claims:

1. **Local durability** � the post (an `Objects` row) and its media bytes live
   on this machine. Media: IndexedDB `orbit-gallery` seed (survives restart) +
   optional `media-vault/`; metadata: a localStorage publish outbox
   (`gmatch_post_outbox_v1`) commits locally *before* any network call, so a
   server timeout never loses the post during normal operation (localStorage
   quota/write failures are best-effort and not transactional). Swarm retry
   records are bounded localStorage hints, not a durable operation log.
   Replication state is shown as
   `local` ? `pending` ? `replicated` on the optimistic tile. This is the only
   level the app guarantees without any peer or server.
2. **Direct peer-to-peer delivery** � another *connected* peer received the
   bytes over the WebRTC/BroadcastChannel swarm. Not proof of durability on
   their side; not universal. A disconnected peer cannot receive until it
   reconnects.
3. **Hosted rendezvous / courier** � the blind courier carries sealed
   envelopes and metadata (mail, gossip relay) but stores no content. It is
   never the authority for locally persisted content; it makes delivery
   *possible* between nodes, not *durable*.
4. **Multi-peer replication** � the object has been verified present on =1
   other node's durable store. Bytes are only accepted after SHA-256
   verification against the object's `content_hash` (`sha256HexBlob` in
   `utils/p2pSwarm.ts`); a peer's chunk stream or URL is never proof.

Public gossip envelopes also require author identity binding: `author_id` must
equal SHA-256 of the enclosed Ed25519 public key, both when a relay accepts an
envelope and when a host applies a pulled one. This prevents a valid key from
signing posts under an unrelated account ID; it does not prove media availability.

Experimental (protocol proposal v1): level-4 evidence now exists as signed
replication receipts. A serving peer mints a fresh challenge per served
content-addressed object (`SWARM_CHALLENGE`), and the fetching peer — after
verifying, persisting, and reading back the bytes from its durable store —
returns a SIGNED receipt bound to that challenge (`SWARM_RECEIPT`,
`createSwarmReceiptRoles` in `utils/p2pSwarm.ts`). Only a receipt matching
the seeder's outstanding challenge counts (`getDurableReplication`);
tampered, stale-challenge, unsolicited, or un-attested transfers (failed
read-back, no signing identity) never do. Accepted receipts persist to
IndexedDB (`orbit-gallery`/`swarm_receipts`, capped at 256) and are
re-validated and reloaded on boot (`hydrateDurableReplications`), so
"peer-confirmed durable" evidence survives restarts. The receipts are
historical attestations (freshness was enforced at accept time); they are
not yet surfaced in the UI.

Pending swarm transfers persist (`gmatch_pending_transfers_v1`) and resume on
boot and on `PEER_ONLINE_EVENT`, so an offline seeder is retried later rather
than lost. Two-machine delivery remains **unverified** until tested on real
hardware; same-machine tests exercise the protocol, not NAT traversal.
