# Feed signed media vanishes after load — implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Stop feed images/videos from flipping to "Image unavailable" / "No preview" after they have already rendered, for object-backed (`/api/objects/<id>`) posts.

**Architecture:** Three defects, all on the signed-object path, all one-file fixes. (1) `useObjectImage`'s LRU evicts an entry and `URL.revokeObjectURL`s its blob while a mounted `<img>`/`<video>` still points at that URL — the element then errors out. (2) `extractObjectId` returns `null` when `contentUrl` is empty, so a signed object that only carries an `objectId` never resolves and sits blank forever. (3) A bare UUID as `contentUrl` is not recognized as signed, so it falls through to a raw unsigned `<img src="/api/objects/<uuid>">` which 401s. Fix each where all callers route through.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (jsdom). No new dependencies.

---

## Current context / assumptions

Read these first. Do not skip.

- `I:/goongrid/apps/desktop/src/hooks/useObjectImage.ts` (210 lines) — module-level LRU. Relevant lines:
  - `const CACHE_MAX = 24` (line 38) — **24 entries only**, while the feed renders 40+ posts.
  - `cacheSet` (lines 52-66) — on overflow: `if (evicted?.url) URL.revokeObjectURL(evicted.url)`. **Unconditional. No knowledge of mounted consumers.**
  - `extractObjectId` (lines 42-47) — `if (!contentUrl) return null` fires **before** `return objectId || null`, so a signed object with an empty `contentUrl` loses its id.
  - `useObjectImage` effect cleanup (line 190-193) — guarded by `!objectCache.has(cardId)`, so this one is fine.
- `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx` (229 lines) — the renderer. Relevant:
  - `needsSignedFetch` (lines 49-66) — decides signed vs direct.
  - `extractObjectId` (lines 42-47) — local copy, same empty-`contentUrl` bug.
  - Line 151-160: `if (!src) { const waiting = signed && !img.failed; ... {waiting ? '' : 'No preview'} }` — this is where "No preview" appears.
  - Line 164-170: `if (hasError) return 'Image unavailable'`.
- `I:/goongrid/apps/desktop/src/components/ObjectImage.test.tsx` (47 lines) — **already exists**, 3 tests, mocks `useObjectImage` and `services/vault`. Extend it, do not replace it.
- `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.tsx` line 774-788 and 812-826 — both `ObjectImage` call sites pass `contentUrl={post.url}` / `contentUrl={url}` and `objectId={post.id}` / `objectId={item.id}`. So the empty-`contentUrl` path is live.
- `I:/goongrid/apps/desktop/src/utils/media.ts` line 24-26 — `resolveMediaUrl` already maps a bare UUID to `/api/objects/<uuid>`. It handles the *URL*; it cannot add the signed headers.

**Why "de alguns usuários":** the LRU is a fixed 24 slots. A user whose feed has more than 24 object-backed posts (or who scrolls past 24) evicts the earlier ones *and revokes their live blob URLs*. Users with fewer object-backed posts never see it. Same story for the 401 path: public objects render, non-public ones 401.

**Assumption to verify in Task 1, not assume:** that eviction happens while the element is mounted. If Task 1's test does not fail, STOP and re-diagnose — do not proceed to Task 2 on a guess.

---

## Step-by-step tasks

### Task 1: Pin mounted entries so eviction can never revoke a live blob URL

