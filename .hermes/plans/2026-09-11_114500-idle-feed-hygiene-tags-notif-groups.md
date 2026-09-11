# Plan: Idle-clicker feed health + tag tools + Instagram-style grouped notifications

## Goal

Fix image retrieval/cache/repetition/pollution at the root, give the player tag control (solo, delete, anti-tags, merge) and a "don't show this again" purge, and group activity notifications Instagram-style — all reusing what already exists (ponytail ladder rung 2).

## Current context / assumptions

Repo: `I:/goongrid`, Electron+React desktop app (`apps/desktop`) + Hono/D1 API (`apps/api`). Branch off current `fix/browser-perf-ui-sweep`. Gates: desktop `npx vitest run` (634 green baseline), api `npx vitest run` (846), `npx tsc -p tsconfig.json --noEmit`, `npm run lint` = 0 errors. V1 UI contract: `docs/DESIGN.md` (tokens only, no emoji chrome, icon-only bare buttons).

**Already exists — DO NOT rebuild (verified 2026-09-11):**
- Seen-set / never-repeat: `src/services/booru.ts` `markSeen()/isSeen()` (line 52/59), dedupe inside `fetchPosts` via `remember()`; persisted with 5s debounce; cap 50k.
- Drain eviction: `evictImage(url)` in `src/services/imageCache.ts:230` (revoke object URL + bridge `cache:evict` → main deletes bytes). The idle clicker "next/discard" path must route through it — check whether `src/game/store.ts` skip actions call it; if a skip path misses it, that IS the repetition bug (root-cause fix: call site, not new mechanism).
- User anti-tags: `userExcludes` in store (`src/game/store.ts:108,1431-1445` `addUserExclude`/`removeUserExclude`), applied in `src/services/booru.ts` `sanitize()` (~line 196: `.filter((p) => !p.tags.some(isUserExcluded))`) and setup UI `src/firstRun/FeedTuneStep.tsx`.
- Noise/filler hiding: `src/game/tagFilter.ts` (`isNoise`, `rankTags`, `filterTags`) feeding market offers.
- Solo: `soloTag` exists in `src/game/tags.ts:93` and store — UI is a hidden gesture (middle-click / shift-click in `src/ui/ShopPanel.tsx:196`).
- Server notifications: table `Notifications` (migration 012), `createNotification/listNotifications/unreadNotificationCount/markNotificationsRead` in `apps/api/src/notifications.ts`; types already include `like | comment | follow | card_received`; bell panel `src/components/NotificationsPanel.tsx` (243 lines, flat list). follow/like/comment already notify (users.ts, feed routes).

**Real gaps this plan fills:** (T1) delete/sell owned tag; (T2) visible solo affordance + merge-two-pills query; (T3) per-image purge ("don't show this again") wired to excludes+seen+evict; (T4) co-occurrence blocker ("tags that shouldn't display alongside") derived from purges; (T5) fill remaining event gaps: card purchase + repost notifications; (T6) Instagram-style grouping in the panel ("Rafael and 4 others liked your card"); (T7) retrieval hygiene sweep (repetition sources, blocked loads, polluted UI chrome).

## Architecture

Client-side only except T5/T6: the feed is local, so purge/exclude/merge/solo/delete are `store.ts` + `booru.ts` state changes persisted via the existing `save()`. Grouping is a pure client fold over the existing `/api/notifications` list (no schema change, no server aggregation — YAGNI). All new actions follow the existing store pattern: mutate state → `get().save()` → toast.

## Tasks

Each task: RED test → minimal GREEN → gate → commit (explicit paths only; opencode shares the tree).

### T1 — Delete an owned tag (pill "×")

Files: `apps/desktop/src/game/tags.ts`, `apps/desktop/src/game/store.ts`, `apps/desktop/src/ui/ShopPanel.tsx`, test `apps/desktop/src/game/tags.test.ts` (exists — append).

1. In `tags.ts` add:
```ts
/** Permanently drop an owned tag (player cleanup). Refuses the last selected tag. */
export function removeTag(tags: OwnedTag[], name: string): OwnedTag[] | null {
  const target = tags.find((t) => t.name === name)
  if (!target || target.level <= 0) return null
  const rest = tags.filter((t) => t.name !== name)
  if (target.selected !== false && !rest.some(isTagSelected)) return null
  return rest
}
```
RED: test removeTag drops owned, keeps others, refuses last selected (3 asserts).
2. In `store.ts` next to `soloTag` action add `deleteTag: (name) => {...}` using `removeTag(get().tags, name)`, `set({ tags: next })`, `get().save()`, toast `Tag ${name} removed.`; return boolean.
3. In `ShopPanel.tsx` pill row (~line 186-220): owned pills get a trailing bare icon button per DESIGN.md (`p-1 text-retro-muted hover:text-rose-400`, lucide `X` `w-3 h-3`, `aria-label={`Delete ${t.name}`}`) calling `deleteTag`. Keep the existing click=toggle/solo gestures; the × is the discoverable delete.
Verify: `cd /i/goongrid/apps/desktop && npx vitest run src/game/tags.test.ts` → all pass; `npx tsc --noEmit` clean.
Commit: `feat(idle): delete owned tags from the pill row`.

