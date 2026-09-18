# Plan: P2P / BitTorrent Media Offload & Fly.io De-Centering

## Goal
Reduce Fly.io bandwidth and memory pressure by 90%+ by turning desktop clients into peer-to-peer seeds for large card/video media via WebRTC DataChannel swarm caching and WebTorrent magnet distribution.

---

## Current Context / Honest Audit: "How P2P / BitTorrent are we?"

### 1. BitTorrent Protocol: Exactly 0%
- **Current reality:** Zero BitTorrent code exists in the repository. No torrent file parsers, no DHT (Mainline/Kademlia), no BEP-0003 tracker protocol, and no magnet link handlers.
- **Why it matters:** Users uploading 50MB MP4 cards store them directly as raw base64 data in Fly.io SQLite (`Objects.content_url`). When multiple users view a card or play an arena round, Fly.io streams the 50MB file to every user individually, spiking RAM to 512MB+ and causing Out-Of-Memory (OOM) kills.

### 2. WebRTC P2P: ~25% (Scaffolded but Centralized)
- **What exists:**
  - `apps/desktop/src/utils/webrtc.ts`: `OrbitPeer` implements a 64KB chunked file transfer protocol over `RTCDataChannel` ('file-transfer').
  - `apps/desktop/src/utils/ice-hygiene.ts`: Strict STUN/TURN candidate filtering to prevent local IP leakage.
  - `apps/desktop/src/utils/peer-relay.ts`: PeerJS wrapper for presence/chat, but disabled by default unless a private PeerServer host is set in env.
- **The flaw:** Signaling is 100% centralized. `OrbitPeer` polls Fly.io endpoints (`POST /api/signal/initiate`, `POST /api/signal/ice`, `GET /api/signal/answer/:id`). If Fly.io restarts or is unreachable, WebRTC fails completely.

### 3. Federation & Self-Hosting: ~40%
- **What exists:**
  - `apps/desktop/electron/apiSidecar.cjs` + `server-mode.cjs`: Desktop Electron can run the bundled Hono/Bun backend locally (`http://127.0.0.1:8790`) in "host mode" and announce its LAN IP.
  - `apps/desktop/src/components/servers/ServersView.tsx`: Server directory merges local and remote servers.
- **The flaw:** Default configuration for all users is hardcoded to `https://gmatch.fly.dev`. Clients never share downloaded media with each other; every client independently hits Fly.io for every asset.

---

## Architecture / Proposed Approach

1. **Local Content-Addressable Cache & P2P Swarm (Zero New Dependencies):**
   - Media objects in `Objects` already have unique SHA-256 hashes / UUIDs.
   - When Client A loads a 50MB card video, it saves the decrypted binary to its local disk/IndexedDB cache (`apps/desktop/electron/imageCache.cjs` / browser Cache API).
   - In any active Lobby, Arena match, or Chat room, clients announce the object IDs they hold in their local cache.
   - When Client B needs an object, it requests chunks from Client A via the existing `OrbitPeer` WebRTC DataChannel (`webrtc.ts`) before falling back to `GET https://gmatch.fly.dev/api/objects/:id`.

2. **WebTorrent Magnet Reference for Large Objects (> 5MB):**
   - For objects larger than 5MB, the client generates an info-hash / Magnet URI (`magnet:?xt=urn:btih:...`) seeded via public WebTorrent WebRTC trackers (`wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`).
   - Fly.io only stores the small metadata record (~500 bytes) instead of a 50MB base64 string in SQLite.

3. **Decentralized Signaling Fallback:**
   - Add public free STUN servers and public WebTorrent tracker-based signaling so clients can negotiate direct DataChannels without querying Fly.io SQLite.

---

## Step-by-Step Tasks

### Task 1: Client-Side Content Cache via Cache API in `useObjectImage`
Prevent repeat HTTP downloads across tabs, components, and reloads by backing `useObjectImage` with browser `caches.open('orbit-objects-v1')`.

- **Files:**
  - Create `apps/desktop/src/utils/objectStore.ts`
  - Test: `apps/desktop/src/utils/objectStore.test.ts`
  - Modify: `apps/desktop/src/hooks/useObjectImage.ts`
- **Code:**
```ts
// apps/desktop/src/utils/objectStore.ts
export async function getCachedObjectBlob(id: string): Promise<Blob | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null
  try {
    const cache = await caches.open('orbit-objects-v1')
    const match = await cache.match(`/api/objects/${id}`)
    if (match) return await match.blob()
  } catch {
    /* Cache API restricted or disabled */
  }
  return null
}

export async function putCachedObjectBlob(id: string, blob: Blob, contentType: string): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  try {
    const cache = await caches.open('orbit-objects-v1')
    const response = new Response(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(blob.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
    await cache.put(`/api/objects/${id}`, response)
  } catch {
    /* Cache quota exceeded or restricted */
  }
}
```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/utils/objectStore.test.ts
  ```
  Expected: 2 tests passed.

---

### Task 2: P2P Chunk Request Protocol over `OrbitPeer` DataChannel
Extend `apps/desktop/src/utils/webrtc.ts` to allow requesting and serving cached object chunks directly between peers.

- **Files:**
  - Modify: `apps/desktop/src/utils/webrtc.ts`
  - Test: `apps/desktop/src/utils/webrtc-swarm.test.ts`
- **Protocol Definition:**
  ```ts
  export type SwarmMessage =
    | { type: 'HAVE_OBJECTS'; ids: string[] }
    | { type: 'WANT_OBJECT'; id: string }
    | { type: 'OBJECT_DATA'; id: string; mimeType: string; totalBytes: number; chunkIndex: number; totalChunks: number; data: string /* base64 */ }
    | { type: 'OBJECT_NOT_FOUND'; id: string }
  ```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/utils/webrtc-swarm.test.ts
  ```
  Expected: Unit tests simulating two `OrbitPeer` instances exchanging object chunks pass without touching network.

