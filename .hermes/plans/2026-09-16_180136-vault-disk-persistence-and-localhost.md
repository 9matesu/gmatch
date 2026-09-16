# Vault: disk persistence for GIF/MP4 + localhost serving

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Every Clicker keep (image, GIF, MP4) lands on disk in the vault exactly once, is served from disk on demand, and is openable in a browser at a localhost address.

**Architecture:** The vault already exists and already stores bytes on disk (`electron/vault.cjs`, `<userData>/media-vault/<sha256>.<ext>`, manifest.json, 3GB LRU, `vault://` scheme with Range). `store.ts:455` already calls `vaultPin` on every keep. So this is not a rewrite — it is four defects on an existing path: a byte-cap that silently drops large MP4s, a possible unregistered privileged scheme, a missing negative cache that re-fetches failed URLs every render, and no HTTP surface for the "open in a browser" requirement. RAM (`imageCache.cjs` → `gmcache://`) stays for non-vault users but stops being the preferred source for clicker media.

**Tech Stack:** Electron main process (CommonJS), Node 18+ (`Request`/`Response`/`Readable.fromWeb` globals), React renderer, plain-node assertion tests (`node electron/*.test.cjs`), Vitest for renderer tests.

---

## Current context / assumptions

Read these before editing. Line numbers are from the current tree.

- `I:/goongrid/apps/desktop/electron/vault.cjs` (290 lines) — the vault. Relevant:
  - `MAX_SINGLE_BYTES = 25 * 1024 * 1024` (line 15), `MAX_SINGLE_VIDEO_BYTES = 200 * 1024 * 1024` (line 19).
  - `pin()` lines 164-168: `const cap = String(mime || '').startsWith('video/') ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES`.
  - `serveVault(request)` lines 227-275 — takes a `Request`, returns a `Response`, already implements Range/206. **This is reused by Task 4, not rewritten.**
  - `module.exports` lines 277-290.
- `I:/goongrid/apps/desktop/electron/imageCache.cjs` (363 lines) — RAM cache. Relevant:
  - `MAX_SINGLE_VIDEO_BYTES = 200MB` (line 24), `MAX_SINGLE_BYTES = 25MB` (line 21).
  - `fetchBinary()` lines 95-187. **Two cap call sites**, line 132 (`cap = /^video\//i.test(type) ? …`) and line 173 (same rule).
  - MIME gate at lines 125-127 and 164-166: accepts `image/*` or `video/*`, or `octet-stream` **when the URL has a media extension**.
- `I:/goongrid/apps/desktop/electron/main.cjs` — `protocol.registerSchemesAsPrivileged` at line 121. The visible array entry is `imageCache.SCHEME` (`gmcache`). **Whether `vault.SCHEME` is also registered is UNVERIFIED** — Task 2 resolves it.
- `I:/goongrid/apps/desktop/electron/vault.test.cjs` (127 lines) — the test style to copy: plain `node`, `assert`, `main().then(ok, fail)`, `console.log('vault: all assertions passed')`, run with `node electron/vault.test.cjs`.
- `I:/goongrid/apps/desktop/src/services/vault.ts` — renderer bridge. `sessionPinned` at line 32, `vaultPin` lines 45-55. `vaultOptIn()` reads `localStorage['goonmatch-settings'].localVault`.
- `I:/goongrid/apps/desktop/src/game/store.ts:455` — `if (img.url) void vaultPin(img.url)` inside `gallerySpoils`. Fires on every KO. Already correct.
- `I:/goongrid/apps/desktop/src/App.tsx:2595-2620` — backfill effect: pins `idleGallery`, `myCards`, and `feedPosts` (through `resolveMediaUrl`) when `settings.localVault` is on.
- `I:/goongrid/apps/desktop/src/hooks/useSettings.ts:113` — `localVault: false` (opt-in).

**The defect that explains "MP4s aren't saved" (verified by reading, not guessed):** `fetchBinary` and `pin` choose the byte cap from the **response MIME**. A host serving an MP4 as `application/octet-stream` passes the MIME gate (the URL ends in `.mp4`) but then gets the **25MB image cap** instead of the 200MB video cap — a 40MB clip throws `file too large`, `pin()` swallows it and returns `null`, and nothing is written. This is the most likely cause and Task 1 fixes it.

