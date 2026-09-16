# Fix: watch-party "Add and play" 422 while "Add" works (POST /api/watchparty/:id/video)

## Goal

Make "Add and play" in the room queue succeed like "Add" does, by (1) eliminating the
known stale sidecar, then (2) reading the `failed` list the 422 response already carries
and fixing the specific resolution gap it names.

## Current context (traced, verified in code this session)

- Symptom (user-reported): in the watch tab's Queue panel, the **Add and play** button
  produces `POST /api/watchparty/668f4b5c/video -> 422`; **Add** with the same kind of URL
  works. The `:1` in the console line is Chrome's line annotation, not part of the URL.
- Both buttons call the SAME code: `WatchPartyQueue.submit(queueOnly)`
  (`apps/desktop/src/components/watchparty/WatchPartyQueue.tsx:30-50`) ->
  `loadPartyVideos(identity, party.id, urls, queueOnly)`
  (`apps/desktop/src/hooks/watchPartyStore.ts:298-313`) -> same `POST /:id/video` with
  body `{ urls, queueOnly }`. The ONLY difference is the `queueOnly` boolean.
- Server side (`apps/api/src/routes/watchparty.ts:145-195`): `queueOnly` is read at
  line ~158 and consumed ONLY after the 422 gate — the route 422s when
  `urlList.length === 0` (:164) or `added.length === 0` (:180), i.e. **every URL failed
  `resolveMedia`**. Playback selection (`op: 'play'`) happens after. So on current code,
  the two requests are resolution-identical: the button cannot be the cause by itself.
  The real explanations are: different content in the textarea between attempts,
  per-fetch upstream variance (goonchan/WAF), or the whole server being OLD code.
- Stale-server fact: the sidecar listening on :8790 is bun PID 12496 started **15:54**,
  before commit `ac01c2e` (18:11, the goonchan dead-cert host-swap + teaser-skip fix).
  It carries the bug: goonchan pages parse to `media.goonchan.org/preview.mp4` (teaser on
  a TLS-dead host) -> fetch fails -> `resolveMedia` null -> 422. vite (`:5173`) proxies
  `/api` to that sidecar. This alone reproduces "422 on video loads" on current HEAD's
  routes; the "Add works" half may be a different URL, a different room, or a click after
  something reloaded.
- The 422 body ALREADY contains the ground truth: `c.json({ error: PARSE_ERROR, failed }, 422)`
  — a list of which URLs failed. The client throws it away
  (`loadPartyVideos` returns `failed: []` on !res.ok, watchPartyStore.ts:306), which is
  why the user sees only a console 422. Surfacing it is part of the fix (one line).
- Live evidence current HEAD works for goonchan (run this session):
  `bun probe-pmv.ts "https://goonchan.org/video/1-hour-tiktok-gooner-pmv-mUVQm0"`
  -> `resolved: https://test-media.goonchan.org/videos/1-hour-tiktok-gooner-pmv-mUVQm0/micro.mp4`
  (17.6 MB, under the 50 MB store cap; probe 206 video/mp4). Tests pinning this fix:
  `apps/api/src/proxy.test.ts:18-29`.

## Architecture / proposed approach

Step 1 is ops, not code: kill the stale :8790 bun and let the next `npm run dev` (or a
manual `bun run src/serve.ts`) respawn current HEAD. Step 2 is a one-line client change
that surfaces the server's `failed` URLs into the queue error, making any residual
button-dependence self-diagnosing; then reproduce both buttons and fix the named
resolution path only if it still fails. TDD applies to the client line (extend the
existing `WatchPartyQueue.test.tsx`), not to process restarts.

## Step-by-step tasks

### Task 1 — Kill the stale sidecar (2 min, ops)

```
netstat -ano | grep ":8790" | grep LISTENING
powershell -NoProfile -Command "(Get-Process -Id <PID>).StartTime"
```
Expected: PID (previously 12496) with start time EARLIER than today 18:11. If it now
starts AFTER 18:11, HEAD code is already live -> skip to Task 3.
```
powershell -NoProfile -Command "Stop-Process -Id <PID> -Force"
netstat -ano | grep ":8790" | grep LISTENING
```
Expected: second command prints nothing (grep exit 1 is the pass).
Then restart however the dev stack normally comes up (vite respawns it; or):
```
cd I:/goongrid/apps/api && PORT=8790 bun run src/serve.ts     # background
curl -s http://localhost:8790/api/health
```
Expected: JSON containing `"ok":true`.

### Task 2 — Surface the failed URLs on queue errors (TDD, 15 min)