**Objective:** Prove the LRU revokes a blob URL that a mounted consumer still renders, then stop it.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/hooks/useObjectImage.ts`
- Test: `I:/goongrid/apps/desktop/src/hooks/useObjectImage.test.ts` (create)

**Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Each object fetch resolves a distinct blob. We assert that a mounted hook's
// URL is never revoked while it is still on screen.
const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

beforeEach(() => {
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    n += 1
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => new Blob([`obj-${n}`], { type: 'image/png' }),
    }
  }))
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:u${n}`),
    revokeObjectURL: vi.fn(),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('useObjectImage LRU eviction (signed media vanish)', () => {
  it('does not revoke the blob URL of a still-mounted entry when the cap overflows', async () => {
    const { useObjectImage, _test } = await import('./useObjectImage')
    _test.resetObjectCache()

    const mounted = renderHook(({ id }) =>
      useObjectImage(id, identity), { initialProps: { id: 'obj-000' } })

    // Wait for the mounted entry to resolve to a blob URL.
    await waitFor(() => expect(mounted.result.current.url).toContain('blob:'))
    const liveUrl = mounted.result.current.url as string

    // Overflow the 24-slot LRU with other objects while 'obj-000' is mounted.
    const others = Array.from({ length: 40 }, (_, i) => `obj-${String(i + 1).padStart(3, '0')}`)
    for (const id of others) {
      const h = renderHook(() => useObjectImage(id, identity))
      await waitFor(() => expect(h.result.current.failed || h.result.current.url).toBeTruthy())
      h.unmount()
    }

    // The mounted element still points at liveUrl — it must not have been revoked.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(liveUrl)
    mounted.unmount()
  })
})
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/hooks/useObjectImage.test.ts
```

Expected: **FAIL** — `expected "revokeObjectURL" to not be called with "blob:u1"`. If it PASSES, the eviction theory is wrong: stop, do not continue, and re-diagnose (check whether `[content-visibility:auto]` was reintroduced, and whether the API is 401ing instead).

**Step 3: Add the pin set and make eviction skip pinned entries**

In `I:/goongrid/apps/desktop/src/hooks/useObjectImage.ts`, directly below `cacheSource` (around line 40), add:

```ts
// A mounted consumer's entry must never be evicted-and-revoked out from under
// it: the <img>/<video> keeps pointing at that blob URL and dies the moment it
// is revoked ("Image unavailable" for photos, empty src -> "No preview" for
// videos). Pin while mounted, unpin on unmount; eviction skips pinned keys.
const pinned = new Set<string>()
function pinKey(cardId: string, source: string): string {
  return `${source}::${cardId}`
}
```

Replace the `while (objectCache.size > CACHE_MAX) { ... }` loop inside `cacheSet` with:

```ts
  while (objectCache.size > CACHE_MAX) {
    const victim = [...objectCache.keys()].find(
      (k) => !pinned.has(pinKey(k, cacheSource.get(k) || '')),
    )
    if (!victim) break // every entry is on screen: nothing safe to evict
    const evicted = objectCache.get(victim)
    if (evicted?.url) URL.revokeObjectURL(evicted.url)
    objectCache.delete(victim)
    cacheSource.delete(victim)
  }
```

**Step 4: Pin/unpin from the hook**

In the same file, inside `useObjectImage`, add an effect right after the main fetch `useEffect` (after its closing `}, [cardId, identity, enabled])`):

```ts
  // Hold a pin for as long as this consumer is mounted, so the LRU can never
  // revoke the URL we are currently rendering.
  useEffect(() => {
    if (!cardId || !identity) return
    const k = pinKey(cardId, identity.orbitId)
    pinned.add(k)
    return () => { pinned.delete(k) }
  }, [cardId, identity])
```

**Step 5: Expose the test seam**

Replace the `_test` export at the bottom of the file (lines 298-303) with:

```ts
export const _test = {
  resetSessionCache: () => { revokeAll(); session.clear() },
  resetObjectCache: () => { objectCache.clear(); cacheSource.clear(); pinned.clear() },
  cacheSize: () => objectCache.size,
  CACHE_MAX,
}
```

Note: the file currently ends with `_test` containing `resetSessionCache`, `sessionCacheSize`, `clearSessionCache`, `SESSION_CAP` — those reference a `session` map that does not exist in this module. Verify by grepping `session` in the file before editing; if the old `_test` block references undefined symbols, replace it wholesale as shown rather than merging.

**Step 6: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/hooks/useObjectImage.test.ts
```