**Assumption to verify in Task 2, not assume:** that `vault.SCHEME` is registered in `registerSchemesAsPrivileged`. If it is not, `vault://` URLs are unloadable in a sandboxed renderer regardless of everything else.

---

## Step-by-step tasks

### Task 1: A large octet-stream MP4 must pin (byte-cap by MIME **or** extension)

**Objective:** Stop silently dropping videos whose host mislabels the content type.

**Files:**
- Modify: `I:/goongrid/apps/desktop/electron/imageCache.cjs`
- Modify: `I:/goongrid/apps/desktop/electron/vault.cjs`
- Test: `I:/goongrid/apps/desktop/electron/vault.test.cjs`

**Step 1: Write the failing test**

Append to `vault.test.cjs`, immediately before `fs.rmSync(tmp, { recursive: true, force: true })` (currently line 117):

```js
  // A host serving an MP4 as application/octet-stream must still get the
  // VIDEO cap, not the 25MB image cap: /^video\//i fails on octet-stream, the
  // 40MB buffer then hit the image ceiling, pin() returned null and the clip
  // was never written. Cap by MIME *or* URL extension.
  vault._test.setFetcher(async () => ({ buf: Buffer.alloc(40 * 1024 * 1024, 9), mime: 'application/octet-stream' }))
  const mislabeled = await vault.pin('https://x/mislabeled.mp4')
  assert.ok(mislabeled, '40MB octet-stream mp4 must pin under the video cap')
  assert.strictEqual(vault.get('https://x/mislabeled.mp4'), mislabeled)
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && node electron/vault.test.cjs; echo "EXIT=$?"
```

Expected: **FAIL** — `AssertionError: 40MB octet-stream mp4 must pin under the video cap`, `EXIT=1`.

**Step 3: Add the shared cap helper**

In `I:/goongrid/apps/desktop/electron/imageCache.cjs`, directly above `async function fetchBinary` (currently line 95), insert:

```js
/**
 * Byte ceiling for a fetched buffer. Videos get the big cap; everything else
 * the small one. The response MIME is the primary signal, but hosts routinely
 * serve mp4s as application/octet-stream — trusting only the MIME gave a 40MB
 * clip the 25MB image cap, and it was dropped instead of stored.
 */
function capFor(mime, url) {
  const isVideo =
    /^video\//i.test(String(mime || '')) ||
    /\.(mp4|webm|mov|mkv|gifv)(?:[?#]|$)/i.test(String(url || ''))
  return isVideo ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES
}
```

Replace the two existing cap computations inside `fetchBinary` with this helper. The electron path (around line 132):

```js
      const cap = capFor(type, url)
      if (buf.length > cap) {
        throw new Error('file too large')
      }
```

The node path (around line 173, inside `res.on('data')`):

```js
          const cap = capFor(type, url)
          if (size > cap) {
```

Then add `capFor` to the exports. In the `module.exports` block at the bottom of `imageCache.cjs`, inside `_test`, add `capFor` as a key:

```js
  _test: { fnv1a, cacheFileName, normalizeQuery, destroyDiskCaches, capFor },
```

**Step 4: Use it in `vault.cjs` too**

In `I:/goongrid/apps/desktop/electron/vault.cjs`, replace line 166:

```js
    const cap = String(mime || '').startsWith('video/') ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES
```

with:

```js
    const cap = imageCache.capFor(mime, url)
```

`imageCache` is already required at line 11. The `MAX_SINGLE_VIDEO_BYTES` / `MAX_SINGLE_BYTES` constants stay (they are still read by `capFor`).

**Step 5: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && node electron/vault.test.cjs; echo "EXIT=$?"
```

Expected: **`vault: all assertions passed`**, `EXIT=0`.

**Step 6: Run the RAM-cache test too**

```bash
cd I:/goongrid/apps/desktop && node electron/imageCacheMemory.test.cjs; echo "EXIT=$?"
```

Expected: `EXIT=0`. If this file does not exist, skip — do not create it.

**Step 7: Commit**

```bash
cd I:/goongrid && git add apps/desktop/electron/imageCache.cjs apps/desktop/electron/vault.cjs apps/desktop/electron/vault.test.cjs && git commit -m "fix(vault): cap by MIME or URL extension so mislabeled mp4s persist"
```

---

### Task 2: Confirm the `vault` scheme is privileged (and register it if not)

**Objective:** Guarantee `vault://` is loadable by the renderer.

