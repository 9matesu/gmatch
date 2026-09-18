# Plan: Zero-Fly Media Storage — Full P2P & BitTorrent Swarm Architecture

## Goal
Completely eliminate media storage on Fly.io by storing all media locally on clients, registering only content hashes and metadata on the backend, and distributing binary chunks peer-to-peer via WebRTC DataChannels and WebTorrent.

---

## Current Context & Honest Audit

### 1. How P2P / BitTorrent are we today?
- **BitTorrent: Exactly 0%.** There is no torrent client, no DHT engine, no tracker client, and no magnet link parser anywhere in the repo.
- **WebRTC: ~25% (P2P file transfer exists, but signaling is centralized).** `apps/desktop/src/utils/webrtc.ts` implements 64KB chunked file transfer over `RTCDataChannel`, but it requires Fly.io REST endpoints (`/api/signal/initiate`, `/api/signal/ice`, `/api/signal/answer/:id`) to connect.
- **Fly.io Media Storage: 100% Centralized.** When users forge cards in `CreateCardModal.tsx` or post to the feed in `CreatePostModal.tsx`, the client sends the entire raw binary to `POST https://gmatch.fly.dev/api/objects`. Fly.io base64-encodes files into SQLite (`Objects.content_url`) or saves them into the local `blobs/` disk.
- **The Catastrophe:** Large 50MB MP4 cards (e.g. `1a3c9060-b6b6-4750-b842-bb3d1fb75119`) are buffered and decoded in Bun memory on Fly.io. With multiple concurrent players, Bun exceeds the 512MB/1024MB container memory limit, triggering Linux OOM kills (`SIGKILL`) that drop all active matches and return `502 Bad Gateway`.

---

## Architecture & Proposed Approach
1. **Fly.io Stores Zero Media Bytes:** `apps/api/src/routes/objects.ts` transitions to a metadata-only registry (`id`, `owner_id`, `content_hash`, `mime_type`, `size_bytes`, `magnet_uri`, `caption`). Any direct binary upload > 128KB is rejected with HTTP 422.
2. **Local-First Client Vault:** When creating cards or posts, the desktop client writes the binary directly to its existing local media vault (`<userData>/media-vault/<sha256>.ext` via `apps/desktop/electron/vault.cjs`), computes the SHA-256 hash and magnet URI, and registers only the metadata on Fly.io.
3. **P2P Swarm & WebTorrent Distribution:** In lobbies, arena matches, and feed viewing, clients resolve media by `content_hash`:
   - *Direct WebRTC Swarm (1KB–5MB):* Connected peers in the same lobby or match exchange chunks directly over `RTCDataChannel` using the existing `OrbitPeer` (`webrtc.ts`).
   - *WebTorrent Swarm (> 5MB):* Large video cards seed over public WebTorrent trackers (`wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`) so any online client holding the card serves chunks to peers without touching Fly.io bandwidth or memory.

---

## Step-by-Step Tasks

### Task 1: Backend Zero-Media Gate in `apps/api/src/routes/objects.ts`
Enforce that the central server NEVER stores raw binary media blobs. Accepts metadata + content hash + magnet URI, but rejects raw binary payloads.

- **Files:**
  - Test: `apps/api/src/routes/objects-zero-media.test.ts`
  - Modify: `apps/api/src/routes/objects.ts`
- **TDD Test (`apps/api/src/routes/objects-zero-media.test.ts`):**
  ```ts
  import { describe, it, expect } from 'vitest'
  import app from '../index'
  import { createTestIdentity } from '../test-utils'

  describe('Objects zero-media policy (Plan P-Zero)', () => {
    it('accepts metadata-only registration with content_hash and magnet_uri', async () => {
      const id = createTestIdentity()
      const res = await app.request('/api/objects/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-obj-123',
          content_hash: 'a'.repeat(64),
          size_bytes: 52428800,
          mime_type: 'video/mp4',
          magnet_uri: 'magnet:?xt=urn:btih:abcdef123456',
          caption: 'Test Card',
          is_public: 1,
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe('test-obj-123')
      expect(data.magnet_uri).toBe('magnet:?xt=urn:btih:abcdef123456')
    })

    it('rejects raw binary uploads exceeding 128KB with 422 policy error', async () => {
      const id = createTestIdentity()
      const bigBlob = new Uint8Array(256 * 1024)
      const form = new FormData()
      form.append('image', new Blob([bigBlob], { type: 'image/jpeg' }), 'big.jpg')
      const res = await app.request('/api/objects', {
        method: 'POST',
        body: form,
      })
      expect(res.status).toBe(422)
      const err = await res.json()
      expect(err.error).toContain('Central server does not store media files')
    })
  })
  ```
