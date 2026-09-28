# Idle Clicker Image Diversity, Limitless Watch Party Scaling, and Post Media Safety Implementation Plan

> **For Hermes:** Use subagent-driven-development or strict TDD to implement this plan task-by-task.

**Goal:** Eliminate idle clicker image repetition from booru API caching and narrow pagination, remove the 8-person watch party limit to enable high-concurrency synchronized viewing without disconnect drops, and prevent broken clicker and card images from being published in feed posts.

**Architecture:**
- **Booru Provider Diversity:** Convert the Electron main feed cache from an eager 10-minute memo blocker into an offline-only fallback, widen pagination random sampling from 8 pages to 100+ pages across DAPI, Moebooru, and booru.org adapters, and prevent `game/store.ts` from reusing seen image URLs when fresh batches arrive.
- **Limitless Scalable Watch Parties:** Remove the `party.members.size >= 8` hard cap in `watchparty.ts`, split the `watch.join` payload so heavy state snapshots (`frame`, `chat`, `queue`) are sent directly to the joiner instead of broadcasting to the entire room (preventing playback stutter for existing viewers), and introduce a 15-minute empty-room grace window in `removeMember` so temporary host reconnects do not wipe active watch parties.
- **Post Media Safety Gate:** Remove "Repost to Feed" actions from the idle clicker gallery and card context overlays, and enforce a URL boundary validator in `CreatePostModal` and `openCreatePostWithMedia` that rejects ephemeral booru and unhosted card URLs with a clear explanation.

**Tech Stack:** TypeScript, React 19, Electron, Hono / Bun WebSocket bus, Vitest, Node.js.

---

### Task 1: Eliminate Booru Feed Cache Lock and Expand Random Page Sampling

**Objective:** Prevent `createFetchBooru` from eagerly returning the same cached posts for 10 minutes on repeated queries, and widen pagination sampling in booru adapters so players pull from thousands of posts rather than 8 pages.

**Files:**
- Modify: `apps/desktop/electron/booruSources.cjs:21-28`
- Modify: `apps/desktop/electron/booru-sources-core.cjs:11-35`
- Modify: `apps/desktop/electron/main.cjs:1048-1062`
- Test: `apps/desktop/electron/booruSources.test.cjs`
- Test: `apps/desktop/electron/booru-sources.test.cjs`

**Step 1: Write failing test in `apps/desktop/electron/booruSources.test.cjs`**

Update `apps/desktop/electron/booruSources.test.cjs` to assert that `fetchBooru` fetches fresh provider posts when requested (or does not eagerly lock identical posts into the feed when new posts are needed):

```javascript
// apps/desktop/electron/booruSources.test.cjs
const assert = require('assert')
const { createFetchBooru } = require('./booruSources.cjs')

let providerCalls = 0
let pageQueried = -1
const sources = [
  {
    id: 'fake',
    category: 'hentai',
    fetch: async (variant, n, page) => {
      providerCalls += 1
      pageQueried = page
      return [{ id: `p_${providerCalls}`, url: `http://x/${providerCalls}.jpg`, tags: [variant], rating: 'e' }]
    },
  },
]

const memo = {}
const cache = {
  getFeedCache: (q) => {
    const hit = memo[String(q).trim().toLowerCase()]
    if (!hit) return null
    if (Date.now() - hit.ts >= 10 * 60 * 1000) { delete memo[String(q).trim().toLowerCase()]; return null }
    return hit.posts
  },
  setFeedCache: (q, posts) => {
    if (!Array.isArray(posts) || posts.length === 0) return
    memo[String(q).trim().toLowerCase()] = { posts, ts: Date.now() }
  },
}

async function main() {
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '', cache, queryVariants: (q) => [q] })

  // First call fetches from provider
  const first = await fetchBooru({ tags: 'alpha', limit: 10, fresh: true })
  assert.strictEqual(providerCalls, 1, 'first call hits provider')
  assert.strictEqual(first.posts[0].id, 'p_1')

  // When fresh: true is passed, must NOT return the identical cached batch
  const second = await fetchBooru({ tags: 'alpha', limit: 10, fresh: true })
  assert.strictEqual(providerCalls, 2, 'fresh: true queries provider again for fresh variety')
  assert.strictEqual(second.posts[0].id, 'p_2')

  console.log('booruSources: all assertions passed')
}