**Files:**
- Modify: `I:/goongrid/apps/desktop/electron/main.cjs` (only if the check fails)
- Test: `I:/goongrid/apps/desktop/electron/vault-scheme.test.cjs` (create)

**Step 1: Read the registration block**

```bash
cd I:/goongrid/apps/desktop && sed -n '115,140p' electron/main.cjs
```

If the array already contains a second entry with `scheme: vault.SCHEME`, **stop here — Task 2 is already satisfied, skip to Task 3.** If it does not, continue.

**Step 2: Write the failing test**

Create `I:/goongrid/apps/desktop/electron/vault-scheme.test.cjs`:

```js
// node vault-scheme.test.cjs — exits 1 on failure (plain-node style).
// vault:// must be registered as a privileged scheme BEFORE app ready, or a
// sandboxed renderer cannot load it and every stored keep renders blank.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const block = src.slice(src.indexOf('registerSchemesAsPrivileged'), src.indexOf('registerSchemesAsPrivileged') + 900)

assert.ok(
  block.includes('vault.SCHEME') || block.includes("scheme: 'vault'") || block.includes('scheme: "vault"'),
  'vault scheme must be in registerSchemesAsPrivileged',
)
console.log('vault-scheme: assertion passed')
```

**Step 3: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && node electron/vault-scheme.test.cjs; echo "EXIT=$?"
```

Expected: **`AssertionError: vault scheme must be in registerSchemesAsPrivileged`**, `EXIT=1`.

**Step 4: Register the scheme**

In `main.cjs`, inside the array passed to `protocol.registerSchemesAsPrivileged`, add a sibling entry next to the existing `imageCache.SCHEME` one:

```js
  {
    scheme: vault.SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  },
```

`vault` is already required in this file (it is used at line 1279/1281). If it is not required at the top, add `const vault = require('./vault.cjs')` next to the `imageCache` require.

**Step 5: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && node electron/vault-scheme.test.cjs; echo "EXIT=$?"
```

Expected: **`vault-scheme: assertion passed`**, `EXIT=0`.

**Step 6: Commit**

```bash
cd I:/goongrid && git add apps/desktop/electron/main.cjs apps/desktop/electron/vault-scheme.test.cjs && git commit -m "fix(vault): register the vault scheme as privileged"
```

If Step 1 showed the scheme already registered, commit nothing and say so in the final report.

---

### Task 3: Remember failed pins for the session (one fetch per URL, not one per render)

