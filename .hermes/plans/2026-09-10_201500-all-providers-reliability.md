# Plan: all feed providers reliable (sw.js, /api/pm 401, imhentai 403, idle-credit 400)

## Goal

Eliminate the four console errors so every feed provider (realbooru, booru.org subs, konachan, yandere, redgifs, imhentai, paheal, tbib, xbooru) loads and displays with zero noise.

## Current context / assumptions

- Repo root: `I:/goongrid`. Desktop app: `apps/desktop`. API sidecar: `apps/api`.
- Dev runs on `npm run dev` in `apps/desktop` (vite `:5173` + sidecar `:8790`).
- Realbooru was just fixed this session (uncommitted changes in `apps/desktop/electron/main.cjs`, `apps/desktop/src/services/booru.ts`, `apps/desktop/vite.config.ts` — `/px` now sends per-host `Referer`). Do not regress those.
- Error 1 `sw.js Failed to convert value to 'Response'` is INDEPENDENT of providers (service-worker bug, fires on any offline/cache-miss navigation).
- Errors 2 (`/api/pm` 401 x2) are the mail-mode detection probe working as designed (`apps/desktop/src/utils/mail-mode.ts` — unsigned GET, FULL node answers 401 → `legacy`). The bug is only that it fires TWICE (no in-flight dedupe) and looks like a failure.
- Error 3 (`/booru/imh/gallery/<id>/` 403 x3) is Cloudflare on imhentai gallery pages via the vite `/booru/imh` proxy. Verified: no-headers → 403, browser UA → 200, UA+Referer → 200. So the proxy path CAN work; the 403s come from burst fetching (search + up to 3 galleries back-to-back, see `imhentaiDirect` in `apps/desktop/src/services/booru.ts:468`) with no Referer and no gap.
- Error 4 (`POST /api/economy/idle-credit` 400) is the server earnings envelope rejecting an honest flush. Root-cause candidate: first credit after boot registers `gps: 0` (client sends `gps: Math.floor(c.gps || 0)` in `apps/desktop/src/game/walletSync.ts:46` before measuring a rate) → anchor `prev.gps = 0` → every later credit is checked against `idleEnvelope(0, elapsed) = ~5` → any real amount 400s forever (`apps/api/src/routes/economy-idle.ts:108-118`).
- Parallel agent (opencode) works in the same worktree: NEVER `git add -A`; commit only explicit paths you touched.

## Architecture / proposed approach

Route all browser-side provider traffic through the two choke points that already exist (`/px` byte proxy + `/booru/*` HTML proxies in `apps/desktop/vite.config.ts`, both with per-host `Referer`), fix the sw.js promise bug, dedupe the mail probe, and un-poison the idle-credit zero-gps anchor server-side. Four small fixes, one per error, each with its own RED→GREEN test and commit.

## Step-by-step tasks

### Task 1 — sw.js: never resolve `respondWith` with undefined

File: `apps/desktop/public/sw.js` (lines 48-65).

Root cause: `const networkFetch = fetch(...)...; return networkFetch || cachedResponse` — `networkFetch` is a Promise (always truthy), so on network failure the `.catch(() => cachedResponse)` resolves `undefined` when nothing is cached → `respondWith(undefined)` → `TypeError: Failed to convert value to 'Response'`.

1. Replace the fetch handler body (lines 48-65) with:
```js
  event.respondWith(
    caches.match(event.request).then((cachedResponse) =>
      fetch(event.request)
        .then((networkResponse) => {
          // Cache successful responses
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (cachedResponse) return cachedResponse;
          return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
        }),
    ),
  );
```
2. Verify: `cd /i/goongrid/apps/desktop && npx vitest run` — full suite green (sw.js itself has no harness; verification is manual, see Tests section).
3. Commit: `git add apps/desktop/public/sw.js && git commit -m "fix(sw): return 503 instead of undefined on cache-miss offline"`

### Task 2 — mail-mode probe: dedupe in-flight detection (kills the double 401)

File: `apps/desktop/src/utils/mail-mode.ts`. Test: `apps/desktop/src/utils/mail-mode.test.ts`.

The two 401 lines are React StrictMode / two components calling `detectMailMode` concurrently — `cache` only stores the resolved value, so concurrent callers each fire a request. Browser network-error logging cannot be suppressed from JS; firing once is the fix.

