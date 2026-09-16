# Fix: idle clicker repeats on fresh starts — deep random sampling + seen-memory wiped on reset

## Goal

Make the idle feed actually random: replace the fake "randomness" (pid 0-4 = the same
~20 newest posts per tag every round) with deep random sampling across the first ~1000
posts per tag, and wipe the persistent never-repeat ledger when a game is reset so
"starting fresh" behaves like fresh.

## Current context (traced, verified in code this session)

Repo: `I:\goongrid`, renderer in `apps/desktop`. Two independent mechanisms cause the
observed repeats:

1. **"Random" barely moves the window.** `dapiPass` in `apps/desktop/src/services/booru.ts`:
   - line 556: `const pid = req.page !== undefined ? req.page : isProbe ? 0 : Math.floor(Math.random() * 5)`
     — on gelbooru-class DAPI, `pid` is a **POST OFFSET, not a page** (already documented
     in the repo skill/lessons: "Gelbooru pid is a POST OFFSET (pid=1 skips 1 post)").
     With `limit=15` fetches, rand(5) samples the first ~20 newest posts of the tag.
     Every round. That IS the repeat: consecutive rounds overlap ~75-100%.
   - line 577: moebooru `pageNum = 1 + rand(5)` — pages ARE real pages, so window =
     first ~75 posts; still narrow.
   - line 585: realbooru `realPidNum = rand(5)` — offset again, ~20-post window.
   - line 595-596: booru.org `rand(5) * 20` — offset up to 80; least bad.
   - Packaged/Electron path `apps/desktop/electron/main.cjs:360` `moebooruUrl`: same
     `1 + rand(5)` page window for konachan/yande.re.
2. **The never-repeat memory is global and survives "fresh".** `SEEN_KEY =
   'gmatch.seen.v1'` (booru.ts:70) is ONE localStorage key shared by every identity on the
   profile; capped at 50k entries. `resetGame()` (`apps/desktop/src/game/store.ts:1526`)
   resets game state but does NOT clear it, so a "fresh" start inherits every image ever
   seen; once a tag's shallow window is exhausted (it's only ~20-80 posts wide!), the
   feed hits the deliberate reshow path `recallSeen()` (booru.ts:1084, marks `repeat: true`)
   — repeated images by design.

So on current code a "fresh" player sees: shallow-window overlap repeats + cross-run
seen-ledger exhaustion + designed reshow repeats. Fixing #1 (depth) starves the reshow
path of a reason to fire; fixing #2 makes "starting fresh" honest.

### Decisions taken (user was asked and didn't answer; change only if they object)

- Keep the never-repeat contract ("never show repeated images on the game", user rule
  2026-09-11, non-negotiable by history) — "full random" is implemented as full-random
  SAMPLING, not removal of the dedupe memory. True no-memory random would repeat
  birthday-paradox on a 20-post window and contradicts the standing rule.
- Seen memory stays GLOBAL across identities (per-identity namespacing = bigger diff,
  only needed once someone reports cross-profile leaks).
- Sampling depth cap: first ~1000 posts per tag (the "safe" option): covers 90% of the
  freshness gain without digging into old junk/404 soup.
- `resetGame` wipes the seen ledger (this is what "starting fresh" should have meant).

## Architecture / proposed approach

Two small commits. (A) Deepen the random window at the four URL builders (renderer
booru.ts + one function in electron/main.cjs) — pure arithmetic, probes stay shallow
(`isProbe` branches untouched so source-health checks keep hitting page 0). Empty/404
pages from deep offsets already `continue` to the next source/variant
(booru.ts:655-665, 710) — no new error handling needed. (B) Add `clearSeenMemory()` to
booru.ts and call it from `resetGame`, updating the two existing test mocks
(`store.test.ts`, `store.coverage.test.ts` mock the booru module with an explicit export
list — a new import without a mock entry fails 17 tests, known trap).

## Step-by-step tasks

Commands from `I:\goongrid\apps\desktop` unless stated. Commit explicit paths only
(shared tree; sibling agents).

### Task 1 — RED: test that non-probe rounds sample deep (5 min)

Append to `src/services/booru.test.ts` (it already stubs `fetch` and imports from
`./booru`; reuse its existing fetch-capture pattern — if it has none, this block is
self-contained):

