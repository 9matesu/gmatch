# Plan: idle feed correctness, domination transparency, economy nerf, profile/gallery/IP/default-server

## Goal

Fix the eight reported defects in the gMatch desktop app: repeated/untagged idle-clicker images, domination glass transparency, money too easy, sidebar XP chip, followers modal, gallery image viewer overflow, IP exposure, and default server (gmatch.fly.dev).

## Current context / assumptions

- Repo root `I:/goongrid`; app `apps/desktop` (Electron + Vite + React + TS, zustand), API `apps/api` (Hono sidecar, port 8790). Branch `fix/browser-perf-ui-sweep`.
- Gates (AGENTS.md): `npm run lint` 0 errors, `npx vitest run` green, `npx tsc -p tsconfig.json --noEmit` clean. Run all from `apps/desktop`.
- Parallel-agent rule: NEVER `git add -A`; commit explicit paths.
- Feed architecture (verified this session):
  - Electron IPC path: `electron/main.cjs` `fetchBooru` → SOURCES round-robin → `parseDanbooruJson`/`parseMoebooruJson`/`parseRealbooruHtml`/`parseBooruOrgHtml` → `imageCache.getFeedCache(query)` memo (TTL 24h) → renderer.
  - Browser/dev path: `src/services/booru.ts` `directFetch` (Vite proxies `/booru/*`).
  - Dedupe: `src/services/booru.ts` `remember()`/`isSeen()` with `SEEN_KEY` localStorage, `SEEN_CAP = 50_000`. Only the BROWSER path calls `remember(sanitize(...))` (booru.ts lines 369-416, 534).
  - `sanitize()` applies `matchesQuery(post, variant)` — but ONLY in `src/services/booru.ts`. The Electron path (`main.cjs`) has NO query-match filter: `parseBooruOrgHtml` fetches tagLESS `pid=` pages (Cloudflare WAF workaround) and returns whatever random latest posts it finds. → ROOT CAUSE 1 of "tags don't work" in the packaged app; ROOT CAUSE 2 of "images are repeated": the Electron path never marks posts seen (renderer seen-set is populated via `markSeen` only through `remember()` on the direct path; the IPC path's `fetchPosts` wrapper — check line ~534: IPC results DO go through `remember(sanitize(res.posts, req.tags))` at booru.ts:534, so if THAT sanitize also runs matchesQuery, tagless subs' posts get FILTERED OUT — meaning electron returns non-matching posts, browser-side filters them to zero, the 24h feed-cache memo (`getFeedCache`) keeps returning the same all-rejected list for 24 hours, and rotation starves → the game shows repeats/offline. Fix = filter SERVER-side (main.cjs) + don't memo a query's tagless results under the query key without tags.
- PC domination UI: `src/components/domination/PCDominationTab.tsx` uses `glass-inset`, `bg-surface-interactive/30`, `opacity-45` — user says too transparent (content bleeds through panels).
- Economy: `src/game/economy.ts` `passiveGps` already "nerfed by 50%" (`* 0.5`). Offline resume pays 50% (see store/save). User wants stacking harder: cut passive again + cut offline rate.
- XP chip: `src/components/home/SidebarNav.tsx` lines ~607-630 "Currency HUD" block renders a single XP tile. Remove block.
- Followers modal: `App.tsx` 3439 + `ProfileView.tsx` 70 set `followersModalState`; `GlobalModals.tsx` line ~310 renders it. Counts at `src/components/profile/GMatchProfile.tsx:147-152`. Task = adapt modal styling/behavior to house glass tokens (user: "adapt to our UI"), verify click opens the right tab.
- Gallery & cards viewer: image zoom viewer renders INSIDE the panel (overflows under the gallery tab). There is already a draggable-modal pattern in `src/components/SpectateModal.tsx` (`dragOffset`, `setDragOffset`, fixed position, z-index). Reuse that shape: portal the viewer to `document.body` with `fixed z-[1200]` and a drag handle. Viewer component to change: the zoom/lightbox used by `src/components/StashPanel.tsx` / `src/components/grid/IdleGalleryView.tsx` / card detail (`src/utils/openCard.ts` → route). Implementer must grep `zoomModal` / `openCardDetail` to find the exact owner; the requirement: NEVER position:absolute inside a tab panel.
- IP exposure: renderer grep shows no direct IP render today, but `ServerTab.tsx` / `server-host-pending.ts` / domination panels can surface host URLs containing LAN IPs (e.g. `http://192.168.x.x:8790`). Add a `maskIp()` util + apply wherever a server URL or address is shown in Settings/Profile; add an API test asserting no user profile response carries the client IP (`clientIpForLog` in `apps/api/src/middleware/security-headers.ts` is log-only — keep it that way; add a guard test).
- Default server: `apps/desktop/src/utils/api.ts` `computeApiBase()` falls back to `http://127.0.0.1:8790`; `electron/server-mode-core.cjs` defaults `{mode:'host', url: hostUrl}`. User wants default = `https://gmatch.fly.dev` (central already points there: `src/utils/central.ts:8`). Browser dev (localhost vite proxy) must keep working; local sidecar stays opt-in via existing server-mode switch / `VITE_API_URL`.

## Architecture / proposed approach

Filter and dedupe in the Electron main (mirror the renderer's `matchesQuery` + seen-marking) so the 24h feed-cache never stores off-tag posts, and cap feed-cache entries per query with fresh-variant rotation. UI fixes are local: remove sidebar HUD tile, opaque-ify domination surfaces, portal the gallery viewer as a draggable modal, add `maskIp` at every server-URL render, flip the API base default to `https://gmatch.fly.dev`, and halve passive/offline income.

## Step-by-step tasks

### Task 1 — Electron path: query-match gate for booru.org subs (tags actually work)

File: `apps/desktop/electron/main.cjs`.

1. In `parseBooruOrgHtml(html, sub, captions)` (line ~389), after tags are parsed (line ~402), add a query gate. Change the signature to accept the query: `parseBooruOrgHtml(html, sub, captions, query)` and after `const tags = tagsPart.split(/\s+/).filter(Boolean)`:
```js
    // WAF forces tagless browsing; enforce the query locally so the feed
    // still shows what the player asked for (mirror of matchesQuery).
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length) {
      const tagSet = tags.map((t) => t.toLowerCase().replace(/[\s-]+/g, '_'))
      const ok = tokens.some((tok) => tagSet.some((t) => t === tok || t.includes(tok) || tok.includes(t)))
      if (!ok) continue
    }
```
   (`continue` is valid: this code is inside the existing `while ((m = imgRegex.exec(html)) !== null)` loop — place the gate BEFORE the `posts.push`.)
2. Update the seven booru.org source entries (hgoon, blacked, allgirl, rule34-org, qoh, celeb, footfetish) to pass the variant: `parseBooruOrgHtml(html, 'hgoon', captions, variant)` (the fetch closures take `(_variant, n, captions)` — rename `_variant` to `variant`).
3. Verify: `cd /i/goongrid/apps/desktop && node electron/imageCache.test.cjs && npx vitest run src/services/booru.test.ts` — both green (existing tests mock parse via fetch, unaffected).
4. Commit: `git add apps/desktop/electron/main.cjs && git commit -m "fix(feed): query-match gate on booru.org subs in electron path"`

### Task 2 — Feed cache: no 24h lock-in of an exhausted list

Files: `apps/desktop/electron/imageCache.cjs`, `apps/desktop/electron/main.cjs`.

`getFeedCache` returns the same list for 24h; once the renderer dedupes it, the query is dead. Make the memo self-heal: store `ttl` 10 min again for ROTATING sources and keep 24h only for JSON/DAPI sources whose pages are stable.

1. In `imageCache.cjs` change `const FEED_TTL_MS = 24 * 3600 * 1000` back to `const FEED_TTL_MS = 10 * 60 * 1000` and `setFeedCache(query, posts, ttlMs = FEED_TTL_MS)` storing `{ posts, ts: Date.now(), ttl: ttlMs }`; `getFeedCache` compares `hit.ttl ?? FEED_TTL_MS`.
2. In `main.cjs` `fetchBooru` cache set (line ~774): `imageCache.setFeedCache(variant, posts, source.id === 'realbooru' || source.id === 'konachan' || source.id === 'yandere' ? 24 * 3600 * 1000 : 10 * 60 * 1000)` — actually simpler and lazy: one rule, 10 min for everything. Use `imageCache.setFeedCache(variant, posts)` and DON'T pass ttl (the 24h "one API call" requirement is honored by the renderer's 24h image-bytes cache; the feed LIST rotating every 10 min is what kills the repeats). Decision: revert to 10 min unconditionally, comment `// ponytail: 10min list TTL; bytes cache is the 24h one-call guarantee`.
3. Verify: `node electron/imageCache.test.cjs` — if it asserts TTL, update the assertion to `10 * 60 * 1000` (test is the spec).
4. Commit: `git add apps/desktop/electron/imageCache.cjs apps/desktop/electron/imageCache.test.cjs apps/desktop/electron/main.cjs && git commit -m "fix(feed): 10min feed-list TTL so deduped queries refresh"`

### Task 3 — Electron drain-time seen marking (never repeat, cross-session)

Files: `apps/desktop/electron/main.cjs`, `apps/desktop/src/services/booru.ts`.

Renderer `remember()` at booru.ts:534 already dedupes ALL fetchPosts results (IPC and direct). Check that line applies to the IPC path too — `grep -n "remember" src/services/booru.ts`; if the IPC wrapper returns before reaching line 534, route IPC results through `remember(sanitize(res.posts, req.tags))` exactly like the direct path. RED test first in `src/services/booru.test.ts`:
```ts
it('ipc path marks posts seen so the next round returns fresh ones', async () => {
  // stub window.booruApi.fetchBooru returning [post1,post2] then [post1,post3]
  // first fetchPosts -> 2 posts; second fetchPosts -> only post3 (post1 deduped)
})
```
Run `npx vitest run src/services/booru.test.ts` → expect FAIL (ipc path returns post1 again) → implement → PASS. Commit `git add src/services/booru.ts src/services/booru.test.ts && git commit -m "fix(feed): dedupe ipc-path posts through remember()"`.

### Task 4 — Domination transparency

File: `apps/desktop/src/components/domination/PCDominationTab.tsx`.

The panel chrome uses `glass-inset` + `/30` alpha surfaces that let the desktop bleed through (user complaint: too transparent). Bump the two offenders:
1. Line 548: `'hover:bg-surface-interactive/30'` → `'hover:bg-surface-interactive/60'`.
2. Lines 446/692 track colors: `bg-surface-interactive` → `bg-surface-raised` (more opaque token).
3. The card containers: find `className` strings containing `glass-inset` on the OUTER panels only (not inner chips) and switch to `glass` (check `src/ui/glass.css` or tokens; if `glass` is also thin, add `bg-retro-bg/80`). Only outer panels — do NOT darken disabled-opacity states (line 609 `opacity-45` is intentional disabled styling).
Verify: `npx vitest run src/components/domination/PCDominationTab.test.ts && npm run lint` (style-only; no assertions break). Screenshot check is the user's after dev restart.
Commit: `git add apps/desktop/src/components/domination/PCDominationTab.tsx && git commit -m "style(domination): opaque-er panel surfaces"`

### Task 5 — Economy nerf (harder to stack)

Files: `apps/desktop/src/game/economy.ts`, tests in `economy.test.ts`.

1. RED test: append to `src/game/economy.test.ts` (follow existing fixture shape in that file):
```ts
it('passive income is capped at 25% of tag+gallery sum (stacking nerf)', () => {
  const gps = passiveGps({ tags: [{ income: 10, level: 1 } as any], gallery: [], shards: 0, caps: [] } as any, 0)
  expect(gps).toBeCloseTo(2.5)
})
```
   Run `npx vitest run src/game/economy.test.ts` → FAIL (0.5 → 5).
2. In `economy.ts` line ~57 change trailing `* 0.5` → `* 0.25` and update the doc comment ("Nerfed to 25% so clicking stays king").
3. Offline rate: `grep -rn "0.5\|offline" src/game/save.ts src/game/store.ts | grep -i "offline"`. Find the offline-gain factor (function `collectOffline`/`offlineGain`) and halve its rate factor the same way (0.5 → 0.25). Add one test in `store.test.ts` mirroring an existing offline test with the new expectation.
4. GREEN: `npx vitest run src/game/economy.test.ts src/game/store.test.ts`.
5. Commit: `git add src/game/economy.ts src/game/economy.test.ts src/game/save.ts src/game/store.ts src/game/store.test.ts && git commit -m "balance: nerf passive and offline g\$ to 25%"` (server `idleEnvelope` already tolerates any rate — no API change).

### Task 6 — Remove XP chip from sidebar

File: `apps/desktop/src/components/home/SidebarNav.tsx` lines ~606-632.

1. Delete the whole "Currency HUD" block: the comment lines 606-608 and the `<div className="px-2 pb-2 shrink-0">…</div>` containing the `[{ icon: Zap, label: 'XP' … }]` map. Keep any sibling markup intact (read ±10 lines before cutting).
2. If `Zap`/`reputation`/`score` imports become unused, remove them (`npm run lint` shows `no-unused-vars` — warnings gate, but clean).
Verify: `npx vitest run src/components/home && npm run lint && npx tsc -p tsconfig.json --noEmit`.
Commit: `git add src/components/home/SidebarNav.tsx && git commit -m "ui(sidebar): drop XP chip"`

### Task 7 — Followers/following modal adapted

Files: `src/components/GlobalModals.tsx` (~line 310), `src/components/profile/GMatchProfile.tsx:147-152`.

1. Open the modal code (`grep -n "followersModalState" src/components/GlobalModals.tsx` to find its JSX). Restyle to house tokens: wrapper `fixed inset-0 z-[1000] bg-black/60`, panel `glass rounded-lg border border-[--color-border-zinc-800]` — copy the exact class recipe from `src/components/feed/SharePostModal.tsx` (same repo, same modal pattern).
2. Ensure BOTH stat chips open it: `GMatchProfile` already wires `onOpenFollowers?.('followers' | 'following')` on the stats row (line 152) — confirm the `following` chip passes `'following'` too (same map). If counts render 0 despite server data, fix the fallback chain at line 147 (`likes_received` fallback is wrong for followers — drop it: `followersCount ?? myUser?.followers_count ?? 0`).
3. Test: extend the existing GlobalModals/GMatchProfile tests or add one in the nearest test file that clicks the followers chip and asserts the modal opens (follow `GMatchDMs.test.tsx`-style rendering; if no modal test harness exists for GlobalModals, a component test on `GMatchProfile` asserting `onOpenFollowers` called with 'followers'/'following' is enough — YAGNI a full modal render test).
Verify: `npx vitest run src/components/profile src/components/GlobalModals* 2>/dev/null || npx vitest run src/components/profile`. Commit explicit paths: "fix(profile): followers modal uses house glass tokens + correct counts".

### Task 8 — Gallery & cards image viewer: draggable independent modal

Files: locate first — `grep -rn "zoomModal\|expandedItemId\|openImage" src/components/StashPanel.tsx src/components/grid/ src/App.tsx | head`. The viewer currently renders inside the tab (overflow). Convert it to a body-portal draggable modal using the `SpectateModal` drag pattern (`dragOffset` state, `onMouseDown` header).

1. Create `src/components/MediaViewerModal.tsx` (~80 lines): `fixed inset-0 z-[1200]` backdrop closing on backdrop click; a `fixed` panel positioned via `style={{ left, top }}` + drag on header (`pointerdown` → capture, `pointermove` → setPos, `pointerup` → release); renders `<img>`/`<video>` centered `max-h-[80vh] max-w-[90vw]`.
```tsx
const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
const drag = (e: React.PointerEvent) => {
  const el = (e.target as HTMLElement).closest('[data-viewer]') as HTMLElement
  const sx = e.clientX - (pos?.x ?? el.getBoundingClientRect().left)
  const sy = e.clientY - (pos?.y ?? el.getBoundingClientRect().top)
  const move = (ev: PointerEvent) => setPos({ x: ev.clientX - sx, y: ev.clientY - sy })
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
}
// panel: <div data-viewer className="fixed z-[1200]" style={pos ? { left: pos.x, top: pos.y } : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }} onPointerDown={drag}>
```
2. Replace the in-panel viewer usage in StashPanel/Gallery/card detail with `<MediaViewerModal url={...} kind={...} onClose={...}/>`. Delete the old absolute-positioned viewer markup (deletion over addition).
3. TDD: small test `src/components/MediaViewerModal.test.tsx` — renders img when `url` set, calls `onClose` on backdrop click (no drag assertion — pointer math is manual-verified).
Verify: `npx vitest run src/components/MediaViewerModal.test.tsx src/components/StashPanel*` + `npx tsc -p tsconfig.json --noEmit`. Commit: "feat(ui): gallery/card images open in draggable modal viewer".

### Task 9 — Never expose a player IP

Files: new `src/utils/ipMask.ts`, render sites found by grep.

1. Add:
```ts
// Mask IPv4/IPv6 hosts in any URL or string before display.
export function maskIp(input: string): string {
  return input
    .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.$2.•••.•••')
    .replace(/\b[0-9a-fA-F:]{6,}:[0-9a-fA-F:]*\b/g, (m) => (m.includes(':') && /\d/.test(m[0]) ? m.slice(0, 4) + ':••••' : m))
}
export function maskedServerUrl(url: string): string {
  try { const u = new URL(url); return maskIp(u.origin) } catch { return maskIp(url) }
}
```
2. TDD: `src/utils/ipMask.test.ts` — `maskIp('http://192.168.4.71:8790')` → `http://192.168.•••.•••:8790` (assert no `.4.71` substring), hostname `localhost` untouched. RED → implement → GREEN.
3. Apply `maskedServerUrl` at every user-visible render of a server URL: `grep -rln "serverUrl\|hostUrl\|server\.url" src/components/settings src/components/servers src/components/domination` and wrap display strings (tooltips, copy buttons may keep the real value ONLY behind an explicit "Copy" click — visible text masked). The host-mode banner in settings showing `http://<lan-ip>:8790` is the main offender.
4. API guard test in `apps/api/src/routes/`: profile GET response body must not contain a dotted-quad matching the request's `x-forwarded-for` — assert in the existing users route test file: `expect(resText).not.toContain('127.0.0.1')` style with a fake client IP header.
Commit: "security: mask LAN/public IPs in all rendered server URLs".

### Task 10 — Default server = gmatch.fly.dev

Files: `src/utils/api.ts`, `electron/server-mode-core.cjs`.

1. `api.ts` `computeApiBase()` (~lines 6-16): change both `return 'http://127.0.0.1:8790'` fallbacks to `return 'https://gmatch.fly.dev'`, keeping the env/preload precedence above them (`VITE_API_URL`, `__API_BASE__`) untouched. Add comment: `// Default: central node. Local sidecar = opt-in via server-mode switch or VITE_API_URL.` BUT keep the vite-dev branch returning `''`/same-origin if one exists (read the function before editing; dev proxying at `:5173` must not break).
2. `server-mode-core.cjs` line 28 default `return { mode: 'client', url: 'https://gmatch.fly.dev' }` (was host). Host mode stays selectable in Settings.
3. Update the shared sync test (`grep -rn "server-mode-core" src electron --include=*.test.* -l`) expectations.
4. Verify both: `npx vitest run` (desktop) + sidecar still launches via explicit host mode (`node electron/server-mode-core.test.cjs` if present, else the vitest twin).
Commit: "config: default server is gmatch.fly.dev (sidecar now opt-in)".

### Task 11 — Full gate + rebuild

1. `cd /i/goongrid/apps/desktop && npm run lint && npx tsc -p tsconfig.json --noEmit && npx vitest run` → 0 errors / 619± tests green.
2. `cd /i/goongrid/apps/api && npm run lint && npx tsc -p tsconfig.json --noEmit && npx vitest run`.
3. `node electron/*.test.cjs` (4 files).
4. Rebuild portable: `npm run dist` — if `EPERM rename win-unpacked.tmp`, rerun with `-c.directories.output="C:/Users/matco/AppData/Local/gmatch-build"` then copy the exe back to `release/`.

## Tests / validation

TDD per task where logic exists (3, 5, 9, 10 + task 2's TTL assertion); style tasks (4, 6, 7, 8) gated by the existing suites + tsc. Final: every task ends with a scoped `git add <paths> && git commit`; the whole wave ends with Task 11's full gate before a build is declared good.

## Risks, tradeoffs, and open questions

- Task 1's query gate shrinks booru.org sub yield (random tagless pages rarely carry a niche tag like `skylar_vox`) — correct behavior (no wrong content), but feed weight must shift to tag-searchable sources: the SOURCES round-robin already rotates; if rounds come back thin, raise the pid range (`rand(10)*20` → `rand(30)*20`) before anything more complex.
- Task 2 shortens the feed cache: more API calls than the literal "ONE call" spec — bytes are still fetched once (24h), lists refresh at 10min. Accept the deviation or accept permanent repeats — repeats were the user complaint.
- Task 5: players mid-run will feel the nerf immediately; server `idleEnvelope` is rate-based so credits keep syncing (lower gps claim). If old saves break (credited > floor(gc)), `pendingDelta` goes negative → idle-debit path exists, safe.
- Task 8: if the gallery viewer is actually a route (`openCardDetail`), making THAT page a modal is bigger scope — in that case apply the modal only to the image zoom layer, leave card routing; note which it turned out to be in the commit message.
- Task 10 flips packaged defaults: first-run users without network see offline banner instead of a dead localhost sidecar — acceptable, banner already exists (`OfflineWarningBanner`).
- Open: whether "currency nerfed everywhere" should also cut heat/crit caps — NOT assumed; only passive + offline changed. Ask before touching click math.
