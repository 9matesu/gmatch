# Tag → Feed Priority: make added tags actually steer the idle clicker

## Goal

Adding a tag (e.g. `skylar vox`) must fill the idle-clicker feed with matching content first, from cache updated with that tag on priority.

## Current context / assumptions

- Repo root: `I:/goongrid`, app: `I:/goongrid/apps/desktop`. Branch has parallel opencode work — commit only own files.
- Feed chain: `src/game/store.ts` (`fetchFeed`, `addCustomTag`) → `src/services/booru.ts` (`fetchPosts` → `directFetch`, or Electron IPC → `electron/main.cjs` `fetchBooru`) → `sanitize` (`src/services/postFilter.ts` `allowOnly`) → `remember` (no-repeat memory) → store queue/grid.
- Verified live: `realbooru.com/...&tags=skylar_vox` returns skylar content (underscore form). booru.org subs (`blacked`, `qoh`, `celeb`, `footfetishbooru`, `hgoon`, `allgirl`, `rule34`) are under Cloudflare WAF: `tags=` → 403, so both fetch paths paginate tagless via random `pid` and return **random latest** (workaround commit `f97cd94`).
- `sanitize()` only filters quality (rating/blocklist/slop) — it never checks posts match the query. So a `skylar vox` fetch served by a booru.org sub returns random non-skylar posts as if they matched.

## Architecture / proposed approach

Two root fixes, both paths (browser `booru.ts` + Electron `main.cjs`): (1) a query-token match gate so only posts carrying a query token reach the feed; (2) a store-level `priorityTag` so a newly added tag bypasses the level-sorted round-robin until its cache is filled. Normalization (`skylar vox` → `skylar_vox`) centralized in one function used by probe, query, and cache keys.

## Step-by-step tasks

### Task 0 — Inspect normalization (read-only, ~3 min)

Read `src/game/tags.ts` lines 1–95 (`normalizeCustomTag`, `validateCustomTag`, `deriveTagStats`).