```ts
describe('deep random sampling (repeat-fix 2026-09-15)', () => {
  it('DAPI pid offset reaches up to the 1000-post pool, probes stay at 0', async () => {
    const urls: string[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (u: any) => { urls.push(String(u)); return Promise.resolve(new Response('[]', { status: 200 })) })
    const realRandom = Math.random
    Math.random = () => 0.999
    try {
      await fetchPosts({ tags: ['test_tag'], limit: 15 })          // non-probe round
      await fetchPosts({ tags: ['test_tag'], limit: 15, probe: true }) // probe round
    } finally {
      Math.random = realRandom
      vi.unstubAllGlobals()
    }
    const dapi = urls.filter((u) => u.includes('page=dapi'))
    expect(dapi.length).toBeGreaterThan(0)
    // rand=0.999 * 1000 -> pid 999 (was: rand*5 -> pid 4, the same ~20 posts every round)
    expect(dapi[0]).toMatch(/[?&]pid=999(&|$)/)
    const probeDapi = dapi[dapi.length - 1]
    expect(probeDapi).toMatch(/[?&]pid=0(&|$)/)
    void realFetch
  })
})
```

(`fetchPosts` is already imported at the top of that file — verify with
`grep -n "import.*fetchPosts" src/services/booru.test.ts`; if absent, add to the
existing `./booru` import.)

Run: `npx vitest run src/services/booru.test.ts -t "deep random sampling"`
Expected: FAIL — `expected '...pid=4' to match /pid=999/`.

### Task 2 — GREEN: widen the four windows (5 min)

`src/services/booru.ts` — exact string replacements (line refs above):

1. DAPI (line ~556):
```ts
  const pid = req.page !== undefined ? req.page : isProbe ? 0 : Math.floor(Math.random() * 1000)
```
2. moebooru (line ~577):
```ts
        pageNum = isProbe ? 1 : 1 + Math.floor(Math.random() * 50)
```
3. realbooru (line ~585):
```ts
        realPidNum = isProbe ? 0 : Math.floor(Math.random() * 1000)
```
4. booru.org (lines ~595-596):
```ts
        const booruPid = isProbe
          ? Math.floor(Math.random() * 3) * 20
          : Math.floor(Math.random() * 50) * 20
```

(`pid` is a POST offset on gelbooru-class sites; 1000 = deliberate ~1000-post pool cap.
`ponytail: cap 1000; raise per-source if the tags deserve it — see risks.)

5. `electron/main.cjs` `moebooruUrl` (line ~360):
```js
  const page = 1 + Math.floor(Math.random() * 50)
```

Run: `npx vitest run src/services/booru.test.ts` → all pass (existing tests stub random
URLs; if one asserts an exact `pid=0..4` value, update ONLY that assertion's expected
pid to the new formula's result under its seeded Math.random — same contract, wider
range; note it in the commit).

Commit:
```
cd I:/goongrid && git add apps/desktop/src/services/booru.ts apps/desktop/src/services/booru.test.ts apps/desktop/electron/main.cjs && git commit -m "fix(idle): deep random sampling (first ~1000 posts/tag) instead of the pid 0-4 newest-posts window"
```

### Task 3 — RED: resetGame clears the seen ledger (5 min)

`src/game/store.test.ts` (or `store.coverage.test.ts` — pick the file that already
tests `resetGame`; grep first: `grep -n "resetGame" src/game/store*.test.ts`). Append a
test in the store's describe block:

```ts
it('resetGame wipes the never-repeat memory (fresh start = fresh pool)', async () => {
  const booru = await import('../services/booru')
  const { useGame } = await import('./store')
  useGame.getState().resetGame()
  expect(booru.clearSeenMemory).toHaveBeenCalled()
})
```

This only works if the file's `vi.mock('../services/booru', ...)` factory lists
`clearSeenMemory` — so ADD IT in the same commit's test step (see Task 4 for the
production import; the mock must be updated first or the production import 500s the
suite — known trap: "No export is defined on the mock"):

in BOTH `src/game/store.test.ts` and `src/game/store.coverage.test.ts`, extend the
existing booru mock factory with `clearSeenMemory: vi.fn(),` (next to `fetchPosts`).

Run: `npx vitest run src/game/store.test.ts -t "resetGame wipes"`
Expected: FAIL — `clearSeenMemory` not exported by `../services/booru` / not called
(store's resetGame doesn't call it yet). If the mock-exports change alone breaks the
import at module load, that RED is fine too — it names the missing export.

### Task 4 — GREEN: export + wire clearSeenMemory (5 min)

`src/services/booru.ts`, next to `clearMirrorCooldowns` (line ~166), reusing the file's
own state + `writeSeen()`:

```ts
/** Fresh game: forget every image ever seen (global never-repeat ledger). */
export function clearSeenMemory(): void {
  seenIds.clear()
  seenUrls.clear()
  seenLedger.length = 0
  reshowCursor = 0
  emptyStreak = 0
  seenLoaded = true
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SEEN_KEY)
  } catch { /* private mode */ }
}
```

(`seenLoaded = true` prevents the cleared state being re-inflated from disk on next use;
mirror exactly the field list in `__resetFeedState` at line ~171 MINUS the cooldown
clear — reset shouldn't revive cooled mirrors mid-session. `writeSeen` is NOT needed:
removeItem + next persist writes the empty set.)

`src/game/store.ts` `resetGame` (line ~1526):

```ts
  resetGame: () => {
    setUserExcludes([])
    clearSeenMemory()
    set({ ...freshData() })
  },