**Objective:** Stop re-fetching a URL the host refuses, on every feed update.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/services/vault.ts`
- Test: `I:/goongrid/apps/desktop/src/services/vault.test.ts` (create)

**Step 1: Write the failing test**

Create `I:/goongrid/apps/desktop/src/services/vault.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A URL the host refuses must be remembered as failed for the session: the
// App backfill effect re-runs on every feed update, and without a negative
// cache the same dead URL is re-fetched on each pass.
describe('vaultPin negative cache', () => {
  const bridge = { vaultGet: vi.fn(async () => ({ local: null })), vaultPin: vi.fn(async () => ({ local: null })) }

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.setItem('goonmatch-settings', JSON.stringify({ localVault: true }))
    ;(window as unknown as { gmatch: unknown }).gmatch = bridge
    const mod = await import('./vault')
    mod._resetSessionGuards()
  })

  it('does not re-call the bridge for a URL that already failed', async () => {
    const { vaultPin } = await import('./vault')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    expect(bridge.vaultPin).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/services/vault.test.ts 2>&1 | tail -20
```

Expected: **FAIL** — `expected "spy" to be called 1 times, but got 3 times` (and likely `_resetSessionGuards is not a function` first; that is also a valid RED, proceed).

**Step 3: Add the negative cache**

In `I:/goongrid/apps/desktop/src/services/vault.ts`, next to `sessionPinned` (line 32), add:

```ts
// Failed pins are remembered for the session too: the App backfill effect
// re-runs on every feed update, and without this a URL the host refuses is
// re-fetched on every pass. A transient failure therefore does not retry until
// the next app launch — accepted, because the alternative is a fetch storm.
// ponytail: session-scoped negative cache; add a TTL if a flaky host matters.
const sessionFailed = new Set<string>()
```

In `vaultPin` (lines 45-55), change the body to check and populate it:

```ts
export async function vaultPin(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  if (sessionFailed.has(url)) return null
  try {
    if (sessionPinned.has(url)) return vaultGet(url)
    const res = await window.gmatch?.vaultPin?.(url)
    if (res?.local) sessionPinned.add(url)
    else sessionFailed.add(url)
    return res?.local ?? null
  } catch {
    sessionFailed.add(url)
    return null
  }
}
```

Then add the test seam at the bottom of the file:

```ts
/** Test seam: clear both session guards. */
export function _resetSessionGuards(): void {
  sessionPinned.clear()
  sessionFailed.clear()
}
```

**Step 4: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/services/vault.test.ts 2>&1 | tail -12
```

Expected: **1 passed**.

**Step 5: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/services/vault.ts apps/desktop/src/services/vault.test.ts && git commit -m "fix(vault): negative-cache failed pins so the backfill stops re-fetching"
```

---

### Task 3b: One provider call per query — read the feed cache `fetchBooru` already writes

**Objective:** Stop re-querying the booru providers for a query whose posts are already cached.

**Why this exists (verified, not assumed):** `main.cjs:1126` `fetchBooru` calls `imageCache.setFeedCache(variant, posts)` at line 1153 on every successful fetch, but the comment at lines 1140-1142 says the cache "survives only as a write-once store" — and `getFeedCache` appears **zero** times in `main.cjs`. The cache is written, fills up, and is never read: every round re-hits the providers. The renderer compounds it — `store.ts:962` calls `fetchPostsMulti` with up to 4 tags, each of which runs its own `fetchBooru` (IPC) and walks the full source × variant ladder (`main.cjs:1145-1160`).

**Files:**
- Create: `I:/goongrid/apps/desktop/electron/booruSources.cjs`
- Modify: `I:/goongrid/apps/desktop/electron/main.cjs` (lines ~1116-1163)
- Test: `I:/goongrid/apps/desktop/electron/booruSources.test.cjs` (create)

**Step 1: Write the failing test**

Create `I:/goongrid/apps/desktop/electron/booruSources.test.cjs`:

```js
// node booruSources.test.cjs — exits 1 on failure (plain-node style).
// A query whose posts are cached must NOT reach a provider a second time.
const assert = require('assert')
const { createFetchBooru } = require('./booruSources.cjs')

let providerCalls = 0
const sources = [
  {
    id: 'fake',
    category: 'hentai',
    fetch: async () => { providerCalls += 1; return [{ id: 'p1', url: 'http://x/1.jpg', tags: ['a'], rating: 'e' }] },
  },
]

// Minimal in-memory stand-in for imageCache's feed memo (same shape).
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

  const first = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.strictEqual(providerCalls, 1, 'first call hits the provider once')
  assert.ok(first.posts.length === 1)
  assert.ok(!first.cached, 'first call is not marked cached')

  const second = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.strictEqual(providerCalls, 1, 'second call must NOT re-hit the provider')
  assert.ok(second.posts.length === 1, 'cached posts returned')
  assert.strictEqual(second.cached, true, 'cached verdict is flagged')

  fs_cleanup()
  console.log('booruSources: all assertions passed')
}

function fs_cleanup() { /* no temp files in this test */ }

main().then(() => process.exit(0), (err) => { console.error('booruSources test FAILED:', err); process.exit(1) })
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && node electron/booruSources.test.cjs; echo "EXIT=$?"
```

Expected: **FAIL** — `Cannot find module './booruSources.cjs'`, `EXIT=1`.

**Step 3: Extract `fetchBooru` and add the cache read**

Create `I:/goongrid/apps/desktop/electron/booruSources.cjs`. Move the `queryVariants` function and the `fetchBooru` body out of `main.cjs` **verbatim**, then wrap them in a factory that takes its dependencies (so the ladder is testable without booting Electron):

```js
// Provider query ladder for the idle feed, extracted from main.cjs so the
// cache-read path is testable without booting Electron. Pure orchestration:
// sources, httpGet and the feed memo are all injected.
function queryVariants(query) {
  const parts = String(query).split(/\s+/).filter(Boolean)
  const variants = [query]
  if (parts.length > 2) variants.push(parts.slice(0, 2).join(' '))
  if (parts.length > 1) variants.push(parts[0])
  return [...new Set(variants)]
}

function createFetchBooru({ sources, httpGet, cache, blocked = () => false }) {
  let rrIndex = 0
  return async function fetchBooru({ tags, limit, allowReal, allowHentai }) {
    const query = String(tags ?? '').trim()
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    if (!query || blocked(query)) {
      return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
    }

    // READ the memo fetchBooru already writes. Without this the store is
    // write-only: every round re-queries the providers for a query whose posts
    // are already in hand. Cached posts skip the network entirely.
    const memo = cache.getFeedCache(query)
    if (memo && memo.length > 0) {
      return { posts: memo, source: 'cache', ok: true, query, cached: true }
    }

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
          if (posts.length > 0) {
            rrIndex = (pool.indexOf(source) + 1) % pool.length
            cache.setFeedCache(variant, posts)
            return { posts, source: source.id, ok: true, query: variant }
          }
        } catch {
          /* try next variant / source */
        }
      }
    }
    rrIndex = (rrIndex + 1) % pool.length
    return { posts: [], source: null, ok: false }
  }
}