1. Write failing test first in `apps/desktop/src/utils/mail-mode.test.ts`:
```ts
it('concurrent detects share one request', async () => {
  _resetMailModeCache()
  let calls = 0
  const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return new Response('{}', { status: 401 }) }
  const [a, b] = await Promise.all([detectMailMode('http://x', slow), detectMailMode('http://x', slow)])
  expect(a).toBe('legacy'); expect(b).toBe('legacy'); expect(calls).toBe(1)
})
```
2. Run: `cd /i/goongrid/apps/desktop && npx vitest run src/utils/mail-mode.test.ts` — expect FAIL (`expected 2 to be 1`).
3. Implement: add module-level `const inflight = new Map<string, Promise<MailMode>>()`; in `detectMailMode`, after the `known` check, return `inflight.get(base)` if present; otherwise wrap the fetch in an async IIFE, store in `inflight`, `finally { inflight.delete(base) }`:
```ts
const inflight = new Map<string, Promise<MailMode>>()
// inside detectMailMode, after known check:
const ongoing = inflight.get(base)
if (ongoing) return ongoing
const p = (async (): Promise<MailMode> => {
  try {
    const res = await fetchImpl(`${base}/api/pm`, { method: 'GET' })
    const mode: MailMode = res.status === 404 ? 'courier' : 'legacy'
    cache.set(base, mode)
    return mode
  } catch {
    return cache.get(base) ?? 'legacy'
  } finally {
    inflight.delete(base)
  }
})()
inflight.set(base, p)
return p
```
4. Re-run the test file — expect PASS. Full gate: `npx vitest run src/utils/mail-mode.test.ts src/hooks/useCourierDms.test.tsx`.
5. Commit: `git add apps/desktop/src/utils/mail-mode.ts apps/desktop/src/utils/mail-mode.test.ts && git commit -m "fix(mail): dedupe in-flight mode probe so /api/pm 401 fires once"`

### Task 3 — imhentai 403: Referer + pacing on `/booru/imh` gallery fetches

Files: `apps/desktop/vite.config.ts` (`^/booru/imh` entry ~line 157), `apps/desktop/src/services/booru.ts` (`imhentaiDirect`, line 468).

Two changes, proxy-side (headers) + client-side (pacing). Electron path needs nothing: `electron/main.cjs` `httpGet` already sends `Referer: https://imhentai.xxx/` (line 239).

1. RED test first — gallery 403 is skipped, round survives (append to `apps/desktop/src/services/booru.test.ts`, follow existing mock style in that file):
```ts
it('imhentaiDirect skips 403 galleries and keeps the round alive', async () => {
  // mock search page returning ids 111/222, gallery 111 -> 403, gallery 222 -> cover html
  // expect posts length 1 and source imh-direct — see booru.test.ts existing imh mocks for shape
})
```
Run `npx vitest run src/services/booru.test.ts` — FAIL until pacing/skip verified (the skip path `continue` already exists at line 482; if the test passes immediately, keep it as the regression lock and move on).
2. Proxy fix in `apps/desktop/vite.config.ts`: add `configure` to the `^/booru/imh` entry injecting `Referer: https://imhentai.xxx/` on proxied requests (same pattern as the existing `^/rg-media` entry's `configure` — copy that block's shape):
```ts
      '^/booru/imh': {
        target: 'https://imhentai.xxx',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/imh/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://imhentai.xxx/')
          })
        },
      },
```
3. Pacing fix in `imhentaiDirect` (`apps/desktop/src/services/booru.ts:476` loop): 250 ms gap between gallery fetches so Cloudflare doesn't see a burst (search + 3 galleries back-to-back is what trips it):
```ts
    for (const id of ids) {
      if (posts.length >= limit) break
      if (posts.length > 0 || id !== ids[0]) await new Promise((r) => setTimeout(r, 250))
```
Simpler exact form — insert as the first line inside the `for` loop body after the limit check:
```ts
      await new Promise((r) => setTimeout(r, 250))
```
(ponytail: fixed 250 ms sleep, no backoff; add backoff only if 403s persist.)
4. Verify live (needs `npm run dev` restarted so the new proxy config loads):
   - `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/booru/imh/gallery/1732327/` — expect `200`.
   - Browser: idle game with an imhentai-friendly tag → gallery images load, no `/booru/imh/gallery` 403 in console.
