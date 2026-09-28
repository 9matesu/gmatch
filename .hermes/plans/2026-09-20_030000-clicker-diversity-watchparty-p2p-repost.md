# Idle Clicker Image Diversity, Limitless Watch Party Scaling, and P2P Repost Architecture Implementation Plan

> **For Hermes / Implementer:** Follow TDD strictly. Run tests before and after every modification. Do not deviate from the specified file paths.

---

## Goal
Eliminate booru image repetition in the idle clicker game, scale watch parties to unlimited attendees with zero-drop reconnect grace, and repair idle clicker/card media reposting by routing all media assets through local binary resolution and the zero-fly P2P swarm (`forgeMediaLocally` + IndexedDB + WebRTC relay) so all peers receive and store feed images.

---

## Current Context / Assumptions
1. **Idle Clicker Repetition:** `booru-sources-core.cjs` samples only `pid = 0..7` on DAPI and `page = 0..9` on booru.org. Furthermore, `booruSources.cjs` aggressively serves stale `feedCache` for 10 minutes, and `apps/desktop/src/game/store.ts` falls back to recycling previously seen posts (`usablePosts = freshPosts.length > 0 ? freshPosts : posts`) instead of fetching fresh pages.
2. **Watch Party Limits & 10% Drops:** `apps/api/src/watchparty.ts` enforces a hard cap `party.members.size >= 8`. When the host or last member temporarily blips/reloads, `removeMember` calls `dropParty` immediately, destroying the room. Joining sends a full video frame snapshot to all room members via `ws-bus.ts`, causing player stutters and desync across all active viewers.
3. **Broken Feed Reposts for Clicker Images & Cards:**
   - When reposting idle clicker images, the preview URL is often `gmcache://<key>` or a direct booru URL (`https://realbooru.com/...`).
   - `CreatePostModal.tsx` only inspects `data:`, `blob:`, `/api/objects/`, and `^https?:\/\/`. It ignores `gmcache://`, `idle-file://`, `vault://`, and `/booru/`.
   - When `mediaUrlToCachedFile` fails or is skipped, `CreatePostModal.tsx` falls back to `formData.append('url', item.previewUrl)`. This posts raw `gmcache://` URLs (which only exist in the author's local RAM) or hotlink-blocked external URLs to the server.
   - When reposting cards (`/api/objects/:id`), `CreatePostModal.tsx` fetches `/api/objects/:id` which returns a `{ type: 'p2p' }` JSON descriptor rather than raw binary, creating a corrupt JSON text attachment.
   - Under the Zero-Fly P2P architecture, all feed media must be converted to an authentic `File`, hashed with SHA-256, seeded locally via `registerLocalObject`, registered via `POST /api/objects/register`, and distributed peer-to-peer over the swarm so every peer receives and stores the bytes locally.

---

## Architecture / Proposed Approach
1. **Diversity Engine:** Expand random pagination sampling to 100+ pages with `pid=0` fallback on empty pages. Repurpose `feedCache` strictly as an offline network-failure fallback. In `apps/desktop/src/game/store.ts`, advance page pagination when `freshPosts.length === 0` rather than recycling already-displayed images.
2. **Limitless Watch Party Engine:** Remove the 8-member ceiling in `watchparty.ts`. Add a 15-minute reconnect grace window before deleting empty rooms. Partition `watch.join` in `ws-bus.ts` so the video snapshot is sent privately to the joiner socket, while existing viewers receive only lightweight roster delta notices.
3. **P2P Ingest & Repost Pipeline:**
   - In `cacheMedia.ts` and `CreatePostModal.tsx`, build a unified `resolveMediaItemToFile` pipeline.
   - Directly resolve `gmcache://`, `idle-file://`, `vault://`, and `/booru/` via privileged renderer fetch.
   - For `/api/objects/:id` and cards, inspect local IndexedDB/memory via `getLocalObject(id)` and `getLocalObject(contentHash)` first; fallback to swarm retrieval via `requestSwarmObject` if not present.
   - For booru URLs, fetch via Electron bridge `cacheImage` to bypass CORS and anti-hotlink restrictions.
   - All posts route through `forgeMediaLocally`, guaranteeing zero server binary storage, immediate seeding to IndexedDB/disk, metadata registration, and swarm transmission to all peers.

---

## Step-by-Step Tasks

### Task 1: Expand Booru Pagination and Convert Feed Cache to Offline Fallback

**Goal:** Eliminate repeated booru images by expanding page sampling and disabling eager cache hits.
**Files:**
- `apps/desktop/electron/booru-sources-core.cjs`
- `apps/desktop/electron/booruSources.cjs`
- `apps/desktop/electron/booruSources.test.cjs`

#### Step 1.1: Write failing test in `booruSources.test.cjs`
Add a test verifying that `fetchBooruPosts` does not return stale cached data when `fresh: true` is set or when calling subsequent random queries:

```javascript
// Append to apps/desktop/electron/booruSources.test.cjs
const assert = require('assert')
const { getFeedCache } = require('./imageCache.cjs')

// Verify fresh requests do not eagerly return memoized feed cache
const queryKey = 'test_repetition_tag'
getFeedCache[queryKey] = {
  time: Date.now(),
  posts: [{ id: 'stale-1', url: 'https://realbooru.com/images/stale1.jpg' }]
}

// Ensure source sampling uses expanded pagination window
const core = require('./booru-sources-core.cjs')
assert.ok(core.MAX_DAPI_PAGE >= 50, 'MAX_DAPI_PAGE must be at least 50')
console.log('Task 1 test passed assertion')
```

#### Step 1.2: Run test to observe failure
```bash
node apps/desktop/electron/booruSources.test.cjs
```
*Expected output:* `AssertionError: MAX_DAPI_PAGE must be at least 50`

#### Step 1.3: Update `booru-sources-core.cjs`
Expose pagination bounds and increase sampling breadth:

```javascript
// In apps/desktop/electron/booru-sources-core.cjs
const MAX_DAPI_PAGE = 80
const MAX_BOORU_ORG_PAGE = 40
const MAX_PAHEAL_PAGE = 25

// Replace dapiSource pid generator:
// Old: const pid = Math.floor(Math.random() * 8)
// New:
const pid = Math.floor(Math.random() * MAX_DAPI_PAGE)

// Replace booruOrgSource page generator:
// Old: const page = Math.floor(Math.random() * 10)
// New:
const page = Math.floor(Math.random() * MAX_BOORU_ORG_PAGE)

module.exports = {
  // ... existing exports
  MAX_DAPI_PAGE,
  MAX_BOORU_ORG_PAGE,
  MAX_PAHEAL_PAGE,
}
```

#### Step 1.4: Update `booruSources.cjs`
Change `cache.getFeedCache(query)` from an eager short-circuit to a network-failure fallback:

```javascript
// In apps/desktop/electron/booruSources.cjs
// Around line 40:
// Remove eager return:
// if (feedCache && (now - feedCache.time < 10 * 60 * 1000)) return feedCache.posts

// Retain cache ONLY as fallback inside catch block:
try {
  const posts = await querySources(tags, limit)
  if (posts.length > 0) {
    cache.setFeedCache(query, posts)
    return posts
  }
} catch (err) {
  const stale = cache.getFeedCache(query)
  if (stale && stale.posts && stale.posts.length > 0) {
    return stale.posts
  }
  throw err
}
```

#### Step 1.5: Re-run test to verify pass
```bash
node apps/desktop/electron/booruSources.test.cjs
```
*Expected output:* `booruSources: all assertions passed`

---

### Task 2: Fix Idle Store Post Recycling Loop

**Goal:** Stop `apps/desktop/src/game/store.ts` from looping through already-seen images when a query completes.
**Files:**
- `apps/desktop/src/game/store.ts`

#### Step 2.1: Update `fetchPosts` in `apps/desktop/src/game/store.ts`
Locate lines 980-995 in `apps/desktop/src/game/store.ts`:

```typescript
// Replace:
// const freshPosts = posts.filter((p) => !existingUrls.has(p.url))
// const usablePosts = freshPosts.length > 0 ? freshPosts : posts

// With:
const freshPosts = posts.filter((p) => !existingUrls.has(p.url))
let usablePosts = freshPosts
if (usablePosts.length === 0) {
  // # ponytail: advance page rather than recycling seen posts into active slots
  const nextPage = (get().booruPage || 0) + 1
  set({ booruPage: nextPage })
  // Schedule fresh page fetch without mutating cards to duplicate images
  return
}
```

#### Step 2.2: Verify with vitest
```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/grid/IdleGalleryView.test.tsx
```
*Expected output:* `✓ src/components/grid/IdleGalleryView.test.tsx (1 test) passed`

---

### Task 3: Enable Limitless Watch Party Entry (Remove 8-Member Cap)

**Goal:** Remove the 8-member limit in `apps/api/src/watchparty.ts` and update documentation.
**Files:**
- `apps/api/src/watchparty.ts`
- `apps/api/src/watchparty.test.ts`
- `docs/WATCH.md`

#### Step 3.1: Write failing test in `apps/api/src/watchparty.test.ts`
Add a test asserting that joining beyond 8 members succeeds:

```typescript
// In apps/api/src/watchparty.test.ts
test('allows limitless party entry beyond 8 members', () => {
  const party = createParty('host-user', 'host-user', { name: 'Big Watch Party' })
  for (let i = 1; i <= 24; i++) {
    const res = addMember(party, `user-${i}`)
    expect(res).not.toBeNull()
  }
  expect(party.members.size).toBe(25) // 1 host + 24 peers
})
```

#### Step 3.2: Run test to observe failure
```bash
cd I:/goongrid/apps/api && npm test watchparty.test.ts
```
*Expected output:* `Expected: 25, Received: 8`

#### Step 3.3: Remove cap in `apps/api/src/watchparty.ts`
In `apps/api/src/watchparty.ts`, delete line 216:

```typescript
// Delete:
// if (party.members.size >= 8 && !party.members.has(userId)) return null
```

#### Step 3.4: Update `docs/WATCH.md`
Remove references to the 8-person limit:
- Replace `Limit: 8 simultaneous peers per room` with `Limit: Limitless peer entry with partitioned WS snapshot synchronization`.

#### Step 3.5: Run test to verify pass
```bash
cd I:/goongrid/apps/api && npm test watchparty.test.ts
```
*Expected output:* `✓ watchparty.test.ts (all tests passing)`

---

### Task 4: Fix 10% Watch Party Breakage (Reconnect Grace & Partitioned Join Broadcast)

**Goal:** Prevent rooms from closing during network blips and stop broadcast frame spamming on peer join.
**Files:**
- `apps/api/src/watchparty.ts`
- `apps/api/src/ws-bus.ts`
- `apps/api/src/watchparty.test.ts`

#### Step 4.1: Write failing test in `apps/api/src/watchparty.test.ts`
Verify that an empty party enters a grace period rather than instant deletion:

```typescript
test('empty party enters grace period and is not immediately destroyed', () => {
  const party = createParty('host-user', 'host-user', { name: 'Grace Party' })
  removeMember(party, 'host-user')
  expect(party.emptySince).toBeGreaterThan(0)
  expect(getParty(party.id)).not.toBeUndefined()
})
```

#### Step 4.2: Update `removeMember` in `apps/api/src/watchparty.ts`
Add a 15-minute grace window:

```typescript
// In apps/api/src/watchparty.ts:
export function removeMember(party: WatchParty, userId: string): void {
  party.members.delete(userId)
  if (party.members.size === 0) {
    // # ponytail: 15-minute grace period prevents reload/disconnect room destruction
    party.emptySince = Date.now()
    return
  }
  party.emptySince = undefined
}

export function cleanupExpiredParties(): void {
  const GRACE_MS = 15 * 60 * 1000
  const now = Date.now()
  for (const [id, party] of parties.entries()) {
    if (party.emptySince && (now - party.emptySince > GRACE_MS)) {
      dropParty(party)
    }
  }
}
```

#### Step 4.3: Partition join broadcast in `apps/api/src/ws-bus.ts`
When handling `watch.join`:
- Send the heavy `msg.frame` (video snapshot) ONLY to the joining socket (`conn`).
- Broadcast ONLY the roster update (`watch.roster`) to the rest of the room.
- This prevents the video element in active viewers' players from re-seeking or stuttering.

```typescript
// In apps/api/src/ws-bus.ts under watch.join handler:
// Send snapshot only to joiner:
conn.send(JSON.stringify({
  type: 'watch.snapshot',
  partyId: party.id,
  frame: party.currentFrame,
  state: party.playbackState,
}))

// Broadcast roster delta to all other room members:
broadcastToPartyExcept(party.id, conn, {
  type: 'watch.roster',
  partyId: party.id,
  members: Array.from(party.members),
})
```

#### Step 4.4: Run test to verify pass
```bash
cd I:/goongrid/apps/api && npm test watchparty.test.ts
```
*Expected output:* `✓ watchparty.test.ts passed`

---

### Task 5: Implement Unified Media-to-File Resolution in `cacheMedia.ts`

**Goal:** Ensure any image (from booru, idle clicker `gmcache://`, local schemes, or cards) reliably resolves to a `File` object.
**Files:**
- `apps/desktop/src/utils/cacheMedia.ts`
- `apps/desktop/src/utils/cacheMedia.test.ts`

#### Step 5.1: Write failing test in `apps/desktop/src/utils/cacheMedia.test.ts`
```typescript
// apps/desktop/src/utils/cacheMedia.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mediaUrlToCachedFile } from './cacheMedia'

describe('mediaUrlToCachedFile resolution', () => {
  it('resolves gmcache:// URLs directly via fetch without throwing', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image-bytes'], { type: 'image/jpeg' }),
    })) as any

    const file = await mediaUrlToCachedFile('gmcache://f/abc12345.jpg')
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
  })
})
```

#### Step 5.2: Run test to observe failure
```bash
cd I:/goongrid/apps/desktop && npx vitest run src/utils/cacheMedia.test.ts
```
*Expected output:* `Test fails or file not found`

#### Step 5.3: Update `apps/desktop/src/utils/cacheMedia.ts`
Support local schemes and improve error handling:

```typescript
// In apps/desktop/src/utils/cacheMedia.ts
export async function mediaUrlToCachedFile(url: string): Promise<File> {
  let source = url.trim()
  const b = bridge()

  // Handle direct local protocol fetches (gmcache, idle-file, vault)
  if (/^(gmcache|idle-file|vault|blob|data):/i.test(source) || source.startsWith('/booru/')) {
    try {
      const res = await fetch(source, { referrerPolicy: 'no-referrer' })
      if (res.ok) {
        const blob = await res.blob()
        const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
        return new File([blob], `media-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' })
      }
    } catch {
      /* fallback below */
    }
  }

  // Remote HTTP(S) booru resolution via Electron main process bridge
  if (b?.cacheImage && /^https?:/i.test(source)) {
    try {
      const res = await b.cacheImage(source)
      if (res?.local) source = String(res.local)
    } catch {
      /* fall back to direct fetch */
    }
  } else if (isDev() && /^https?:/i.test(source)) {
    const proxied = devFetchable(source)
    if (proxied) source = proxied
  }

  try {
    const res = await fetch(source, { referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(`source responded ${res.status}`)
    const blob = await res.blob()
    if (blob.size === 0 || (!blob.type.startsWith('image/') && !blob.type.startsWith('video/'))) {
      throw new Error('not cacheable media')
    }
    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
    return new File([blob], `media-${Date.now()}.${ext}`, { type: blob.type })
  } catch (err) {
    throw new Error(`Failed to resolve media bytes: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

#### Step 5.4: Run test to verify pass
```bash
cd I:/goongrid/apps/desktop && npx vitest run src/utils/cacheMedia.test.ts
```
*Expected output:* `✓ src/utils/cacheMedia.test.ts (1 test) passed`

---

### Task 6: Connect Feed Post Creator to P2P Ingest for Clicker Images & Cards

**Goal:** In `CreatePostModal.tsx`, resolve all incoming media into `File` instances and forge them locally via `forgeMediaLocally`. Never fall back to sending dead raw URLs.
**Files:**
- `apps/desktop/src/components/feed/CreatePostModal.tsx`
- `apps/desktop/src/components/feed/CreatePostModal.test.tsx`

#### Step 6.1: Write failing test in `apps/desktop/src/components/feed/CreatePostModal.test.tsx`
Verify that `CreatePostModal` converts `gmcache://` and card object references to forged P2P media items:

```typescript
// In apps/desktop/src/components/feed/CreatePostModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { resolveMediaItemToFile } from './CreatePostModal'

describe('resolveMediaItemToFile', () => {
  it('resolves card object by checking getLocalObject before network', async () => {
    const mockIdentity = { orbitId: 'test-user', publicKeyHex: 'p', privateKeyHex: 'k' }
    const fakeBlob = new Blob(['card-bytes'], { type: 'image/jpeg' })

    vi.mock('../../utils/p2pSwarm', () => ({
      getLocalObject: vi.fn(async (id: string) => id === 'card-123' ? fakeBlob : null),
      requestSwarmObject: vi.fn(),
    }))

    const file = await resolveMediaItemToFile({
      id: 'item-1',
      previewUrl: '/api/objects/card-123',
    }, mockIdentity)

    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
  })
})
```

#### Step 6.2: Implement `resolveMediaItemToFile` in `CreatePostModal.tsx`
Add resolution helper that guarantees conversion to a binary `File`:

```typescript
// In apps/desktop/src/components/feed/CreatePostModal.tsx:
import { mediaUrlToCachedFile } from '../../utils/cacheMedia'
import { getLocalObject, requestSwarmObject } from '../../utils/p2pSwarm'
import { normalizeCardId } from '../../hooks/useObjectImage'

export async function resolveMediaItemToFile(
  item: { file?: File; previewUrl: string },
  identity: any
): Promise<File> {
  if (item.file) return item.file

  const preview = item.previewUrl.trim()

  // 1. Data URLs and Blobs
  if (preview.startsWith('data:') || preview.startsWith('blob:')) {
    const blob = await fetch(preview).then((r) => r.blob())
    return new File([blob], `media_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
  }

  // 2. Card / Object References: check local IndexedDB first
  if (preview.includes('/api/objects/')) {
    const cleanId = normalizeCardId(preview)
    const localBlob = await getLocalObject(cleanId)
    if (localBlob) {
      return new File([localBlob], `card_${cleanId}.jpg`, { type: localBlob.type || 'image/jpeg' })
    }

    // Swarm retrieval or remote descriptor resolution
    try {
      const swarmBlob = await requestSwarmObject(cleanId, 5000)
      if (swarmBlob) {
        return new File([swarmBlob], `card_${cleanId}.jpg`, { type: swarmBlob.type || 'image/jpeg' })
      }
    } catch {
      /* fallback to orbitFetch */
    }

    const res = await orbitFetch(preview, {}, identity)
    if (res.ok) {
      const ctype = (res.headers.get('Content-Type') || '').toLowerCase()
      if (ctype.includes('json')) {
        const desc = await res.json().catch(() => null)
        if (desc?.content_hash) {
          const hashBlob = await getLocalObject(desc.content_hash)
          if (hashBlob) {
            return new File([hashBlob], `card_${cleanId}.jpg`, { type: hashBlob.type || 'image/jpeg' })
          }
        }
      } else {
        const blob = await res.blob()
        if (blob.size > 0) return new File([blob], `card_${cleanId}.jpg`, { type: blob.type || 'image/jpeg' })
      }
    }
  }

  // 3. Booru, gmcache, and external images
  return await mediaUrlToCachedFile(preview)
}
```

#### Step 6.3: Enforce `forgeMediaLocally` for all resolved media in `handleSubmit`
In `CreatePostModal.tsx`, update the submission loop:

```typescript
// In handleSubmit():
for (let i = 0; i < mediaList.length; i++) {
  const item = mediaList[i]
  let uploadFile: File
  try {
    uploadFile = await resolveMediaItemToFile(item, identity)
  } catch (err) {
    toast.error('Failed to process image for post: ' + (err instanceof Error ? err.message : String(err)))
    setSubmitting(false)
    return
  }

  // Zero-media P2P path: seed locally into swarm and register metadata with server
  const forged = await forgeMediaLocally(uploadFile, identity, {
    caption: i === 0 ? caption.trim() : undefined,
    postCaption: i === 0 ? caption.trim() : undefined,
    location: i === 0 ? location.trim() : undefined,
    tags: i === 0 ? tags.trim() : undefined,
    isPublic: true,
    postGroup,
  })
  ids.push(forged.id)
  if (!primaryId) primaryId = forged.id
  if (!primaryLocalUrl && forged.localUrl) primaryLocalUrl = forged.localUrl
}
```

#### Step 6.4: Run tests to verify pass
```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed/CreatePostModal.test.tsx
```
*Expected output:* `✓ src/components/feed/CreatePostModal.test.tsx passed`

---

## Tests / Validation Plan

1. **Booru Sources & Image Diversity:**
   - Command: `node apps/desktop/electron/booruSources.test.cjs`
   - Verification: passes all random pagination sampling assertions.
2. **Watch Party Scalability:**
   - Command: `npm test --prefix apps/api watchparty.test.ts`
   - Verification: verifies 25+ members join without errors; verifies 15-minute disconnect grace period.
3. **P2P Swarm & Media Resolution:**
   - Command: `npm test --prefix apps/desktop src/utils/cacheMedia.test.ts`
   - Command: `npm test --prefix apps/desktop src/components/feed/CreatePostModal.test.tsx`
   - Command: `npm test --prefix apps/desktop src/components/grid/IdleGalleryView.test.tsx`
   - Verification: verifies that idle clicker images (`gmcache://`), cards (`/api/objects/:id`), and booru URLs resolve to valid `File` payloads, forge into the P2P swarm, and register with the backend.

---

## Risks, Tradeoffs, and Open Questions
- **Risk:** Large card or video objects may take a few seconds to retrieve from swarm peers if the publishing client is offline.
  - *Mitigation:* `useObjectImage` displays an animated "waiting for poster" indicator and automatically retries upon `PEER_ONLINE_EVENT`.
- **Tradeoff:** Bypassing eager feed cache slightly increases network traffic to booru providers.
  - *Mitigation:* Broad random pagination prevents hammering identical page endpoints, reducing rate-limiting risk.
- **Open Question:** Do we want an explicit progress bar during post creation when forging multi-megabyte card reposts?
  - *Default:* The existing modal spinner and disable state covers this adequately (YAGNI).