module.exports = { createFetchBooru, queryVariants }
```

The `source.category` filter and the `source.url`/`source.parse` shape must match what `main.cjs` currently has — copy them from lines 1132-1150 rather than retyping.

**Step 4: Wire it in `main.cjs`**

At the top of `main.cjs`, next to the `imageCache` require:

```js
const { createFetchBooru } = require('./booruSources.cjs')
```

Delete the now-duplicated `queryVariants` (lines 1116-1122) and `fetchBooru` (lines 1126-1163) from `main.cjs`, and replace them with a single construction after `SOURCES` is defined:

```js
const fetchBooru = createFetchBooru({
  sources: SOURCES,
  httpGet,
  cache: imageCache,
  blocked: isQueryBlocked,
})
```

`ipcMain.handle('booru:fetch', …)` at line 1283 needs no change — it already calls `fetchBooru`.

**Step 5: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && node electron/booruSources.test.cjs; echo "EXIT=$?"
```

Expected: **`booruSources: all assertions passed`**, `EXIT=0`.

**Step 6: Confirm the app still boots and the feed still fills**

```bash
cd I:/goongrid/apps/desktop && npx electron . 2>&1 | head -20
```

Expected: the app window opens; no `Cannot find module './booruSources.cjs'`. Open the Clicker and confirm foes appear (the feed path is unchanged except for the cache read).

**Step 7: Commit**

```bash
cd I:/goongrid && git add apps/desktop/electron/booruSources.cjs apps/desktop/electron/booruSources.test.cjs apps/desktop/electron/main.cjs && git commit -m "fix(idle): read the feed cache fetchBooru writes (one provider call per query)"
```

**Known ceiling:** the memo has a 10-minute TTL (`FEED_TTL_MS`) and a 40-query cap, so a query older than 10 minutes re-queries. That is deliberate — a stale list must refresh. The guarantee is "one provider call per query per 10 minutes", not "forever". Marked in the existing `ponytail:` comment at `imageCache.cjs:25`.

---

### Task 4: Serve the vault on localhost

**Objective:** A pinned file is reachable at an `http://127.0.0.1:<port>/f/<key>` address.

**Files:**
- Create: `I:/goongrid/apps/desktop/electron/vaultServer.cjs`
- Test: `I:/goongrid/apps/desktop/electron/vaultServer.test.cjs`

**Step 1: Write the failing test**

Create `I:/goongrid/apps/desktop/electron/vaultServer.test.cjs`:

```js
// node vaultServer.test.cjs — exits 1 on failure (plain-node style).
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vault = require('./vault.cjs')
const vaultServer = require('./vaultServer.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-http-'))
vault.init(tmp)
vault._test.setFetcher(async () => ({ buf: Buffer.from('HTTPBODY', 'utf8'), mime: 'image/png' }))

async function main() {
  const local = await vault.pin('https://x/http.png')
  assert.ok(local, 'pin succeeded')

  const { origin } = await vaultServer.start(tmp, { port: 0 })
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, `localhost origin, got ${origin}`)

  const key = local.split('/').pop()
  const res = await fetch(`${origin}/f/${key}`)
  assert.strictEqual(res.status, 200, 'served over http')
  assert.strictEqual(res.headers.get('content-type'), 'image/png')
  assert.strictEqual(await res.text(), 'HTTPBODY')

  const ranged = await fetch(`${origin}/f/${key}`, { headers: { Range: 'bytes=0-3' } })
  assert.strictEqual(ranged.status, 206, 'range served')
  assert.strictEqual(await ranged.text(), 'HTTP')

  const miss = await fetch(`${origin}/f/deadbeef.png`)
  assert.strictEqual(miss.status, 404)

  await vaultServer.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('vaultServer: all assertions passed')
}

main().then(() => process.exit(0), (err) => { console.error('vaultServer test FAILED:', err); process.exit(1) })
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && node electron/vaultServer.test.cjs; echo "EXIT=$?"
```