- **Implementation in `apps/api/src/routes/objects.ts`:**
  1. Add `POST /api/objects/register` accepting JSON `{ id, content_hash, size_bytes, mime_type, magnet_uri, caption, is_public, is_story, is_avatar }`.
  2. Insert into `Objects` with `content_url = magnet_uri || ('urn:sha256:' + content_hash)`.
  3. In `POST /api/objects`, check `if (bytes.length > 128 * 1024) return c.json({ error: 'Central server does not store media files. Register content metadata and seed via P2P.' }, 422)`.
- **Verification:**
  ```bash
  cd I:/goongrid/apps/api && npx vitest run src/routes/objects-zero-media.test.ts
  ```
  Expected: 2 tests passed.

---

### Task 2: Desktop Client Local-First Vault Stash in `apps/desktop/src/services/mediaForge.ts`
When the user selects an image or video to create a card or post, stash the file in the local Electron media vault (`vault://`), hash it via Web Crypto SHA-256, and register metadata to the backend.

- **Files:**
  - Create: `apps/desktop/src/services/mediaForge.ts`
  - Test: `apps/desktop/src/services/mediaForge.test.ts`
  - Modify: `apps/desktop/src/components/CreateCardModal.tsx`
- **Code (`apps/desktop/src/services/mediaForge.ts`):**
  ```ts
  import { OrbitIdentity } from '@orbit/crypto'
  import { orbitFetch } from '../utils/api'

  export interface ForgedMedia {
    id: string
    contentHash: string
    mimeType: string
    sizeBytes: number
    localUrl: string
    magnetUri?: string
  }

  export async function hashFileSha256(file: File | Blob): Promise<string> {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  export async function forgeMediaLocally(
    file: File,
    identity: OrbitIdentity,
    magnetUri?: string
  ): Promise<ForgedMedia> {
    const contentHash = await hashFileSha256(file)
    const objectId = crypto.randomUUID()

    // 1. Stash in local Electron vault (or IndexedDB in browser)
    let localUrl = URL.createObjectURL(file)
    if (typeof window !== 'undefined' && window.gmatch?.vaultPin) {
      const pinned = await window.gmatch.vaultPin(`local://${contentHash}`)
      if (pinned?.local) localUrl = pinned.local
    }

    // 2. Register metadata ONLY with the backend (zero binary sent to Fly.io)
    const res = await orbitFetch('/api/objects/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: objectId,
        content_hash: contentHash,
        size_bytes: file.size,
        mime_type: file.type || 'application/octet-stream',
        magnet_uri: magnetUri || `magnet:?xt=urn:btih:${contentHash.slice(0, 40)}`,
        is_public: 1,
      }),
    }, identity)

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to register media metadata')
    }

    return {
      id: objectId,
      contentHash,
      mimeType: file.type,
      sizeBytes: file.size,
      localUrl,
      magnetUri,
    }
  }
  ```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/services/mediaForge.test.ts
  ```

---

### Task 3: P2P Swarm Engine over WebRTC DataChannel in `apps/desktop/src/utils/p2pSwarm.ts`
Implement the peer-to-peer chunk request protocol so players in a match or room request and send card media directly over WebRTC DataChannel.

- **Files:**
  - Create: `apps/desktop/src/utils/p2pSwarm.ts`
  - Test: `apps/desktop/src/utils/p2pSwarm.test.ts`
  - Modify: `apps/desktop/src/utils/webrtc.ts`
- **Protocol:**
  ```ts
  export interface SwarmChunkRequest {
    type: 'SWARM_WANT'
    contentHash: string
    chunkIndex: number
  }

  export interface SwarmChunkResponse {
    type: 'SWARM_CHUNK'
    contentHash: string
    chunkIndex: number
    totalChunks: number
    mimeType: string
    dataBase64: string
  }
  ```