```

and add `clearSeenMemory` to the existing `from '../services/booru'` import at the top
of store.ts (verify the import site: `grep -n "from '../services/booru'" src/game/store.ts`).

Run: `npx vitest run src/game/store.test.ts src/game/store.coverage.test.ts` → all pass.

Commit:
```
cd I:/goongrid && git add apps/desktop/src/services/booru.ts apps/desktop/src/game/store.ts apps/desktop/src/game/store.test.ts apps/desktop/src/game/store.coverage.test.ts && git commit -m "fix(idle): resetGame wipes the never-repeat ledger (fresh start was inheriting every past image)"
```

### Task 5 — Gates + live sanity (5 min)

```
npx vitest run src/services src/game 2>&1 | tail -3        # all green
npx tsc --noEmit                                           # 0 errors
node electron/booru-parity.test.cjs 2>/dev/null || true    # only if it exists
```
Live (dev app :5173, needs the vite /booru proxies up): start fresh → let ~10 rounds
run → confirm zero visible duplicates and no "Sources offline" from exhaustion
(feedOffline badge false; deep 404s are silently skipped per source).

## Tests / validation

TDD per task above (RED commands show the exact failing assertion; GREEN commits after
each pass). Whole-suite gates in Task 5. The deep-sampling test is deterministic via the
`Math.random = () => 0.999` stub, not flaky.

## Risks, tradeoffs, open questions

- Deep offsets on NARROW tags (a custom tag with 40 posts): most lottery tickets hit
  empty pages → `clean.length === 0 → continue` → next source/variant, and the
  redgifs/babesource/imhentai fallback chain + `emptyFresh` gentle path already absorb
  all-empty rounds. Cost is a few extra dead requests per round; the 429 cooldown logic
  (line ~614) only fires on HTTP 429, not 404/empty, so no cooldown-storm risk. If a
  user reports a specific niche tag starving, cap per-source via a `poolHint` on
  DIRECT_SOURCES — YAGNI now.
- moebooru `page=50` with limit 15 = offset 735; konachan/yandere are large pools, fine.
  yande.re returns `[]` on some deep queries (observed while probing: returned empty for
  orderby experiments) — handled by the same continue path.
- Clearing seen on reset also clears the RESHOW pool: a reset player can now see images
  from their old runs — that is the POINT (fresh start = fresh pool) and matches the
  user's mental model they asked to be grilled about.
- The seen ledger is written by the renderer (localStorage) and by electron drops;
  `clearSeenMemory` only touches the renderer copy under the same key — the packaged
  app's renderer IS the game screen, so there is exactly one ledger. No hidden twin.
- Not done (deliberate): per-identity seen namespaces, tag-page-count discovery
  (count=true header probes returned nothing usable from this network), server-side
  feed randomization, and any touch to `fetchFeed`'s store-level dedupe filter (line
  ~979) — it stays as the last-line guard.