Expected: **FAIL** — `Cannot find module './vaultServer.cjs'`, `EXIT=1`.

**Step 3: Write the server**

Create `I:/goongrid/apps/desktop/electron/vaultServer.cjs`:

```js
// Localhost HTTP surface for the on-disk vault. The in-app renderer uses
// vault://, but a browser tab (or any tool outside Electron) cannot speak a
// custom scheme — it needs a real http origin. This reuses vault.serveVault
// wholesale rather than re-implementing Range, MIME lookup and traversal
// checks a second time.
//
// Bind is 127.0.0.1 only and the port is OS-assigned: the vault holds adult
// media and must not be reachable from the LAN. Keys are sha256 hashes, so a
// path is not guessable — but any local process that learns the key can read
// the file.
// ponytail: no auth on the local origin; add a token in the URL if a hostile
// local process becomes part of the threat model.
const http = require('http')
const { Readable } = require('stream')
const vault = require('./vault.cjs')

let server = null
let origin = ''

async function start(_vaultDir, { host = '127.0.0.1', port = 0 } = {}) {
  if (server) return { origin }
  server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${host}`)
      if (!u.pathname.startsWith('/f/')) {
        res.writeHead(404).end('not found')
        return
      }
      const out = await vault.serveVault(
        new Request(`vault://f/${u.pathname.slice(3)}`, {
          headers: req.headers.range ? { range: req.headers.range } : {},
        }),
      )
      const headers = Object.fromEntries(out.headers)
      res.writeHead(out.status, headers)
      if (out.body) Readable.fromWeb(out.body).pipe(res)
      else res.end(Buffer.from(await out.arrayBuffer()))
    } catch {
      res.writeHead(500).end('vault http error')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  origin = `http://${host}:${server.address().port}`
  return { origin }
}

async function stop() {
  if (!server) return
  await new Promise((resolve) => server.close(resolve))
  server = null
  origin = ''
}

/** localhost URL for a stored vault:// URL, or null when it is not stored. */
function httpUrl(vaultUrl) {
  if (!origin || !vaultUrl || !String(vaultUrl).startsWith('vault://f/')) return null
  return `${origin}/f/${String(vaultUrl).split('/').pop()}`
}

module.exports = { start, stop, httpUrl, origin: () => origin }
```

**Step 4: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && node electron/vaultServer.test.cjs; echo "EXIT=$?"
```

Expected: **`vaultServer: all assertions passed`**, `EXIT=0`.

**Step 5: Commit**

```bash
cd I:/goongrid && git add apps/desktop/electron/vaultServer.cjs apps/desktop/electron/vaultServer.test.cjs && git commit -m "feat(vault): serve stored bytes on a localhost http origin"
```

---

### Task 5: Start the server and expose the localhost URL to the renderer

**Objective:** The app boots the server and can hand out a browser-openable address.

**Files:**
- Modify: `I:/goongrid/apps/desktop/electron/main.cjs`
- Modify: `I:/goongrid/apps/desktop/electron/preload.cjs`
- Modify: `I:/goongrid/apps/desktop/src/types/gmatch-bridge.ts`

**Step 1: Start it in `main.cjs`**

`main.cjs` calls `vault.init(app.getPath('userData'))` and `protocol.handle(vault.SCHEME, …)` around lines 1279-1281. Immediately after that line, add:

```js
  // Localhost surface for the on-disk vault (see vaultServer.cjs).
  require('./vaultServer.cjs').start(app.getPath('userData')).catch(() => {
    /* no http surface: the in-app vault:// path still works */
  })
```

Add the require next to the other top-level requires: `const vaultServer = require('./vaultServer.cjs')` — and use `vaultServer.start(...)` so the module is loaded once.