main().then(() => process.exit(0), (err) => { console.error('booruSources test FAILED:', err); process.exit(1) })
```

**Step 2: Run test to verify failure**

Run: `node apps/desktop/electron/booruSources.test.cjs`
Expected: FAIL — `second call must NOT re-hit the provider` / assertion fails on `providerCalls === 2`.

**Step 3: Implement minimal fix in `booruSources.cjs`, `booru-sources-core.cjs`, and `main.cjs`**

In `apps/desktop/electron/booruSources.cjs`:
```javascript
function createFetchBooru({ sources, httpGet, cache, blocked = () => false }) {
  let rrIndex = 0
  return async function fetchBooru({ tags, limit, allowReal, allowHentai, fresh = true }) {
    const query = String(tags ?? '').trim()
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    if (!query || blocked(query)) {
      return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
    }

    // ponytail: feed cache is only used as fallback if live providers fail or if explicitly requested not fresh
    const useReal = allowReal !== false
    const useHentai = allowHentai !== false
    const filtered = sources.filter((s) => {
      if (s.category === 'real' && !useReal) return false
      if (s.category === 'hentai' && !useHentai) return false
      return true
    })
    const pool = filtered.length > 0 ? filtered : sources
    const variants = queryVariants(query)
    const ordered = pool.map((_, i) => pool[(rrIndex + i) % pool.length])
    for (const source of ordered) {
      for (const variant of variants) {
        try {
          const posts = source.fetch
            ? await source.fetch(variant, n)
            : source.parse(await httpGet(source.url(variant, n)))
          if (posts && posts.length > 0) {
            rrIndex = (pool.indexOf(source) + 1) % pool.length
            cache?.setFeedCache?.(variant, posts)
            return { posts, source: source.id, ok: true, query: variant }
          }
        } catch {
          // try next variant / source
        }
      }
    }
    rrIndex = (rrIndex + 1) % pool.length

    // Live providers failed: fall back to RAM cache if available
    const memo = cache?.getFeedCache?.(query)
    if (memo && memo.length > 0) {
      return { posts: memo, source: 'cache', ok: true, query, cached: true }
    }

    return { posts: [], source: null, ok: false }
  }
}
```

In `apps/desktop/electron/booru-sources-core.cjs`:
Widen sampling from 8 pages to 100 pages, with fallback to page 0 if an empty page was hit:
```javascript
function dapiSource(id, base, { httpGet, parse, negatives }, category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n) => {
      // ponytail: sample across 100 pages to avoid image repetition; retry pid=0 if deep page is empty
      const pid = Math.floor(Math.random() * 100)
      const query = (variant + ' rating:explicit ' + negatives()).trim()
      const url = (p) => `${base}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(query)}&limit=${n}&json=1&pid=${p}`
      let posts = parse(await httpGet(url(pid)), base)
      if (posts.length === 0 && pid > 0) {
        posts = parse(await httpGet(url(0)), base)
      }
      return posts
    },
  }
}

function booruOrgSource(sub, { httpGet, parse }, id = sub.split('.')[0], category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n) => {
      // ponytail: sample up to 50 pages (1000 items) on booru.org subdomains
      const pid = Math.floor(Math.random() * 50) * 20
      const html = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=${pid}`)
      let posts = parse(html, variant).slice(0, n)
      if (posts.length === 0 && pid > 0) {
        const fallbackHtml = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=0`)
        posts = parse(fallbackHtml, variant).slice(0, n)
      }
      return posts
    },
  }
}
```

In `apps/desktop/electron/main.cjs`:
Update paheal page sampling:
```javascript
    fetch: async (variant, n) => {
      const tag = variant.split(/\s+/)[0]
      const page = 1 + Math.floor(Math.random() * 30)
      let xml = await httpGet(
        `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=${n}&page=${page}`
      )
      let posts = parsePahealXml(xml)
      if (posts.length === 0 && page > 1) {
        xml = await httpGet(
          `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=${n}&page=1`
        )
        posts = parsePahealXml(xml)
      }
      return posts
    },