2a. Failing test. `apps/desktop/src/components/watchparty/WatchPartyQueue.test.tsx`
already mocks the store (check its existing `vi.mock` shape first; it tests
"add and play sends queueOnly false"). Add one case:
```tsx
it('shows which URLs failed when the server 422s', async () => {
  // reuse the file's existing mock of loadPartyVideos; make it resolve
  // { ok: false, added: 0, failed: [], error: 'Could not find a playable video at that link.' }
  // after rendering with adding-open, assert the error <p> text contains the error.
})
```
Concretely, the deliverable behavior: when `res.ok === false` AND
`res.failed.length > 0`, the panel shows `res.error` plus the failed URLs; when the
server returned `failed: []` (current client bug — it hardcodes empty), nothing extra.
If the file's mock returns richer shapes, assert `Failed:` appears with the URL.

2b. RED: `npx vitest run src/components/watchparty/WatchPartyQueue.test.tsx` -> new case
fails (error line shows only the generic sentence).

2c. Implement (two tiny edits):

`apps/desktop/src/hooks/watchPartyStore.ts` in `loadPartyVideos`, replace the
not-ok return so the server's failed list survives:
```ts
    if (!res.ok) return { ok: false, added: 0, failed: Array.isArray(body?.failed) ? body.failed.map(String) : [], error: body?.error || 'Could not load these videos.' }
```

`apps/desktop/src/components/watchparty/WatchPartyQueue.tsx` in `submit`, replace the
`!res.ok` branch so the URLs are visible:
```tsx
    if (!res.ok) {
      setError(res.failed.length
        ? `${res.error} Failed: ${res.failed.join(', ')}`
        : (res.error || 'Could not queue these videos.'))
      return
    }
```

2d. GREEN: same vitest command -> all pass.
Then `npx tsc --noEmit` (from `I:\goongrid\apps\desktop`) -> 0 errors.

2e. Commit (explicit paths only — shared tree):
```
cd I:/goongrid && git add apps/desktop/src/hooks/watchPartyStore.ts apps/desktop/src/components/watchparty/WatchPartyQueue.tsx apps/desktop/src/components/watchparty/WatchPartyQueue.test.tsx && git commit -m "fix(watch): queue 422 surfaces the failed URLs the server already reports"
```

### Task 3 — Reproduce both buttons on the fresh server (5 min)

In the app (:5173), open/rejoin a room, paste a goonchan video-page URL into the Queue
(add panel), click **Add and play**. Expected: 200, entry plays. Then clear the textarea
with a fresh URL and click **Add**. Expected: 200.
If "Add and play" 422s again, the error line now names the failed URL (Task 2) -> go to
Task 4 with it. If it no longer 422s: DONE — the stale sidecar was the whole story.

### Task 4 — ONLY IF a named URL still fails on fresh code

Probe it exactly the way the server does, from `I:\goongrid\apps\api`:
```
bun probe-pmv.ts "<the-failed-url>"
```
- `resolved: null` or resolves to an html/page URL -> parser gap for that host: extend
  the resolvers in `apps/api/src/proxy.ts` (pattern: early-return host match, or
  `extractEmbeddedVideo` signals), TDD against `src/proxy.test.ts` first.
- `resolved: <direct media URL>` yet the POST still 422s -> the relay probe in
  `resolveMedia` (`apps/api/src/routes/watchparty.ts:60-70`) is rejecting the response;
  reproduce with the same Range GET (`Range: bytes=0-1`, UA + Referer from the ORIGINAL
  page host) and print `status`, `content-type`, `content-length`, then fix the one
  mismatched field, with a test in `src/watchparty-relay.test.ts` first (mirror the
  existing 422 cases at lines 66/76/127).
Commit per fix with the usual `fix(watch|proxy): ...` prefix.

### Task 5 — Gates

```
cd I:/goongrid/apps/api && npx vitest run          # expect all green (baseline ~847)
cd I:/goongrid/apps/desktop && npx vitest run src/components/watchparty   # green
cd I:/goongrid/apps/desktop && npx tsc --noEmit    # 0 errors
```

## Risks, tradeoffs, open questions

- "Add works / Add and play 422s" cannot happen on identical content with current server
  code (queueOnly is read after the 422 gate) — so EITHER the two attempts differed
  (different textarea content, or one hit the stale process before a restart), OR
  upstream fetch is intermittent for that host. Task 2 makes the next occurrence
  self-reporting instead of a console mystery; that is the lazy, durable fix.
- Killing :8790 drops in-memory parties not yet snapshotted; the persistent file
  (`apps/api/watchparties.json`) is currently `[]`, so room 668f4b5c is already gone —
  the repro will use a fresh room. No DB risk (snapshot loop writes every few seconds).
- If the repro shows per-fetch upstream flakiness (same URL passes then fails), the
  lazy answer is NOT client retry: the honest fix is the error surfacing we already ship
  (Task 2) plus one retry INSIDE `resolveMedia` only when evidence shows it — YAGNI now.
- Out of scope: parse-budget 429s, 1-hour file >50MB relay path changes, HLS.