5. Commit: `git add apps/desktop/vite.config.ts apps/desktop/src/services/booru.ts apps/desktop/src/services/booru.test.ts && git commit -m "fix(imh): referer + pacing on gallery fetches to dodge Cloudflare 403"`

### Task 4 — idle-credit 400: zero-gps anchor poisons the envelope

File: `apps/api/src/routes/economy-idle.ts` (lines 107-119). Test: `apps/api/src/routes/economy-idle.test.ts`.

1. First read `economy-idle.ts` lines 121-162 to see the anchor write (`lastCredit.set`), then write the failing test in `economy-idle.test.ts` (follow the file's existing `app.request('/api/economy/idle-credit', ...)` + `authHeaders` shape):
```ts
it('credit after a gps:0 registration is not envelope-rejected', async () => {
  // POST { amount: 10, session, gps: 0 } -> 200 (registers anchor 0)
  // POST { amount: 50, session, gps: 100 } (new Idempotency-Key) -> expect 200, got 400 before fix
})
```
Run from `apps/api`: `npx vitest run src/routes/economy-idle.test.ts` — expect FAIL (second POST 400).
2. Implement — one-condition change at line 108: a zero-gps anchor carries no rate info, so treat it as unregistered (trusted flush, re-anchor):
```ts
  if (!prev || prev.gps === 0) {
    effectiveGps = claimGps === null ? 0 : Math.min(Math.max(claimGps, 0), MAX_CLAIMED_GPS)
  } else {
```
(rest of the else branch unchanged). This self-heals: the tick after any gps:0 registration re-anchors at the real rate.
3. Re-run `npx vitest run src/routes/economy-idle.test.ts` — PASS. Wider gate: `npx vitest run src/routes/economy-routes-common.test.ts src/routes/auth-middleware.test.ts`.
4. Commit from repo root: `git add apps/api/src/routes/economy-idle.ts apps/api/src/routes/economy-idle.test.ts && git commit -m "fix(economy): zero-gps anchor bypasses envelope instead of 400ing honest flushes"`

### Task 5 — full verification gate (all providers, end to end)

1. `cd /i/goongrid/apps/desktop && npx vitest run` — expect `Test Files 77+ passed, Tests 618+ passed` (count grows with the new tests).
2. `node electron/imageCache.test.cjs && node electron/imageCacheMemory.test.cjs && node electron/customFolders.test.cjs && node electron/secureStore.test.cjs` — all OK.
3. From `apps/api`: `npx vitest run src/routes/` — green.
4. Restart `npm run dev`, open the idle game, add `skylar vox` to tags: realbooru images appear (no `Sources offline`), no `sw.js` TypeError, single `/api/pm` 401 pair, no `/booru/imh` 403, no `idle-credit` 400.

## Tests / validation

TDD per task (RED test → run → FAIL → minimal GREEN → PASS → commit), exactly as specified in each task above. Manual-only checks: sw.js offline behavior (DevTools Application → unregister sw → reload → offline → no TypeError) and Task 5 browser pass. Never `git add -A` (parallel opencode agent in same worktree).

## Risks, tradeoffs, and open questions

- imhentai 403 root cause is inferred (burst + no Referer), not proven — the proxy passes the browser UA and single-shot curl 200s. If Referer+pacing doesn't clear it, next step is routing gallery fetches through `/px` (server-side UA + Referer, already wired for `imhentai.xxx` in the uncommitted `/px` patch) or parsing covers from the search page to skip gallery fetches entirely.
- `/api/pm` 401 console lines shrink to one pair but never vanish — the browser logs failed network requests regardless of handling. Alternative (authenticated probe) would defeat the probe's purpose; documented as expected.
- The `prev.gps === 0` trust re-opens a one-shot mint (up to 1M) for a client that deliberately registers 0 — accepted, matches the existing documented best-effort envelope (a modified client on shared nodes is already capped at 1.5x sane rate, not zero).
- `idle-credit` 400 diagnosis is a candidate, not confirmed — if the failing request body shows `amount > maxAllowed` with a healthy anchor instead, the real cause is long-offline big flushes exceeding the envelope, and the fix becomes client-side chunking below the envelope (walletSync already chunks at 1M; envelope chunking needs the server's `maxAllowed` from the 400 body).
- Open: exact `idle-credit` 400 response body from the user's console (Network tab → response JSON) would confirm Task 4's diagnosis before implementing — `gps required` vs `exceeds your registered earning rate` lead to different fixes.
