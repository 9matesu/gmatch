# gmatch P2P / Swarm Architecture Specification

> **Status:** Authoritative (v1.5.0+)  
> **Core Principle:** Blind Courier Routing + Zero-Knowledge WebRTC Mesh + Local-First Swarm Seeding.

---

## 1. System Overview

In `gmatch` v1.5.0, the central deployment (`https://gmatch-wcz1.onrender.com`) is strictly a **blind, stateless courier** (`SITE_SERVICES=mail,turn,admin`). It does not store user profiles, online presence, posts, feeds, or media objects. All user data, media, and interactions are served **end-to-end directly between peer nodes**.

```
                   +----------------------------------+
                   |          BLIND COURIER           |
                   | (Render: mail, turn, admin only) |
                   +----------------------------------+
                        ^         ^            ^
           Blind Mail   |         | STUN/TURN  |   Ephemeral
           Put/Get/WS   |         | Traversal  |   Beacons
                        v         v            v
             +--------------+                +--------------+
             |    Node A    |<==============>|    Node B    |
             | (Edge Peer)  |  WebRTC Mesh   | (Edge Peer)  |
             +--------------+  DataChannels  +--------------+
                    |                               |
              Local IndexedDB                 Local IndexedDB
              64KB Chunk Seed                 64KB Chunk Seed
```

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
   - Large media files are divided into 64KB chunks and distributed via `SWARM_WANT` and `SWARM_CHUNK` protocols.
   - Every node that downloads or creates media persists it to local IndexedDB and acts as a seeder (`hydrateLocalObjects`).

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

**Node-hosted lanes are probed, not assumed.** `detectMailMode` reports "courier"
for both a full node and the blind courier, so it cannot gate gameplay. The UI
probes an unauthenticated `GET /api/lobby/invites`: 404 means the node does not
host stateful routes, and lobby/queue/group chat and game invites say so instead
of failing as 404s. Courier DMs and sealed rooms never touch the node and are
exempt.

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

- **Chunk Size:** Standard 64KB (`64 * 1024` bytes) per chunk.
- **Request Cycle:** When a peer sees an image announcement or post referencing `objectId`, it broadcasts `SWARM_WANT` with the ID across:
  1. Active WebRTC mesh data channels (`broadcastMeshFrame`).
  2. Local tab cross-process `BroadcastChannel('orbit_p2p_swarm')`.
- **Response Cycle:** Any peer holding the object slices the binary buffer into 64KB chunks and sends sequential `SWARM_CHUNK` frames.
- **Reassembly:** The requesting peer tracks received chunk indices in memory. Once all chunks are present, it assembles the final `Blob`, verifies the SHA-256 digest against `objectId`, and commits it to local IndexedDB.

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
   optional `media-vault/`; metadata: a persisted publish outbox
   (`gmatch_post_outbox_v1`) commits locally *before* any network call, so a
   server timeout never loses the post. Replication state is shown as
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

Pending swarm transfers persist (`gmatch_pending_transfers_v1`) and resume on
boot and on `PEER_ONLINE_EVENT`, so an offline seeder is retried later rather
than lost. Two-machine delivery remains **unverified** until tested on real
hardware; same-machine tests exercise the protocol, not NAT traversal.