---

### Task 3: Peer Swarm Discovery via Active Room Announcements
In `useLobby` and room WebSockets, announce locally cached card IDs in ephemeral presence payloads (`HAVE_OBJECTS`).

- **Files:**
  - Modify: `apps/desktop/src/hooks/useLobby.ts`
  - Modify: `apps/desktop/src/utils/peerRoster.ts`
  - Test: `apps/desktop/src/hooks/useLobby.p2p.test.ts`
- **Logic:**
  When entering an arena or lobby:
  1. Inspect user's active deck card IDs.
  2. Broadcast `{ type: 'HAVE_OBJECTS', ids: [card1, card2, ...] }` over peer connection.
  3. When an opponent's card is revealed, check if opponent holds the object before issuing fetch to Fly.io.

---

### Task 4: WebTorrent Client Fallback for Large Blobs (> 5MB)
Add minimal WebTorrent seeder/downloader integration for media objects marked with a magnet link or info-hash.

- **Files:**
  - Modify: `apps/desktop/package.json` (add `webtorrent` or pure browser client)
  - Create: `apps/desktop/src/services/torrentClient.ts`
  - Test: `apps/desktop/src/services/torrentClient.test.ts`
  - Modify: `apps/desktop/src/components/ObjectImage.tsx`
- **Logic:**
  - If `content_url` starts with `magnet:?xt=urn:btih:`, invoke `torrentClient.download(url)`.
  - Stream chunks directly into `<video>` or `<img src="blob:...">`.
  - Seeds the downloaded file automatically to swarm while app is open.
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/services/torrentClient.test.ts
  ```

---

### Task 5: Backend Metadata-Only Mode for Large Uploads (`/api/objects`)
Allow clients to register media by SHA-256 hash and magnet link without uploading multi-megabyte base64 payloads to Fly.io SQLite.

- **Files:**
  - Modify: `apps/api/src/routes/objects.ts`
  - Test: `apps/api/src/routes/objects-magnet.test.ts`
- **Code Change in `routes/objects.ts`:**
  ```ts
  // Support magnet link registration without inline blob payload
  if (body.magnet_uri && typeof body.magnet_uri === 'string') {
    db.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_avatar, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, body.size_bytes || 0, body.mime_type || 'application/octet-stream', body.magnet_uri, body.is_public ? 1 : 0, 0, new Date().toISOString())
    return c.json({ id, magnet_uri: body.magnet_uri })
  }
  ```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/api && npx vitest run src/routes/objects-magnet.test.ts
  ```

---

### Task 6: Server Directory Health & Multi-Node Failover
Enhance `directoryMerge.ts` and `getApiBaseUrl()` so that if `gmatch.fly.dev` returns 502/503, the app automatically fails over to the next healthy community node in the directory.

- **Files:**
  - Modify: `apps/desktop/src/utils/api.ts`
  - Modify: `apps/desktop/src/components/servers/directoryMerge.ts`
  - Test: `apps/desktop/src/utils/api-failover.test.ts`
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/utils/api-failover.test.ts
  ```

---

## Tests & Validation Strategy
- **TDD Workflow:** Every task begins with a failing test (`vitest run <test_file>`), followed by minimal implementation, verification of pass, typechecking (`npm run typecheck`), and targeted commit.
- **Traffic Verification:**
  - Measure network requests in Electron / browser DevTools: viewing cards already cached or held by a peer in the lobby generates 0 HTTP requests to `gmatch.fly.dev/api/objects/*`.
  - Simulate Fly.io outage: verify that peers connected via WebRTC continue playing duels and viewing card art without disruptions.

---

## Risks, Tradeoffs, and Open Questions

1. **NAT Traversal & Asymmetric Firewalls:**
   - *Risk:* Two clients behind strict symmetric NATs cannot establish a direct WebRTC connection without a TURN relay.
   - *Mitigation:* Fall back to Fly.io HTTP fetch if WebRTC connection fails within 3 seconds. P2P is an opportunistic offload, never a single point of failure.

2. **Availability of Infrequent / Old Cards:**
   - *Risk:* If a card was uploaded by a user who is offline, and no other peer has it cached, WebTorrent has 0 seeders.
   - *Mitigation:* Hybrid fallback: Fly.io keeps a compressed low-res thumbnail fallback, while the full high-res/60fps video is seeded peer-to-peer.

3. **Storage Quota:**
   - *Tradeoff:* Browser Cache API has quota limits (typically 10-20% of disk space).
   - *Mitigation:* LRU eviction policy already implemented in `useObjectImage.ts` and `imageCache.cjs`.

---

## Deliverable Summary
- Saved to: `.hermes/plans/2026-09-17_054500-p2p-bittorrent-fly-offload.md`
- Next steps: Review and execute Task 1 (Client Cache API) or Task 2 (WebRTC Chunk Protocol).