- **Behavior:**
  - If Client B enters an arena duel against Client A, Client A sends `{ type: 'SWARM_HAVE', hashes: [cardAHash, cardBHash] }`.
  - Client B sends `SWARM_WANT` for the opponent's card hash.
  - Client A reads the file from local vault and streams 64KB chunks over WebRTC.
  - Client B reassembles the blob into its local cache and renders the card.
  - Fly.io transfers **zero bytes**.
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/utils/p2pSwarm.test.ts
  ```
  Expected: Unit tests simulating two peers exchanging a 5MB payload in chunks pass with 100% byte fidelity.

---

### Task 4: WebTorrent Client for Video Cards (> 5MB)
Add WebTorrent client support in `@gmatch/desktop` for high-resolution video cards.

- **Files:**
  - Modify: `apps/desktop/package.json` (install `webtorrent`)
  - Create: `apps/desktop/src/services/torrentSeeder.ts`
  - Test: `apps/desktop/src/services/torrentSeeder.test.ts`
  - Modify: `apps/desktop/src/components/ObjectImage.tsx`
- **Code (`apps/desktop/src/services/torrentSeeder.ts`):**
  ```ts
  import WebTorrent from 'webtorrent'

  const client = new WebTorrent({
    tracker: {
      wrtc: typeof window !== 'undefined' ? window.RTCPeerConnection : undefined,
    },
  })

  export const PUBLIC_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.dev',
  ]

  export function seedMediaFile(file: File): Promise<string> {
    return new Promise((resolve) => {
      client.seed(file, { announce: PUBLIC_TRACKERS }, (torrent) => {
        resolve(torrent.magnetURI)
      })
    })
  }

  export function streamTorrentMedia(magnetUri: string, callback: (blobUrl: string) => void): void {
    client.add(magnetUri, { announce: PUBLIC_TRACKERS }, (torrent) => {
      const file = torrent.files[0]
      if (!file) return
      file.getBlobURL((err, url) => {
        if (!err && url) callback(url)
      })
    })
  }
  ```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/desktop && npx vitest run src/services/torrentSeeder.test.ts
  ```

---

### Task 5: Database Blobs Purge Script on Fly.io
Reclaim memory and disk on the Fly.io node by stripping raw base64 data URLs from `Objects.content_url` and clearing the `blobs/` disk directory.

- **Files:**
  - Create: `apps/api/src/scripts/purge-blobs.ts`
  - Test: `apps/api/src/scripts/purge-blobs.test.ts`
- **Script (`apps/api/src/scripts/purge-blobs.ts`):**
  ```ts
  import { createClient } from '@libsql/client'

  export async function purgeBlobs(dbUrl: string): Promise<number> {
    const client = createClient({ url: dbUrl })
    // Replace inline base64 content_url with urn:sha256 markers
    const res = await client.execute(`
      UPDATE Objects
      SET content_url = 'urn:sha256:' || COALESCE(content_hash, hex(randomblob(16)))
      WHERE content_url LIKE 'data:%'
    `)
    return res.rowsAffected
  }
  ```
- **Verification:**
  ```bash
  cd I:/goongrid/apps/api && bun run src/scripts/purge-blobs.ts
  ```
  Expected: All base64 blobs replaced with URN content hashes; SQLite size reduced from 100MB+ to <5MB.

---

## Tests & Validation Strategy
1. **Zero-Byte Backend Assertion:**
   - Run full end-to-end card creation flow in Electron.
   - Inspect network log: `POST /api/objects/register` payload must be `< 2KB` JSON.
   - Assert `POST /api/objects` with binary file returns `422`.
2. **P2P Duel Verification:**
   - Launch two desktop clients in separate test profiles.
   - Client A creates a 20MB video card.
   - Client A and Client B enter an arena duel.
   - Client B receives the card video via WebRTC DataChannel directly from Client A.
   - Verify `https://gmatch.fly.dev` received 0 requests for the video bytes.
3. **Outage Immunity:**
   - Stop or block `https://gmatch.fly.dev` in `/etc/hosts` or dev proxy.
   - Existing connected peers in a room continue chatting, dueling, and viewing card media uninterrupted over WebRTC swarm.

---

## Risks, Tradeoffs, and Open Questions
- **Offline Seeders:** If a user uploads a rare card and immediately shuts down their computer before anyone else views it, the card has 0 active seeders in the swarm.
  - *Mitigation:* The card creator's client pins the card locally. When the creator is offline, the card tile shows the creator's avatar + metadata with a "Seeder offline" badge until the creator returns or another holder comes online.
- **Symmetric NATs without TURN:** If two peers are behind strict corporate/university NATs and cannot direct-connect via WebRTC, they require a TURN relay.
  - *Mitigation:* Use coturn or public WebTorrent WebSockets as pure byte relays (DTLS encrypted, zero plaintext).

---

## Deliverable Summary
- Plan saved: `.hermes/plans/2026-09-17_060000-zero-fly-media-p2p-architecture.md`
- Next steps: Review and execute Task 1 (Backend zero-media gate).