```

**Step 4: Run test to verify pass**

Run: `node apps/desktop/electron/booruSources.test.cjs`
Expected: PASS — `booruSources: all assertions passed`.

**Step 5: Commit**

```bash
git add apps/desktop/electron/booruSources.cjs apps/desktop/electron/booruSources.test.cjs apps/desktop/electron/booru-sources-core.cjs apps/desktop/electron/main.cjs
git commit -m "fix(clicker): widen booru page sampling and use feed cache only as fallback"
```

---

### Task 2: Prevent Store Fallback to Known Images in Game Store

**Objective:** Ensure that when API returns duplicate posts that are filtered out as already seen, `store.ts` does not fall back to setting `usablePosts = posts`, which repeatedly shows the duplicate image.

**Files:**
- Modify: `apps/desktop/src/game/store.ts:980-990`
- Modify: `apps/desktop/src/services/booru.ts:208-215`
- Test: `apps/desktop/src/game/store.test.ts`

**Step 1: Write failing test in `apps/desktop/src/game/store.test.ts`**

In `apps/desktop/src/game/store.test.ts`, add a test asserting that if returned posts are already in `past` / `gallery` / `queue`, `store.fetchNext()` flags `feedEmptyFresh` and does NOT overwrite `current` with an already known post:

```typescript
it('does not recycle known posts into current when freshPosts is empty', async () => {
  const knownUrl = 'https://x/seen.jpg'
  useGame.setState({
    current: { id: 'p1', url: knownUrl, tags: ['tag1'], rating: 'e' },
    past: [{ id: 'p1', url: knownUrl, tags: ['tag1'], rating: 'e' }],
    ownedTags: ['tag1'],
  })
  mockedMulti.mockResolvedValueOnce({
    posts: [{ id: 'p1', url: knownUrl, tags: ['tag1'], rating: 'e' }],
    source: 'test',
    ok: true,
  })
  await useGame.getState().fetchNext()
  // Must not overwrite with the same knownUrl or should flag emptyFresh
  expect(useGame.getState().feedEmptyFresh || useGame.getState().queue.length === 0).toBe(true)
})
```

**Step 2: Run test to verify failure**

Run: `npx --prefix apps/desktop vitest run src/game/store.test.ts`
Expected: FAIL.

**Step 3: Implement minimal fix in `apps/desktop/src/game/store.ts`**

In `apps/desktop/src/game/store.ts` around line 987:
```typescript
      // Filter any post already known (queue/grid/past/gallery/current): never repeat
      const existingUrls = new Set([
        ...get().past.map((p) => p.url),
        ...get().gallery.map((g) => g.url),
        ...get().grid.map((c) => c.post.url),
        ...get().queue.map((p) => p.url),
        ...(get().current ? [get().current!.url] : []),
      ])
      const freshPosts = posts.filter((p) => !existingUrls.has(p.url))
      // ponytail: never fall back to known duplicate images; trigger emptyFresh instead so next poll retries fresh
      const usablePosts = freshPosts
      if (usablePosts.length === 0) {
        set({ feedEmptyFresh: true, fetching: false })
        return
      }