Expected: **1 passed**.

**Step 7: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/hooks/useObjectImage.ts apps/desktop/src/hooks/useObjectImage.test.ts && git commit -m "fix(media): never revoke a mounted object's blob URL on LRU eviction"
```

---

### Task 2: A signed object with no contentUrl must still resolve

**Objective:** `objectId` alone is enough to fetch; the empty-`contentUrl` early return currently drops it.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx:42-47`
- Test: `I:/goongrid/apps/desktop/src/components/ObjectImage.test.tsx` (append)

**Step 1: Append the failing test**

Add to the existing `describe` block in `ObjectImage.test.tsx`, after the last `it(...)` and before the closing `})`:

```tsx
  it('treats an objectId with no contentUrl as signed (T-W3b)', () => {
    const { container } = render(<ObjectImage objectId="abc-123" identity={identity} />)
    // Signed + not yet failed => blank placeholder, never "No preview".
    expect(screen.queryByText('No preview')).toBeNull()
    expect(container.firstElementChild).toBeTruthy()
  })
```

**Step 2: Run to verify failure**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/ObjectImage.test.tsx
```

Expected: **FAIL** — `expect(received).toBeNull()` receiving `"No preview"`. (`needsSignedFetch` returns `true` for the `objectId`-only branch, but `extractObjectId` returns `null`, so `useObjectImage(null)` yields `url: null` with `failed: false`; `waiting` is computed from `signed` which is `true`... if it still shows "No preview", the mock's `hookState` is being reused — reset `hookState.url = null; hookState.failed = false` in this test and re-run to get the true RED.)

**Step 3: Fix `extractObjectId`**

In `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx`, replace lines 42-47:

```ts
function extractObjectId(contentUrl: string | null | undefined, objectId: string | null | undefined): string | null {
  if (!contentUrl) return objectId || null
  const idx = contentUrl.indexOf(OBJECT_PATH)
  if (idx >= 0) return contentUrl.slice(idx + OBJECT_PATH.length).split(/[?#]/)[0] || null
  return objectId || null
}
```

The only change is the first line: `return null` becomes `return objectId || null`.

**Step 4: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/ObjectImage.test.tsx
```

Expected: **4 passed**.

**Step 5: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/components/ObjectImage.tsx apps/desktop/src/components/ObjectImage.test.tsx && git commit -m "fix(media): an objectId alone is enough to sign the object fetch"
```

---

### Task 3: A bare UUID is signed media, not a plain img src

**Objective:** Stop emitting `<img src="/api/objects/<uuid>">` without auth headers.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx:49-66`
- Test: `I:/goongrid/apps/desktop/src/components/ObjectImage.test.tsx` (append)

**Step 1: Append the failing test**

```tsx
  it('treats a bare uuid contentUrl as signed, not a direct img src (T-W3c)', () => {
    const uuid = 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f'
    hookState.url = null
    hookState.failed = false
    const { container } = render(<ObjectImage contentUrl={uuid} identity={identity} />)
    // A raw <img> would carry the unauthenticated /api/objects/<uuid> url.
    expect(container.querySelector('img')).toBeNull()
  })
```

**Step 2: Run to verify failure**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/ObjectImage.test.tsx
```

Expected: **FAIL** — an `<img>` is rendered with `src` ending in `/api/objects/e66d0889-...`.

**Step 3: Recognize the UUID in `needsSignedFetch` and `extractObjectId`**

In `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx`, add above `extractObjectId` (around line 40):

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

Then in `extractObjectId`, after the `OBJECT_PATH` branch, insert:

```ts
  if (UUID_RE.test(contentUrl.trim())) return contentUrl.trim()
```

And in `needsSignedFetch`, after the `OBJECT_PATH` branch (inside `if (contentUrl) {`), insert:

```ts
    if (UUID_RE.test(contentUrl.trim())) {
      return Boolean(objectId ? !objectId.startsWith('p2p-') : true)
    }
```

**Step 4: Run to verify pass**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/ObjectImage.test.tsx
```

Expected: **5 passed**.

**Step 5: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/components/ObjectImage.tsx apps/desktop/src/components/ObjectImage.test.tsx && git commit -m "fix(media): a bare uuid is signed object media, never a raw img src"
```

---

## Tests / validation

After all three tasks, in this order:

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit && echo TSC_OK
cd I:/goongrid/apps/desktop && npx vitest run src/components/ObjectImage.test.tsx src/hooks/useObjectImage.test.ts
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed src/components/chat
cd I:/goongrid/apps/desktop && bash design-gates.sh 2>&1 | tail -14
```

Expected:
- `TSC_OK`
- 6 passed (5 + 1)
- feed + chat suites green; feed was 10 files / 34 tests before, unchanged
- design-gates output identical to baseline (1 white-alpha, everything else 0)

Then the whole desktop suite:

```bash
cd I:/goongrid/apps/desktop && npx vitest run
```

Expected: 139 files / 935 tests passed (was 138 / 929 after the poster fix; this adds 1 file / 6 tests).

**This is desktop-only.** `git diff --name-only origin/main..HEAD -- apps/api packages shared` must be empty; if it is, no `flyctl deploy` is needed and pushing `main` is the whole release step.

**Runtime confirmation the tests cannot give you:** open the feed in `npm run dev` (which proxies `^/api` to `https://gmatch.fly.dev`), scroll past 30+ posts, and confirm media that already rendered stays rendered. The unit tests pin the mechanism; only the browser proves the symptom is gone.

---

## Risks, tradeoffs, and open questions

- **`if (!victim) break` can let the cache grow past `CACHE_MAX`.** That is deliberate: with every entry pinned, there is nothing safe to evict, and growing RAM beats blanking the screen. It self-corrects as consumers unmount. If a long session with hundreds of simultaneously-pinned objects ever shows memory pressure, upgrade to a weak-ref map — not now.
- **`pinned` is keyed by `orbitId::cardId`.** Switching accounts leaves stale pins until remount. Bounded and harmless (it only makes eviction more conservative). Clear it in `resetObjectCache` (already done in Task 1's seam).
- **The separator is `'::'`.** Deliberately not `\u0001` — a previous edit in this repo corrupted a U+0001 separator into six literal characters. Neither an orbitId nor an object id contains `::`.
- **`resetObjectCache` may not exist yet.** The current `_test` block at the bottom of `useObjectImage.ts` references a `session` map that this module does not appear to own. Read the file's actual last 10 lines before editing and reconcile — do not blindly merge.
- **Open question (do not act on it here):** `GMatchFeed.tsx:769` computes `const isObj = url.includes('/api/objects/') || !url` and `normalizeFeedPost` maps `media: [{id,url,mime_type}]` down to `mediaUrls: string[]`, dropping the per-item `id` and `mime_type`. If post-fix reports persist for multi-media posts, that normalization is the next place to look — the video/image distinction and the object id both die there.
- **Not addressed:** whether the API is returning 401 for objects a viewer *should* be able to read. That would present identically. Task 3 removes the unauthenticated request path; if a properly-signed request still 401s, the bug is server-side in `apps/api/src/routes/objects.ts` authorization, a separate investigation.

---

## Files likely to change

- `I:/goongrid/apps/desktop/src/hooks/useObjectImage.ts` — pin set, eviction guard, `_test` seam.
- `I:/goongrid/apps/desktop/src/hooks/useObjectImage.test.ts` — new.
- `I:/goongrid/apps/desktop/src/components/ObjectImage.tsx` — `UUID_RE`, `extractObjectId` empty-url return, `needsSignedFetch` uuid branch.
- `I:/goongrid/apps/desktop/src/components/ObjectImage.test.tsx` — 2 new tests.

Not touched: `apps/api/*`, `GMatchFeed.tsx`, `services/imageCache.ts`, `services/vault.ts`.