**Step 2: Add the IPC handle**

In the same `ipcMain.handle` cluster (next to `ipcMain.handle('vault:get', …)`), add:

```js
  ipcMain.handle('vault:http-url', (_event, url) => ({ local: vaultServer.httpUrl(String(url ?? '')) }))
```

**Step 3: Expose it in `preload.cjs`**

In the `contextBridge.exposeInMainWorld('gmatch', { … })` block, next to the existing vault entries, add:

```js
  vaultHttpUrl: (url) => ipcRenderer.invoke('vault:http-url', url),
```

**Step 4: Type it**

In `I:/goongrid/apps/desktop/src/types/gmatch-bridge.ts`, below `vaultClear?:` (line 28), add:

```ts
  /** localhost http URL for a stored vault:// URL (browser-openable), else null. */
  vaultHttpUrl?: (url: string) => Promise<{ local: string | null }>
```

**Step 5: Verify the bridge is intact**

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit; echo "TSC=$?"
```

Expected: `TSC=0`.

If this fails because `vaultGet`/`vaultPin` are missing from `preload.cjs`, that is a pre-existing break — read the file and report it, do not paper over it.

**Step 6: Commit**

```bash
cd I:/goongrid && git add apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs apps/desktop/src/types/gmatch-bridge.ts && git commit -m "feat(vault): boot the localhost server and expose vaultHttpUrl"
```

---

### Task 6: Give the gallery an "open in browser" action and prefer disk over RAM

**Objective:** From the vault viewer, a click opens the localhost address; tiles render from `vault://` when stored.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/services/vault.ts`
- Modify: `I:/goongrid/apps/desktop/src/components/grid/IdleGalleryView.tsx`

**Step 1: Add the helper to `vault.ts`**

Append:

```ts
/** Browser-openable localhost URL for a stored URL, else null. */
export async function vaultHttpUrl(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  try {
    const res = await window.gmatch?.vaultHttpUrl?.(url)
    return res?.local ?? null
  } catch {
    return null
  }
}
```

**Step 2: Wire the button in `IdleGalleryView.tsx`**

Find the viewer's action row (the block that renders `viewerVaultUrl || viewer.url` around line 849). Add one button beside the existing actions, using the same class string as its siblings:

```tsx
<button
  type="button"
  title="Open in browser"
  aria-label="Open in browser"
  onClick={async () => {
    playPress(760)
    const local = await vaultHttpUrl(viewer.url)
    if (local) void window.gmatch?.openExternal?.(local)
  }}
  className="p-1.5 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
>
  <ExternalLink className="w-4 h-4" />
</button>
```

Add `ExternalLink` to the existing `lucide-react` import in that file, and import `vaultHttpUrl` alongside the existing `useVaultUrls, useVaultUrl` import from `../../services/vault`.

**Step 3: Verify**

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit && echo TSC_OK && npx vitest run src/components/grid 2>&1 | tail -12
```

Expected: `TSC_OK`, then whatever grid tests exist pass. If `src/components/grid` has no tests, the command exits non-zero with "No test files found" — that is acceptable; note it and move on.

**Step 4: Run the design gate**

```bash
cd I:/goongrid/apps/desktop && bash design-gates.sh 2>&1 | tail -16
```

Expected: identical to the current baseline — 3 off-scale, 1 rounded-2xl, 1 white-alpha, `59 bg-black/70`. If a new violation appears, use the token the gate accepts instead of the class you added.

**Step 5: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/services/vault.ts apps/desktop/src/components/grid/IdleGalleryView.tsx && git commit -m "feat(vault): open a stored keep in the browser via its localhost address"
```

---

## Tests / validation

After all seven tasks, in this order:

```bash
cd I:/goongrid/apps/desktop && node electron/vault.test.cjs && node electron/vaultServer.test.cjs && node electron/vault-scheme.test.cjs && node electron/booruSources.test.cjs
cd I:/goongrid/apps/desktop && npx tsc --noEmit && echo TSC_OK
cd I:/goongrid/apps/desktop && npx vitest run src/services/vault.test.ts 2>&1 | tail -8
cd I:/goongrid/apps/desktop && npx vitest run 2>&1 | tail -8
cd I:/goongrid/apps/desktop && bash design-gates.sh 2>&1 | tail -16
```