### T2 — Visible solo + merged pills (combined search)

Files: `src/ui/ShopPanel.tsx`, `src/game/tags.ts`, `src/game/store.ts` (feedQuery pass-through), tests in `tags.test.ts`.

1. Solo affordance: on owned pill contextmenu (right-click) call `soloTag(t.name)`; add the lucide no-wrap: reuse existing `onClick` shift/middle logic, plus `onContextMenu={(e) => { e.preventDefault(); soloTag(t.name) }}`. Tooltip text: `right-click = solo`. (The hidden-gesture problem is the bug; no new UI row.)
2. Merged search: in `tags.ts`
```ts
/** Merged query for two pills: booru AND syntax — "a b" is already the combo query. */
export function mergeTagNames(a: string, b: string): string {
  return a === b ? a : [a, b].sort().join(' ')
}
```
3. In `ShopPanel.tsx` pill row: double-click (or click when `mergeArm` state set) — simplest lazy control: a small lucide `Link2` icon button on owned pills that toggles `mergeSel: string | null`; second pill's Link2 press calls store action `mergeTags(a,b)`:
```ts
mergeTags: (a, b) => {
  const s = get()
  const ta = s.tags.find(t => t.name === a), tb = s.tags.find(t => t.name === b)
  if (!ta || !tb || ta.level <= 0 || tb.level <= 0) return false
  const merged: OwnedTag = { ...deriveTagStats(normalizeCustomTag(a) + '_' + normalizeCustomTag(b), 1), name: normalizeCustomTag(a) + '_' + normalizeCustomTag(b), level: Math.min(MAX_TAG_LEVEL, Math.max(ta.level, tb.level)), selected: true }
  set({ tags: [...s.tags.filter(t => t.name !== a && t.name !== b), merged] })
  get().save(); set({ toasts: [...] })  // same toast pattern as deleteTag
  return true
}
```
Merged tag name uses `_` join (feedQuery sends it as one token; booru ANDs space-separated tags — `queryVariants` ladder in `src/services/booru.ts:223` already degrades 4-5 tag queries, and a 2-word combo is exactly the proven-good top-2 rung). Verify with a store test: merge two owned pills → one pill, both gone, feedQuery contains `a_b`, income = max levels.
RED first in `store.test.ts` (note mock pitfall: import from `./tags`, don't add new named imports from `../services/booru`).
Commit: `feat(idle): solo on right-click, merge two pills into a combined-search tag`.

### T3 — Purge a picture ("I never want to see this again")

Files: `src/components/grid/GridWorkspace.tsx` + `src/components/IdleOverlay.tsx` (the click target views), `src/game/store.ts`, `src/services/booru.ts`, tests `src/game/store.test.ts`.

1. Store action:
```ts
purgePost: (post: { id: string; tags: string[] }) => {
  const s = get()
  // permanent: seen-set so it never repeats in feed lists
  get().markPurge?.(post.id)
  // smart: the 3 rarest content tags become anti-tags (skip genre noise)
  const content = rankTags(post.tags).filter(t => !isNoise(t.name) && !s.userExcludes.includes(t.name)).slice(0, 3)
  for (const t of content) get().addUserExclude(t.name)
  get().save()
  set({ toasts: [...s.toasts, { id: toastSeq++, msg: 'Purged — related tags excluded. Undo? via Settings → Feed.' }] })
}
```
(`rankTags`, `isNoise`, `addUserExclude`, `toastSeq` all already in these files — wire, don't write.) `markSeen(id)` is already exported from booru but store.ts must NOT import it directly (mock pitfall, see gates note) — route through the existing skip/advance path which already calls remember/markSeen internally; verify by reading `src/game/store.ts` skipGrid/advanceFeed: they mark seen today. If the purge happens on the CURRENTLY displayed post, the plain "next/discard" call already marks seen — purgePost only needs to ADD the excludes step + evict bytes.
2. Evict the bytes: call existing `evictImage(post.url)` (from `../services/imageCache`) — store already imports it for drains; reuse.
3. UI: on the idle image, a bare lucide `Ban` icon (top-right overlay of the slim bar, `aria-label="Never show this again"`) → `purgePost`. Icon-only, no wrapper (DESIGN.md).
4. Undo path stays simple: excludes are already removable in `FeedTuneStep`/settings — the toast just points there (no undo machinery, YAGNI).
Verify: store test — purgePost on a post with tags [1girl, solo, x] adds ≤3 excludes, respects MAX_USER_EXCLUDES, post id lands in seen (assert via `isSeen` through booru module in booru.test.ts where the mock doesn't apply).
Commit: `feat(idle): purge a picture — never repeat (seen), never resurface (smart excludes), bytes evicted`.

### T4 — Co-occurrence blockers ("tags that shouldn't display alongside")

Files: NEW `apps/desktop/src/game/tagCooccur.ts` + `tagCooccur.test.ts`; hook into `sanitize()` in `src/services/booru.ts` + the electron mirror `parseBooruOrgHtml`/`matchesQuery` gate in `electron/main.cjs`.

Algorithm (deterministic, exclusion-derived, ponytail-simple):
```ts
/** Learned pairs: when the player purges posts, record tag pairs from those
 * posts. A pair is blocked when it appeared in >= 2 purged posts AND neither
 * tag is part of the player's current selected feed query (protects intent). */
export interface CoRule { a: string; b: string; count: number }
export function learnPurge(purgedTags: string[], rules: CoRule[]): CoRule[]  // bump/insert pairs from top-6 content tags
export function blockedPair(postTags: string[], rules: CoRule[], feedTags: Set<string>): boolean {
  return rules.some(r => r.count >= 2 && postTags.includes(r.a) && postTags.includes(r.b)
    && !feedTags.has(r.a) && !feedTags.has(r.b))
}
```
Persist in save blob as `coRules` (cap 200 rules; prune count<2). Wire: `sanitize()` drops posts whose tags hit `blockedPair` (pass selected tag set). Electron path: main.cjs filters tagless-WAF pages only; sanitize parity means the renderer re-gates the same list after IPC — confirm by reading `remember()/sanitize` call order in `fetchPosts`; renderer gate is enough, do NOT duplicate in main.cjs (DRY: one gate, one place — verify the IPC path actually calls sanitize() before trusting; if it doesn't, that's a T7 finding).
TDD: test learnPurge (2 purges sharing (x,y) → rule count 2), blockedPair true for co-tagged post, false when one tag is in the feed query, false at count 1.
Commit: `feat(idle): co-occurrence blockers learned from purges, intent-safe`.

### T5 — Close event gaps: purchase + repost notifications

Files: `apps/api/src/cards.ts` (buyCard ~line 567), find repost route (`apps/api/src/routes/` — grep `repost`), `apps/api/src/notifications.ts` (types), tests beside each (`cards.test.ts` etc.).

1. Extend union line 20: add `'card_purchase' | 'repost'` (keep `card_received` — it's the gift path, different event).
2. In `buyCard` success branch (after seller payout, sellerId known): `await createNotification(db, sellerId, 'card_purchase', \`${buyerName} bought your card\`, caption, { card_id, buyer_id })`. `createNotification(db,...)` already exists (notifications.ts:48). Pass `name` into buyCard or fetch it in the route (`routes/cards.ts:91` has c.get orbitId — fetch buyer display name there and pass it; do NOT re-query inside the service).
3. Repost route (grep for the handler that inserts the repost row; desktop renders `is_reposted` already): notify original author `createNotification(db, authorId, 'repost', \`${name} reposted your card\`, null, { post_id })`. Skip self-repost (`if (authorId === actorId) skip`).
4. Idempotence guard (feed fan-out repeats): reuse `markNotificationsRead` cadence only — no new dedupe table (YAGNI; a repost/buy is a discrete transaction).
TDD per route: RED "buy card creates card_purchase row for seller" against the existing d1-mock test harness (`notifications.test.ts` shows the pattern); same for repost. Expected: 1 row, correct type, self-buy/self-repost 0 rows.
Verify: `cd /i/goongrid/apps/api && npx vitest run src/cards.test.ts src/routes` → green.
Commit: `feat(api): purchase + repost notifications`.

### T6 — Instagram-style grouped notification list

Files: `apps/desktop/src/components/NotificationsPanel.tsx` (+ new `groupNotifications.ts` util + test). Client-side fold over the existing fetched list (poll already in `useLobby.ts:216`); NO schema/server change.

```ts
// src/utils/groupNotifications.ts
export interface NotifItem { id: string; type: string; title: string; body: string | null; data: unknown; read: number; created_at: string }
export interface NotifGroup { key: string; type: string; icon: string; actors: string[]; subject?: string; items: NotifItem[]; unread: number; latest: string }
/** Fold flat rows into "Rafael and 4 others liked your card" groups: same type
 * + same subject within 24h collapse; ordering by newest group. */
export function groupNotifications(rows: NotifItem[]): NotifGroup[]
```
Key: `type + '|' + (data?.card_id || data?.post_id || data?.follower_id || '')`. Title renderer (in panel):
- 1 actor: `${name} liked your card`
- n>1: `${firstName} and ${n - 1} others liked your card`
- click → mark read for all `items` (existing `/api/notifications/read` accepts ids array — check useLobby.ts:939 shape, pass group ids).
Extract names WITHOUT parsing the title string (title already says "X liked..." — instead parse actor from `data` fields, fallback: strip regex `/^(.+?) (liked|commented|followed|reposted|bought|sent)/`). Keep the existing per-row rendering as the un-grouped fallback so pm/system rows are untouched (only like/comment/follow/repost/card_purchase/card_received collapse).
TDD: `groupNotifications.test.ts` — 6 like rows same card 3 actors → 1 group `actors.length 3`; different cards stay separate; 24h+ apart separate; ordering newest-first.
UI: replace `notifications.map` body (~line 176-218) with groups.map; group row = TYPE_ICONS[group.icon] + rendered sentence + relative time of `latest`; tap marks group read. Existing glass tokens (bg-glass/border-border-glass), no emoji.
Commit: `feat(ui): grouped activity notifications (Instagram-style fold)`.

### T7 — Retrieval hygiene audit (fixes fall out of the audit, commit per finding)

Read-only sweep first; findings become mini-TDD tasks. Checklist with commands (run from `apps/desktop`):

1. Repetition residual: `grep -n "markSeen\|remember(" src/services/booru.ts` — confirm EVERY response path (IPC + directFetch + moebooru + html scrapers) funnels through `remember()`/`markSeen` before render. If any path (e.g. imhentai/redgifs untagged, caption hunts) appends without marking, that's finding 1: mark at the single join point in `fetchPosts`, not per-branch.
2. Blocked loads: re-run the honesty probe per source class from `references/booru-sources.md` (skill dir): HEAD 200 on full-image bytes for one realbooru (.jpeg mapping), one booru.org sub (pid page), one gelbooru. Failures → Referer-map sync (three places rule: `imageCache.cjs`, `main.cjs httpGet`, vite `/px`).
3. Polluted UI: screenshot-free check = grep the idle views for text chrome beyond the slim bar: `grep -n "text-" src/components/IdleOverlay.tsx | wc -l` and eyeball that the IMAGE is the click target (DESIGN house rule). Any info block that covers image center → move to the bar.
4. List TTL starvation: confirm FEED list memo TTL stays 10min (`grep -n "FEED_TTL" electron/imageCache.cjs`) and query-key rotation can still refill after seen-saturation (`queryVariants` ladder). If a saturated query shows "Sources offline" with cached bytes, add empty-on-all-seen so rotation refetches (finding → test).
Expected output: 0 unmarked paths, HEAD 200s, ≤1 line of chrome over the click target.
Commit(s): `fix(feed): <finding>` each.

## Final gates (all four green before push)

```
cd /i/goongrid/apps/desktop && npx vitest run          # 634 + new, 0 fail
cd /i/goongrid/apps/api   && npx vitest run            # 846 + new
cd /i/goongrid/apps/desktop && npx tsc -p tsconfig.json --noEmit
cd /i/goongrid/apps/desktop && npm run lint            # 0 errors
node electron/imageCache.test.cjs                      # CJS suite still green
```

## Risks, tradeoffs, open questions

- Merged tag `a_b` loses per-tag level economy (two pills' income folds into max level): acceptable (player chooses); flag in toast `levels combined: best kept`. Open Q: player may prefer a temporary "query merge" without consuming pills — if pushback, swap store action to a `combinedQuery` field only (1-line change, pills untouched).
- T4 blocking count>=2 threshold is a taste knob; expose nothing, constant with `ponytail:` comment naming the upgrade (per-player tuning in Settings) if false-positives bite.
- Purge adds up to 3 excludes silently → over-aggressive feed shrink; mitigation: excludes visible + removable in existing FeedTuneStep; toast says it happened.
- Grouping client-side re-folds every poll tick: O(n≤50), no memo needed.
- `createNotification` from within `buyCard` transaction: D1 write after payout; failure must NOT roll back the purchase (fire-and-await with try/catch swallow + console, matches existing follow-notify pattern).
- Fleet agents 429'd twice this week — execute serially; do not re-dispatch.
- Build stays deferred per standing "deixe o build pra depois" until the user says go.