```

In `apps/desktop/src/services/booru.ts`:
Increase `RESHOW_AFTER_EMPTY` from `2` to `5` so momentary network delays do not immediately force `recallSeen()` repeat loops:
```typescript
const RESHOW_AFTER_EMPTY = 5
```

**Step 4: Run test to verify pass**

Run: `npx --prefix apps/desktop vitest run src/game/store.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/game/store.ts apps/desktop/src/services/booru.ts apps/desktop/src/game/store.test.ts
git commit -m "fix(clicker): reject recycled images when fresh posts are filtered out"
```

---

### Task 3: Remove the 8-Member Cap for Limitless Watch Party Entry

**Objective:** Allow unlimited concurrent members in watch parties by removing the `party.members.size >= 8` restriction from `watchparty.ts`.

**Files:**
- Modify: `apps/api/src/watchparty.ts:213-220`
- Modify: `docs/WATCH.md:67-75`
- Test: `apps/api/src/watchparty.test.ts`

**Step 1: Write failing test in `apps/api/src/watchparty.test.ts`**

In `apps/api/src/watchparty.test.ts`, add a test that joins 15 unique members to a party:

```typescript
it('allows limitless members to join without hitting the 8-person cap', () => {
  const p = createParty('Mega Room', '/v.mp4', '/v.mp4', undefined, 'host1')
  for (let i = 1; i <= 15; i++) {
    const res = joinWatch(`user_${i}`, `Viewer ${i}`, { party: p.id })
    expect(res).not.toBeNull()
  }
  expect(p.members.size).toBe(16) // host + 15 joiners
})
```

**Step 2: Run test to verify failure**

Run: `npx --prefix apps/api vitest run watchparty.test.ts`
Expected: FAIL — `joinWatch` returns `null` when `i == 8`.

**Step 3: Implement minimal fix in `apps/api/src/watchparty.ts`**

In `apps/api/src/watchparty.ts`:
```typescript
export function joinWatch(userId: string, displayName: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.bans.has(userId)) return null
  // ponytail: limitless party entry; no artificial member cap
  party.members.set(userId, { name: String(displayName || '').slice(0, 40), muted: party.members.get(userId)?.muted || false })
  party.lastSeen = Date.now()
  const room = partyRoom(party.id)
  const who = String(displayName || '').slice(0, 40) || userId.slice(0, 8)
  return { room, payload: [snapshotPayload(party), pushSystem(party, `${who} joined`)] }
}
```

Update `docs/WATCH.md` line 72 from `member (not banned, cap 8)` to `member (not banned, limitless)`.

**Step 4: Run test to verify pass**

Run: `npx --prefix apps/api vitest run watchparty.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/watchparty.ts docs/WATCH.md apps/api/src/watchparty.test.ts
git commit -m "feat(watchparty): remove 8-member cap for limitless party entry"
```

---

### Task 4: Fix 10% Breakage (Payload Partitioning and Empty-Room Reconnect Grace)

**Objective:** Stop broadcasting full snapshots to existing members on every join (which resets their player frames and freezes video playback), and prevent instantaneous party deletion when `party.members.size === 0` during host reconnects.

**Files:**
- Modify: `apps/api/src/watchparty.ts:48-58, 212-225, 244-258`
- Modify: `apps/api/src/ws-bus.ts:104-115`
- Test: `apps/api/src/watchparty.test.ts`

**Step 1: Write failing test in `apps/api/src/watchparty.test.ts`**

Add tests to verify:
1. `joinWatch` returns a direct snapshot for the joiner, plus a separate room announcement for others (not clobbering existing frames).
2. Temporary member disconnect (`members.size === 0`) does not immediately delete the party:

```typescript
it('does not immediately drop the party when the last member disconnects', () => {
  const p = createParty('Persist Room', '/v.mp4', '/v.mp4', undefined, 'u1')
  leaveWatch('u1', { party: p.id })
  expect(getParty(p.id)).not.toBeNull()
  expect(getParty(p.id)!.members.size).toBe(0)
})