- Expected: find where spaces become underscores (or don't).
- Verify: `grep -n "normalizeCustomTag\|validateCustomTag" apps/desktop/src/game/tags.ts`

### Task 1 — TDD: single normalization function (spaces → underscores, lowercase, trim)

Test file: `src/game/tags.test.ts`. Failing test first:

```ts
it('normalizeFeedTag maps spaces to underscores, lowercases, trims', () => {
  expect(normalizeFeedTag('  Skylar Vox ')).toBe('skylar_vox')
})
```

- Run: `cd /i/goongrid/apps/desktop && npx vitest run src/game/tags.test.ts` → expect 1 failure.
- Implement in `src/game/tags.ts`:

```ts
/** Canonical feed form: what the booru mirrors index (`skylar vox` → `skylar_vox`). */
export function normalizeFeedTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_')
}
```

- Re-run → pass. Use `normalizeFeedTag` in `addCustomTag` (store.ts ~line 796 probe + `OwnedTag` name), `feedQuery` output, and `queryVariants` input. Commit.

### Task 2 — TDD: query-token match gate in `sanitize` (`src/services/booru.ts` ~line 141)

Failing test in `src/services/booru.test.ts`:

```ts
it('drops posts carrying none of the query tokens', async () => {
  vi.stubGlobal('window', {})
  const junk = `<img src="https://thumbs.booru.org/blacked/thumbnails//105/thumbnail_abc123.png" alt="post" title=" 1girl big_breasts score:0 rating:Explicit"/>`
  const fetchMock = vi.fn(async (u: string) => {
    const s = String(u)
    if (s.startsWith('/booru/tbib/') || s.startsWith('/booru/xbooru/') || s.startsWith('/booru/kona') || s.startsWith('/booru/yand') || s.startsWith('/booru/real')) return { ok: false }
    if (s.startsWith('/booru/')) return { ok: true, text: () => Promise.resolve(junk) }
    return { ok: false }
  })
  vi.stubGlobal('fetch', fetchMock)
  const res = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
  expect(res.ok).toBe(false) // junk filtered → no usable posts
})
```

- Run `npx vitest run src/services/booru.test.ts` → failure (junk currently passes).
- Implement: after `allowOnly`, require ≥1 normalized query token in post tags:

```ts
function matchesQuery(post: BooruPost, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).map((t) => t.replace(/\s+/g, '_')).filter(Boolean)
  if (tokens.length === 0) return true
  const tags = post.tags.map((t) => t.toLowerCase())
  return tokens.some((tok) => tags.some((t) => t === tok || t.includes(tok)))
}
```

Apply in `sanitize`: `return allowOnly(posts, { captions }).filter((p) => !p.tags.some(isUserExcluded) && matchesQuery(p, query ?? ''))`.
Exception: caption-hunt queries (`/caption/i`) skip the gate (imhentai covers carry gallery titles, not query tags) — pass `captions` through.
- Re-run → pass. This also makes the `addCustomTag` probe truthful (junk → "No live results"). Commit.

### Task 3 — booru.org subs: widen `pid` range for hit rate (`src/services/booru.ts` ~line 291 + `electron/main.cjs` 7 sub fetchers)

With the Task 2 gate, tagless `pid` pages mostly miss. Widen rotation so misses vary:

```ts
const booruPid = Math.floor(Math.random() * 10) * 20 // pid 0..180
```

Mirror in `main.cjs`: replace `Math.floor(Math.random() * 5) * 20` with `* 10` in all 7 booru.org fetchers (hgoon, blacked, allgirl, rule34-org, qoh, celeb, footfetish).
- Verify: `npx vitest run src/services/booru.test.ts` green. No new test (range is randomness; existing pid test still matches `[?&]pid=\d+`). Commit with Task 2 if same files.

### Task 4 — TDD: `priorityTag` in the store (`src/game/store.ts`)

Root cause: `fetchFeed` (~line 885) rotates ONE tag from `pool = owned.slice(0, 4)` where `feedQuery` sorts level-desc — a new level-1 tag loses to leveled tags and may never be fetched.

Failing test in `src/game/store.test.ts` (mock `fetchPosts` as existing tests do):

```ts
it('newly added custom tag is fetched first, ahead of higher-level tags', async () => {
  // state: tags [{name:'gangbang',level:5,...}, {name:'skylar_vox',level:1,...}], priorityTag 'skylar_vox'
  // call fetchFeed, assert fetchPosts first called with { tags: 'skylar_vox', ... }
})
```

- Implement:
  - State: add `priorityTag: string | null` (default `null`) to the store shape + persisted slice if tags persist (check `save.ts` — if tags persist, persist `priorityTag` too).
  - `addCustomTag` success path: `set({ ..., priorityTag: verdict.name })`.
  - `completeSetup` (~line 1404): `set({ ..., priorityTag: lastPickedName })`.
  - `fetchFeed`: before round-robin, `const first = s.priorityTag ?? pool[s.feedCursor % pool.length]`; on success with posts, clear only after 2 successful priority fills (counter in state, e.g. `priorityFills`) — simplest: clear after first success; document choice. Simplest correct: clear after first successful priority fetch (queue now holds matching batch; rotation resumes).
- Re-run `npx vitest run src/game/store.test.ts src/game/store.coverage.test.ts` → pass. Commit.

### Task 5 — Normalized cache keys (inspect + fix if broken)

Check `getFeedCache/setFeedCache` key usage: `src/services/imageCache.ts` + `electron/imageCache.cjs` + `main.cjs` `fetchBooru` (~line 736). If keys are raw query strings, `skylar vox` and `skylar_vox` double-cache. Fix: normalize at `fetchPosts` entry (`req.tags = normalizeFeedTag(req.tags)` — careful: multi-tag queries keep spaces between tags, only intra-tag spaces collapse; since tags are single tokens joined by space, apply per-token: `req.tags.split(/\s+/).map(normalizeFeedTag).join(' ')` — but `skylar vox` as TWO tokens vs one tag `skylar_vox` is ambiguous; canonicalize 2-word pornstar names via blocklist-independent rule is overkill — decision: treat each whitespace token separately; document that multiword names must be typed with underscore or picked from market/discovery where names are already underscored).

- Verify with a REPL assertion or unit test on the chosen normalization of `'skylar vox'` per the documented rule. Commit.

### Task 6 — Full gate + selective commit

- `cd /i/goongrid/apps/desktop && npm test` → expect 75 files / 598+ tests green (number grows with new tests).
- `node electron/imageCache.test.cjs && node electron/imageCacheMemory.test.cjs` → both OK.
- `cd I:/goongrid && git status --short` → commit ONLY: `apps/desktop/src/game/tags.ts`, `tags.test.ts`, `src/services/booru.ts`, `booru.test.ts`, `src/game/store.ts`, `store.test.ts`, `electron/main.cjs` (pid widening only — check diff hunks first, opencode works in parallel).

## Tests / validation

TDD per task (failing test → implement → pass → commit) as written above. Final gate: `npm test` (75 files green) + 2 CJS suites. Live check (optional, dev browser): add `skylar_vox` tag → first feed batch contains `skylar_vox` in post tags (realbooru serves it; verified live 2026-09-10).

## Risks, tradeoffs, and open questions

- **Risk**: Task 2 gate starves feeds whose mirrors lack the tag (konachan/yandere are anime-only; a `skylar vox` query yields nothing there — correct behavior: they cool down via existing unhealthy logic, realbooru/redgifs/paheal serve it). If the whole feed goes offline for a niche tag, that is truthful (probe says "No live results") — better than wrong content.
- **Tradeoff**: booru.org subs become low-hit-rate lottery (random pid + client filter). Accepted: keeps niche subs alive without 403s; realbooru + redgifs carry tag-targeted load. If hit rate proves too low in practice, upgrade path is a tag→sub affinity map (e.g. route pornstar names to realbooru/redgifs first), NOT re-adding `tags=` (WAF).
- **Open**: multiword-name ambiguity (Task 5) — needs user decision if underscore-typing is unacceptable; cheapest alternative is a small alias map for known pornstars.
- **Open**: `priorityFills` clear-after-1 vs clear-after-N — start with 1 (smallest diff); raise if queue still feels unsteered.