Expected:
- four `all assertions passed` / `assertion passed` lines, `EXIT=0` each
- `TSC_OK`
- 1 passed
- full desktop suite green (currently 139 files / 934 tests; this adds 1 file / 1 test → 140 / 935)
- design gate unchanged from baseline

**This is desktop-only.** Confirm with:

```bash
cd I:/goongrid && git diff --name-only origin/main..HEAD -- apps/api packages shared
```

Expected: empty output. If empty, no `flyctl deploy` is needed.

**Runtime confirmation the tests cannot give you.** Launch the app with the vault enabled (Settings → local vault), KO a few foes including at least one video and one GIF, then:

1. `ls "$APPDATA/gMatch/media-vault"` (or the `app.getPath('userData')` location) — the `.mp4` / `.gif` / `.jpg` files are there and `manifest.json` lists them.
2. In the gallery viewer, click "Open in browser" — a browser tab opens at `http://127.0.0.1:<port>/f/<sha256>.mp4` and the clip plays with seeking.
3. Watch the main-process log / DevTools network for repeat byte fetches of the same URL — there should be exactly one per URL per session.
4. Watch provider query logs — repeat queries within the 10-minute window return from feed cache without re-hitting booru APIs.

---

## Risks, tradeoffs, and open questions

- **`vault://` vs `http://localhost` was ambiguous.** The literal wording ("should return a localhost address") is what drove Task 4. If the intent was only that `vault://` opens correctly inside Electron, Task 4 and Task 5 are unnecessary and Task 2 is the whole fix. Say so and the plan shrinks by two tasks.
- **The localhost server has no auth.** Bound to `127.0.0.1` with an OS-assigned port and sha256 keys, so it is not reachable from the LAN and paths are not guessable — but any local process that learns a key can read that file. Marked with a `ponytail:` comment; add a per-session token in the path if that threat model matters.
- **Negative cache never retries within a session.** A transient host failure means that image is missing until the next launch. Deliberate: the alternative is a fetch storm from the backfill effect. Marked with a `ponytail:` comment naming the TTL upgrade path.
- **Task 2 may be a no-op.** If `vault.SCHEME` is already registered, the test is still worth keeping — it is the assertion that stops someone deleting the entry.
- **"One API call per query" resolved:** Task 3b reads the feed cache that `fetchBooru` writes, guaranteeing at most one provider call per query per 10-minute window (`FEED_TTL_MS`). Task 3 handles byte fetches via negative-caching failed pins and vault-first lookup.
- **`imageCache.cjs` is untouched except for `capFor`.** "Despise the RAM storage" is honored by making the vault the source for clicker media (Task 6) without deleting the RAM path, which non-opt-in users still rely on. Deleting `gmcache://` outright is a larger change and would break the no-disk guarantee for people who never enable the vault.

---

## Files likely to change

- `I:/goongrid/apps/desktop/electron/imageCache.cjs` — `capFor` helper + two call sites + export.
- `I:/goongrid/apps/desktop/electron/vault.cjs` — cap call site.
- `I:/goongrid/apps/desktop/electron/vault.test.cjs` — one new assertion block.
- `I:/goongrid/apps/desktop/electron/booruSources.cjs` — new (Task 3b).
- `I:/goongrid/apps/desktop/electron/booruSources.test.cjs` — new (Task 3b).
- `I:/goongrid/apps/desktop/electron/main.cjs` — scheme registration (maybe), server boot, IPC handle, booruSources wiring.
- `I:/goongrid/apps/desktop/electron/vault-scheme.test.cjs` — new.
- `I:/goongrid/apps/desktop/electron/vaultServer.cjs` — new.
- `I:/goongrid/apps/desktop/electron/vaultServer.test.cjs` — new.
- `I:/goongrid/apps/desktop/electron/preload.cjs` — `vaultHttpUrl` bridge.
- `I:/goongrid/apps/desktop/src/types/gmatch-bridge.ts` — `vaultHttpUrl` type.
- `I:/goongrid/apps/desktop/src/services/vault.ts` — negative cache, `vaultHttpUrl`, `_resetSessionGuards`.
- `I:/goongrid/apps/desktop/src/services/vault.test.ts` — new.
- `I:/goongrid/apps/desktop/src/components/grid/IdleGalleryView.tsx` — "Open in browser" button.

Not touched: `apps/api/*`, `packages/*`, `src/game/store.ts` (already pins correctly).