it('partitions join response into snapshot for joiner and roster update for room', () => {
  const p = createParty('Room', '/v.mp4', '/v.mp4', undefined, 'host')
  const res = joinWatch('u2', 'Bob', { party: p.id })
  expect(res).not.toBeNull()
  // joinerPayload has snapshot, roomPayload has roster + system
  expect(res!.joinerPayload.type).toBe('watch.roster')
  expect(res!.joinerPayload.frame).toBeDefined()
  expect(Array.isArray(res!.roomPayload)).toBe(true)
  expect(res!.roomPayload[0].frame).toBeUndefined()
})
```

**Step 2: Run test to verify failure**

Run: `npx --prefix apps/api vitest run watchparty.test.ts`
Expected: FAIL.

**Step 3: Implement minimal fix in `apps/api/src/watchparty.ts` and `apps/api/src/ws-bus.ts`**

In `apps/api/src/watchparty.ts`:
Add `emptySince?: number` to `Party`. In `removeMember`:
```typescript
function removeMember(party: Party, userId: string, forceClose: boolean): { room: string; payload: any } | null {
  const who = party.members.get(userId)?.name || userId.slice(0, 8)
  party.members.delete(userId)
  const room = partyRoom(party.id)
  if (party.members.size === 0) {
    // ponytail: 15-minute empty grace period so reconnects and page reloads never wipe the room
    party.emptySince = Date.now()
    return { room, payload: [pushSystem(party, `${who} left`), rosterPayload(party)] }
  }
  if (party.hostId === userId) {
    party.hostId = party.members.keys().next().value || ''
  }
  void forceClose
  const payloads: any[] = [pushSystem(party, `${who} left`), rosterPayload(party)]
  return { room, payload: payloads }
}
```

In `gcTick()` in `watchparty.ts`:
```typescript
function gcTick(): void {
  const now = Date.now()
  const EMPTY_ROOM_GRACE_MS = 15 * 60 * 1000
  for (const [id, p] of parties) {
    if (p.members.size === 0 && p.emptySince && now - p.emptySince > EMPTY_ROOM_GRACE_MS) {
      dropParty(p)
    } else if (now - p.lastSeen > IDLE_MS) {
      dropParty(p)
    }
  }
  ...
```

Update `joinWatch` to return separate payloads:
```typescript
export function joinWatch(
  userId: string,
  displayName: string,
  msg: any,
): { room: string; joinerPayload: any; roomPayload: any[] } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.bans.has(userId)) return null
  party.emptySince = undefined
  party.members.set(userId, { name: String(displayName || '').slice(0, 40), muted: party.members.get(userId)?.muted || false })
  party.lastSeen = Date.now()
  const room = partyRoom(party.id)
  const who = String(displayName || '').slice(0, 40) || userId.slice(0, 8)
  return {
    room,
    joinerPayload: snapshotPayload(party),
    roomPayload: [rosterPayload(party), pushSystem(party, `${who} joined`)],
  }
}
```

In `apps/api/src/ws-bus.ts`:
```typescript
  if (msg.type === 'watch.join') {
    const res = joinWatch(conn.userId || '', (msg.name || '').slice(0, 40), msg)
    if (res) {
      // 1. Send full snapshot only to the joining connection
      conn.send(JSON.stringify(res.joinerPayload))
      // 2. Broadcast lightweight roster update to other members without clobbering their video frames
      conn.rooms.add(res.room)
      broadcastToRoom(res.room, res.roomPayload, conn) // exclude joining connection
    } else if (typeof msg.party === 'string') {
      conn.send(JSON.stringify({ type: 'watch.gone', party: msg.party }))
    }
    return
  }
```

In `ws-bus.ts`, support optional `excludeConn` in `broadcastToRoom`:
```typescript
export function broadcastToRoom(room: string, payload: unknown, excludeConn?: WsConn): void {
  const list = Array.isArray(payload) ? payload : [payload]
  for (const item of list) {
    const payloadStr = JSON.stringify(item)
    for (const c of conns) {
      if (c !== excludeConn && c.rooms.has(room)) c.send(payloadStr)
    }
  }
}
```

**Step 4: Run test to verify pass**

Run: `npx --prefix apps/api vitest run watchparty.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/watchparty.ts apps/api/src/ws-bus.ts apps/api/src/watchparty.test.ts
git commit -m "fix(watchparty): payload partitioning on join and empty-room reconnect grace"
```

---

### Task 5: Watch Relay Range Headers and Stream Cacheability

**Objective:** Support concurrent peer streaming of relayed videos by allowing public chunk caching (`Cache-Control: public, max-age=300`) and tolerant Range header parsing.

**Files:**
- Modify: `apps/api/src/routes/watchparty.ts:435-464`
- Test: `apps/api/src/watchparty-relay.test.ts`

**Step 1: Write failing test in `apps/api/src/watchparty-relay.test.ts`**

Add a test verifying that `Cache-Control` is cacheable for relays and that suffix / whitespace Range headers succeed:

```typescript
it('returns public cache header and parses Range with trailing spaces', async () => {
  const res = await app.request(`/api/watchparty/${partyId}/stream`, { headers: { Range: 'bytes=0-15 ' } }, env)
  expect(res.status).toBe(206)
  expect(res.headers.get('cache-control')).toContain('public')
})
```

**Step 2: Run test to verify failure**

Run: `npx --prefix apps/api vitest run watchparty-relay.test.ts`
Expected: FAIL.

**Step 3: Implement minimal fix in `apps/api/src/routes/watchparty.ts`**

In `apps/api/src/routes/watchparty.ts`:
```typescript
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Referer: relay.referer }
  const rawRange = c.req.header('Range')?.trim()
  if (rawRange && /^bytes=\s*[\d-]+\s*$/.test(rawRange)) headers.Range = rawRange

  const ctl = new AbortController()
  const headerTimer = setTimeout(() => ctl.abort(), 15_000)
  let up: Response
  try {
    up = await fetch(relay.upstream, { headers, redirect: 'follow', signal: ctl.signal })
  } catch {
    clearTimeout(headerTimer)
    return c.json({ error: 'Upstream unreachable' }, 502)
  }
  clearTimeout(headerTimer)
  if (!up.ok && up.status !== 206) return c.json({ error: 'Upstream refused' }, 502)
  const out = new Headers()
  const ct = up.headers.get('content-type')
  if (ct) out.set('Content-Type', ct)
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h)
    if (v) out.set(h, v)
  }
  // ponytail: 5min public cache enables multiple viewers to share chunks without upstream bottleneck
  out.set('Cache-Control', 'public, max-age=300')
  out.set('Access-Control-Allow-Origin', '*')
  return new Response(up.body, { status: up.status, headers: out })
```

**Step 4: Run test to verify pass**

Run: `npx --prefix apps/api vitest run watchparty-relay.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/routes/watchparty.ts apps/api/src/watchparty-relay.test.ts
git commit -m "perf(watchparty): cacheable relay stream chunks and tolerant range headers"
```

---

### Task 6: Prevent Broken Images from Clicker Game and Cards in Posts

**Objective:** Remove "Repost to feed" CTAs from the clicker game (GridWorkspace, IdleGalleryView) and cards context menu, and add a safety check in `CreatePostModal` and `openCreatePostWithMedia` to reject booru and card URLs with a helpful notification.

**Files:**
- Modify: `apps/desktop/src/components/grid/IdleGalleryView.tsx:599-612, 836-848`
- Modify: `apps/desktop/src/components/grid/GridWorkspace.tsx:38-54`
- Modify: `apps/desktop/src/components/ContextOverlay.tsx:258-276`
- Modify: `apps/desktop/src/App.tsx:243-255, 3736-3745`
- Modify: `apps/desktop/src/components/feed/CreatePostModal.tsx:165-175`
- Test: `apps/desktop/src/components/grid/IdleGalleryView.test.tsx`
- Test: `apps/desktop/src/components/feed/CreatePostModal.test.tsx`

**Step 1: Write failing tests**

In `apps/desktop/src/components/grid/IdleGalleryView.test.tsx`:
Update test to verify "Repost to feed" button does not render for clicker game images.

In `apps/desktop/src/components/feed/CreatePostModal.test.tsx`:
Add test asserting that entering a booru or card URL displays a warning toast and refuses to attach:

```typescript
it('rejects clicker booru URLs and card URLs with warning toast', async () => {
  const toast = vi.fn()
  render(<CreatePostModal identity={identity} onClose={() => {}} toast={toast} />)
  const input = screen.getByPlaceholderText(/paste image or video link/i)
  fireEvent.change(input, { target: { value: 'https://realbooru.com/images/123/abc.jpg' } })
  fireEvent.click(screen.getByRole('button', { name: /attach/i }))
  expect(toast).toHaveBeenCalledWith(
    expect.stringMatching(/idle clicker or card images cannot be used/i),
    'warning'
  )
})
```

**Step 2: Run test to verify failure**

Run: `npx --prefix apps/desktop vitest run src/components/feed/CreatePostModal.test.tsx`
Expected: FAIL.

**Step 3: Implement minimal fix**

1. In `apps/desktop/src/components/grid/IdleGalleryView.tsx`:
Remove the `onRepostImage` buttons in the context menu and viewer modal:
- Delete lines 599-612 (context menu Repost to feed button).
- Delete lines 836-848 (viewer modal Repost to feed button).
Remove `onRepostImage` from `IdleGalleryViewProps`.

2. In `apps/desktop/src/components/grid/GridWorkspace.tsx`:
Remove `onRepostImage` from props and calls to `IdleGalleryView`.

3. In `apps/desktop/src/App.tsx`:
In `openCreatePostWithMedia`:
```typescript
  const isClickerOrCardMedia = (url: string) => {
    return (
      /realbooru|tbib|xbooru|paheal|booru\.org|konachan|yande\.re|redgifs|gmcache:|\/booru\//i.test(url) ||
      /card_/i.test(url) ||
      url.startsWith('gmcache:')
    )
  }

  const openCreatePostWithMedia = useCallback((media: { url: string; tags?: string[]; name?: string }) => {
    if (isClickerOrCardMedia(media.url)) {
      toast('Images from the clicker game or cards cannot be used in posts as external links break.', 'warning')
      return
    }
    setCreatePostInitialData({
      mediaList: [{
        id: 'repost_' + Math.random().toString(36).substring(2, 9),
        previewUrl: media.url,
        isExternalUrl: /^https?:\/\//i.test(media.url),
      }],
      tags: Array.isArray(media.tags) ? media.tags.slice(0, 5).join(' ') : '',
      caption: media.name ? `Repost: ${media.name}` : '',
    });
    setShowCreatePostModal(true);
  }, [toast]);
```
And remove `onRepostImage={openCreatePostWithMedia}` from `<GridWorkspace />` in line 3739.

4. In `apps/desktop/src/components/ContextOverlay.tsx`:
Do not render "Repost to Feed" if `resolved` or `item` is a card or booru image:
```typescript
  const isExcludedFromPost = /realbooru|tbib|xbooru|paheal|booru\.org|konachan|yande\.re|card_/i.test(resolved || '')
  ...
  {onRepostImage && !isExcludedFromPost && (
    <button ...>Repost to Feed</button>
  )}
```

5. In `apps/desktop/src/components/feed/CreatePostModal.tsx`:
In `handleAddUrl`:
```typescript
  if (/realbooru|tbib|xbooru|paheal|booru\.org|konachan|yande\.re|gmcache:|\/booru\//i.test(raw)) {
    toast?.('Idle clicker or card images cannot be used in posts because external hosts break.', 'warning');
    return;
  }
```

**Step 4: Run tests to verify pass**

Run:
`npx --prefix apps/desktop vitest run src/components/grid/IdleGalleryView.test.tsx`
`npx --prefix apps/desktop vitest run src/components/feed/CreatePostModal.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/grid/IdleGalleryView.tsx apps/desktop/src/components/grid/GridWorkspace.tsx apps/desktop/src/components/ContextOverlay.tsx apps/desktop/src/App.tsx apps/desktop/src/components/feed/CreatePostModal.tsx apps/desktop/src/components/grid/IdleGalleryView.test.tsx apps/desktop/src/components/feed/CreatePostModal.test.tsx
git commit -m "fix(feed): prevent broken clicker and card images from entering post creation"
```

---

### Risks, Tradeoffs, and Open Questions

1. **Tradeoff (Booru Page Randomization):**
   - Sampling up to page 100 on booru DAPIs occasionally hits pages beyond the tag's total count for narrow tags. The fallback mechanism (`pid > 0` and empty posts -> retry `pid = 0`) guarantees that narrow tags with only 1-2 pages still return valid images on the second attempt without error.
2. **Performance (Limitless Watch Party Scaling):**
   - Broadcasting lightweight roster updates instead of full state snapshots (`frame`, `queue`, `chat`) reduces O(N^2) payload traffic to O(N) tiny roster frames.
   - For parties with hundreds of viewers, relay streaming should be cached (`Cache-Control: public, max-age=300`) to prevent Bun/Node from opening hundreds of identical upstream sockets.
3. **User Intent on Post Images:**
   - Disallowing reposting of clicker/card media directly into feed posts protects timeline integrity from 403 hotlink errors and missing local files. Users can still upload local photos or videos via file upload or camera.
