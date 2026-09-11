# Plan: match-loop game logic — SFX discipline, card-value economy, drag/URL cards, feed sizing, end-of-match truth

## Goal

Make the card-match game coherent: one sound per game event (throttled), likes/rejects/boosts and
their payouts driven by the server-assigned card values, drag-and-drop and any-URL card creation that
always ends in the cache, Instagram-style uncropped feed media, and an end-of-match screen/notification
that states what actually happened.

## Current context / assumptions

- Repo `I:/goongrid`, app `apps/desktop` (Electron+React+TS+zustand) + `apps/api` (Hono+D1, bun/vitest).
  All commands below run in `I:/goongrid/apps/desktop` unless noted. Branch `fix/browser-perf-ui-sweep`.
- SFX live in `src/utils/sounds.ts` — raw WebAudio one-shots, no dedupe. Repeat offenders found:
  - `src/components/MatchRoundPanel.tsx:117-127` — countdown effect keyed on `now` (1s interval):
    while `0 < ms <= 5000` it calls `playCountdown()` EVERY second (5+ overlapping beeps), and
    `match?.matched` round_result + YourMatchTab celebrate + useNotifications background path can each
    fire `playMatch()` for the same match event.
  - `src/components/YourMatchTab.tsx:57-78` — plays `playMatch/playTierUp/playTimeout/playReject` on
    `last_result` transitions; overlaps with MatchRoundPanel when both mounted.
  - `src/components/SpectateModal.tsx` — `playPress(...)` on every button, several buttons per screen.
  - `src/hooks/useNotifications.ts:113-136,250-300` — plays match/message/queue sounds and ALSO the
    service worker may play its own (`sound:` field at line ~283) → double audio when tab hidden.
- Card value model: server assigns rarity on creation ("Rarity and value are assigned by the server
  after creation" — CreateCardModal copy). `apps/api/src/routes/cards.ts` + `src/game/rarity.ts`
  (`RARITY_ORDER`, `rarityFor`, `RARITY_INCOME`) define the ladder. `lobby.ts` decision route
  (line ~203) currently ignores card values entirely: like/like → advance/points (`SPECIAL_TIER_POINTS`,
  `SPECIAL_FINAL_POINTS`), anything else → ended with no reward.
- Card creation: `src/components/CreateCardModal.tsx` — file → `/api/objects` multipart; URL →
  `form.append('url', ...)` → server `proxyAndStoreExternal` (`apps/api/src/proxy.ts`) which RETURNS
  NULL on upstream failure → server stores `text/url` link row (line 284) → image never cached, renders
  as dead remote link. User rule: "todo URL puxado é salvo no cache pra virar carta" — a card whose
  bytes don't exist locally/server-side must NOT be creatable via URL fallback-link.
- Drag: `src/components/DropZone.tsx` handles files + `DND_KEEPSAKE` payloads but only inside mounted
  drop-zones (grid). There is no window-level drop handler → dragging an image onto the app does nothing
  on most screens.
- Feed media: `src/components/feed/GMatchFeed.tsx:704` — `aspect-[4/5] ... object-cover` crops every
  post image. Object metadata (`size_bytes`, mime) exists; intrinsic width/height are NOT stored.
- Gallery = local cache: idle gallery entries (`electron/imageCache.cjs` LRU + `idle-file://`) already
  cache bytes; match/lobby card previews come from the server via `useObjectImage`.
- House UI style: glass tokens (`glass-surface`, `glass-inset`, `border-border-glass`, `text-retro-*`),
  one accent, no emoji, compact. Gates: `npx vitest run`, `npx tsc -p tsconfig.json --noEmit`,
  `npm run lint` (desktop); `npx vitest run` + `npx tsc -p tsconfig.json --noEmit` (api).

## Architecture / proposed approach

Fix SFX at the shared choke point (`sounds.ts` gets a per-sound throttle; the countdown caller emits
per discrete second) instead of guarding 50 callers. Wire the economy through the card: server decision
route reads the two cards' rarities and pays/multiplies with them (one function in `lobby.ts`, tested
there). Make card creation cache-first on the client: any URL is fetched through the existing local
image cache and uploaded as bytes; URL-only fallback links are rejected for cards. Feed images size to
their intrinsic aspect (lazy naturalWidth) — no schema change, no cropping.

## Step-by-step tasks

### Task 1 — SFX throttle in the shared module (root cause)

Files: `src/utils/sounds.ts`, new `src/utils/sounds.test.ts`

1a. RED — write `src/utils/sounds.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playPress, playCountdown, throttled } from './sounds'

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
    currentTime = 0
    state = 'running'
    sampleRate = 44100
    destination = {}
    resume() { return Promise.resolve() }
    createOscillator() { return { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => this.destination), start: vi.fn(), stop: vi.fn() } }
    createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => this.destination) } }
    createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) } }
    createBufferSource() { return { buffer: null, connect: vi.fn(() => ({ connect: vi.fn(() => this.destination) })), start: vi.fn(), stop: vi.fn() } }
    createBiquadFilter() { return { type: '', frequency: 0, Q: 0, connect: vi.fn(() => ({ connect: vi.fn(() => this.destination) })) } }
  }
})
afterEach(() => { vi.useRealTimers() })

describe('sfx throttle', () => {
  it('collapses burst calls of the same key inside the window', () => {
    let n = 0
    const fn = throttled(() => { n += 1 }, 400)
    fn(); fn(); fn()
    expect(n).toBe(1)
    vi.advanceTimersByTime(401)
    fn()
    expect(n).toBe(2)
  })
  it('exports throttled wrappers for press and countdown', () => {
    expect(() => { playPress(); playPress(); playCountdown(); playCountdown() }).not.toThrow()
  })
})
```

1b. `cd /i/goongrid/apps/desktop && npx vitest run src/utils/sounds.test.ts` → FAIL (`throttled` not exported).

1c. In `src/utils/sounds.ts` add:

```ts
const lastPlayed = new Map<string, number>()
/** Collapse rapid re-fires of the same game-event sound (double effects,
 * re-renders, multi-mounted panels). Gesture clicks bypass via key prefix. */
export function throttled<T extends (...a: never[]) => unknown>(fn: T, ms = 400): T {
  return ((...a: Parameters<T>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const key = (fn as { name?: string }).name || 'anon'
    const prev = lastPlayed.get(key)
    if (prev !== undefined && now - prev < ms) return undefined
    lastPlayed.set(key, now)
    return (fn as (...x: Parameters<T>) => unknown)(...a)
  }) as unknown as T
}
```

Wrap the *game-event* sounds only (NOT button `playPress` — those are user gestures, capping them
would mute legitimate distinct clicks; the burst problem is the countdown + result fan-out):
rename originals to `const playCountdownRaw = ...` style is churn — lazier: export
`playCountdownOnce = throttled(playCountdown, 900)`, `playMatchOnce = throttled(playMatch, 1500)`,
`playTierUpOnce = throttled(playTierUp, 1500)`, `playTimeoutOnce = throttled(playTimeout, 1500)`,
`playLikeOnce = throttled(playLike, 300)`, `playRejectOnce = throttled(playReject, 300)`.

1d. Swap import/call sites to the `*Once` variants (exactly the repeat offenders):
- `src/components/MatchRoundPanel.tsx`: lines 104 `playMatch()` → `playMatchOnce()`; 122 `playCountdown()` →
  `playCountdownOnce()`; 125 `playTimeout()` → `playTimeoutOnce()`; 180-181 `playLike()/playReject()` →
  `playLikeOnce()/playRejectOnce()`.
- `src/components/YourMatchTab.tsx`: 68-69 `playMatch()/playTierUp()` → `Once`; 74 `playTimeout()` →
  `playTimeoutOnce()`; 76 `playReject()` → `playRejectOnce()`.
- `src/hooks/useNotifications.ts`: 113/260 `playMatch()` → `playMatchOnce()`.
- Do NOT touch `playPress` callers.

1e. `npx vitest run src/utils/sounds.test.ts src/components` → PASS. `npx tsc -p tsconfig.json --noEmit` → 0.

1f. `cd /i/goongrid && git add apps/desktop/src/utils/sounds.ts apps/desktop/src/utils/sounds.test.ts apps/desktop/src/components/MatchRoundPanel.tsx apps/desktop/src/components/YourMatchTab.tsx apps/desktop/src/hooks/useNotifications.ts && git commit -m "fix(sfx): throttled game-event sounds at the shared module"`

### Task 2 — countdown fires per discrete second, not per tick

Files: `src/components/MatchRoundPanel.tsx`

The effect at ~117 runs every 1s while `ms<=5000`: with the 900ms throttle (Task 1) the burst is
already capped, but the *semantics* are wrong (beep at 5,4,3,2,1 should be 5 distinct beats — keep
that; the bug was `playTimeout` AND 5 beeps overlapping on every state churn). Verify current code
beeps at most once per second and exactly one `playTimeoutOnce` (it already guards via
`timedOutRef`). No change needed beyond Task 1 — validate with the existing test file if present:
`npx vitest run src/components/MatchRoundPanel` (or full `src/components` run) → PASS.
Skip commit if diff is empty (YAGNI check baked into Task 1).

### Task 3 — server: card-value economy (likes/reject/boost payouts)

Files: `apps/api/src/routes/lobby.ts`, `apps/api/src/routes/lobby.economy.test.ts` (new)

3a. First READ the current decision route (~190-235) and the Cards table columns via
`grep -n "Cards" apps/api/src/db.ts | head` to confirm the value column name (`rarity` or `tier` or
`value`). Adapt the mapping below to the ACTUAL column — do not invent.

3b. Add a pure helper in `apps/api/src/routes/lobby.ts` (exported for tests):

```ts
/** Card-driven match economy: reward scales with the RARITY OF THE OPPONENT'S
 * card you liked and your own card's rarity (mutual quality pays more).
 * Boost costs scale with your own card value so stacking boosts is never free. */
export function matchEconomy(
  mine: { rarity: number }, theirs: { rarity: number }, points: number,
): { winGp: number; loseGp: number; boostCost: number } {
  const R = (r: number) => Math.max(1, Math.min(8, r || 1))
  return {
    winGp: Math.round(50 * R(mine.rarity) * R(theirs.rarity) * (1 + points / 100)),
    loseGp: Math.round(10 * R(mine.rarity)), // small consolation for playing
    boostCost: 250 * R(mine.rarity),         // better card = pricier boost
  }
}
```

3c. RED test `apps/api/src/routes/lobby.economy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchEconomy } from './lobby'

describe('matchEconomy', () => {
  it('scales payout with both cards', () => {
    const low = matchEconomy({ rarity: 1 }, { rarity: 1 }, 0)
    const high = matchEconomy({ rarity: 5 }, { rarity: 5 }, 0)
    expect(high.winGp).toBe(25 * low.winGp)
    expect(high.boostCost).toBe(5 * low.boostCost)
    expect(low.loseGp).toBe(10)
  })
  it('clamps absurd rarities', () => {
    expect(matchEconomy({ rarity: 999 }, { rarity: 0 }, 0).winGp).toBe(50 * 8 * 1)
  })
})
```

3d. `cd /i/goongrid/apps/api && npx vitest run src/routes/lobby.economy.test.ts` → RED.

3e. Wire it: in the decision route, before ending/advancing, load both cards' rarity
(one `SELECT rarity FROM Cards WHERE id IN (?)` — adapt to actual schema from 3a), compute
`matchEconomy`, and: on mutual-like/final, credit `winGp` to both players' g$ (find the existing
wallet/gc credit mechanism — `grep -rn "gc\b\|g\$\|credit" apps/api/src/routes/lobby.ts` and reuse
the same DB update the tier points use); on non-mutual end, credit `loseGp` to both. Persist the
numbers in the response JSON: `{ ok: true, ended: true, payout: { gp, reason } }`.

3f. Boost: the route accepting `boost` (line ~371) charges `boostCost` from the player's g$ and
refuses when `gc < boostCost` (`{ error: 'Not enough g$ for a boost', need: boostCost }`, 402).
Client: `src/components/MatchRoundPanel.tsx` `handleDecide('boost')` — show the cost on the button
(`Boost · {cost} g$`) using the payout field; no more fixed 300 constant if one exists there
(`grep -n "300\|boost.*cost" src/components/MatchRoundPanel.tsx`).

3g. `cd /i/goongrid/apps/api && npx vitest run && npx tsc -p tsconfig.json --noEmit` → PASS/0.
Commit: `git add apps/api/src/routes/lobby.ts apps/api/src/routes/lobby.economy.test.ts && git commit -m "feat(economy): card-rarity-driven match payouts and boost cost"`.
Desktop-side button-copy change commits separately after 3f verification with `npm run lint`.

RISK (record in commit body): payout constants are tuning knobs; single source is `matchEconomy`.

### Task 4 — cache-first card creation (drag files + any URL)

Files: `src/components/CreateCardModal.tsx`, `src/utils/cacheMedia.ts` (new), `src/utils/cacheMedia.test.ts` (new)

4a. Root cause of "URL não vira carta": `proxyAndStoreExternal` returns null for blocked hosts →
server falls through to a `text/url` link object (bytes never stored) → dead card. The lazy correct
fix is CLIENT-SIDE: fetch the URL through the app's existing cache pipeline and upload it as a FILE.
In dev the Vite `/px` + `/booru/*` proxies already exist; in packaged Electron `imageCache.cjs`
caches bytes and serves `idle-file://`/cache URL. Helper:

```ts
// src/utils/cacheMedia.ts
/** Fetch a media URL through whatever local cache path is available and
 * return a File ready for upload. Throws when bytes can't be cached — a card
 * is NEVER created from a live URL (user rule: gallery = cache). */
export async function mediaUrlToCachedFile(url: string): Promise<File> {
  const candidates = [/^https?:/i.test(url) ? `/px?u=${encodeURIComponent(url)}` : url].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate, { referrerPolicy: 'no-referrer' })
      if (!r.ok) continue
      const blob = await r.blob()
      if (blob.size === 0 || !/^image\/|^video\//.test(blob.type || 'image/jpeg')) continue
      const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
      return new File([blob], `media-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' })
    } catch { /* try next candidate */ }
  }
  throw new Error('Could not cache this URL — the source refused the transfer')
}
```

(Check `/px` param name in `vite.config.ts` line ~145: it proxies `?u=` — confirm, adapt.)

4b. In `CreateCardModal.handleCreate` (~175): before uploading, if `url` is set and NOT an
`/api/objects/` URL, run `mediaUrlToCachedFile(url)` and upload the resulting File (same
`uploadWithProgress` path as files). Server-side `url` field then never used for cards; if the cache
fetch fails → `setError('Could not cache this URL…')` and DO NOT create the card. RED→GREEN: unit
test `cacheMedia.test.ts` mocking `fetch` (ok-blob → File; 403 → throw) with vitest, 2 asserts.

4c. Window-level drag: in `src/App.tsx` (root shell effect), add a global handler that opens the
Card Forge with the dropped payload — `CreateCardModal` already accepts `initialMedia` (line 21)
and `handlePayloadDrop`/`setFile` plumbing exists inside it; lazier reuse:

```ts
useEffect(() => {
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (!f || !/^image\/|^video\//.test(f.type)) return
    window.dispatchEvent(new CustomEvent('gmatch:forge-file', { detail: { file: f } }))
  }
  const prevent = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
  addEventListener('dragover', prevent)
  addEventListener('drop', onDrop)
  return () => { removeEventListener('dragover', prevent); removeEventListener('drop', onDrop) }
}, [])
```

In the component that renders `CreateCardModal` (grep `CreateCardModal` in `src/App.tsx` /
`YourMatchTab.tsx` — mount it once at the shell if only YourMatchTab has it), listen for
`gmatch:forge-file`: set open + pass the file. `CreateCardModal` gains a `initialFile?: File | null`
prop → `useEffect(() => { if (initialFile) { setFile(initialFile); setUrl('') } }, [initialFile])`.
The modal's existing drop-zone keeps working; the global handler must NOT double-handle drops that
land on a DropZone (DropZone already calls `e.preventDefault()` + `stopPropagation`? — verify; if it
doesn't stopPropagation, check `e.defaultPrevented` in the global handler and skip).

4d. Verification: manual — drag a JPEG onto the app → forge opens prefilled → create → card renders
offline (network devtools offline). `npx vitest run src/utils/cacheMedia.test.ts src/components` +
tsc + lint. Commit `feat(cards): cache-first URL imports and window-level drag-to-forge`.

### Task 5 — gallery/keepsake viewer & feed images read from cache, not live URLs

Files: `src/components/feed/GMatchFeed.tsx`, `src/ui/CachedImg.tsx` (reuse), post objects already
carry `url` (server `/api/objects/:id` which streams from D1/BUCKET — server-side IS the store,
so "URL viva" only applies to REMOTE hosts). Concrete fix: in the multi-media branch (~717),
`isObj` detection is `url.includes('/api/objects/')` — remote images (non-object posts, e.g. imported
before Task 4) currently render `<img src={url}>` hotlinked. Change that fallback to route through
`mediaUrlToCachedFile`-produced object uploads at creation time (Task 4 covers NEW posts), and for
existing hotlink rows render via `CachedImg` (which already falls back to the raw URL on cache miss)
instead of raw `<img>`. One-line per branch: replace `<img src={url} ...>` (3 occurrences 743-760)
with `<CachedImg src={url} ...>` — CachedImg is already imported? grep; add import if missing.
Validation: tsc + `npx vitest run src/components/feed` + manual visual. Commit with Task 6 (same file).

### Task 6 — Instagram sizing: intrinsic aspect, no crop

Files: `src/components/feed/GMatchFeed.tsx`

Replace the hard `aspect-[4/5] max-h-[min(420px,60vh)] ... object-cover` media container (line ~704)
with intrinsic-aspect sizing: keep `w-full` and let the image define height, clamped to viewport:

```tsx
<div className="relative w-full bg-surface-canvas overflow-hidden cursor-pointer rounded-none"
     style={{ aspectRatio: post.width && post.height ? `${post.width}/${post.height}` : undefined }} ...>
```

`post.width/height` do NOT exist in the API payload → do not add columns (YAGNI). Instead: render
`<CachedImg>`/`<img>`/`<video>` with `className="w-full h-auto max-h-[80vh] object-contain rounded-none"`
and REMOVE the wrapper's aspect class (height flows from content). For portrait-heavy booru sources the
media is already correct-ratio; videos need `videoClassName="w-full max-h-[80vh] object-contain"`.
Lightbox path untouched. Verify in dev feed (multiple ratios: 1:1, 4:5, 16:9, tall 2:3). Same for the
game-ad template block (line ~616) only if trivially safe — otherwise leave (it is synthetic art, crop OK).
Commit: `feat(feed): intrinsic aspect media display, no more 4:5 crop` + Task 5 together.

### Task 7 — end-of-match truth (screen + notification)

Files: `src/components/YourMatchTab.tsx`, `src/hooks/useNotifications.ts`

7a. The celebration block (62-71) knows `final` (rank-up) vs tier-up and has `points`; the
NON-mutual end (`last_result==='ended'`, ~75) shows only `playReject` and a generic panel. Extend the
state: on the ended response the server now returns `payout` (Task 3) — store it
(`lastPayout` state set where the WS/decision result lands — grep `ended: true` in
`src/utils/rooms.ts` callers) and render a small result strip in the existing ended panel:

```
{st.lastResult === 'ended' && (
  <p className="text-xs text-retro-muted">
    {lastPayout ? `Match over — +${lastPayout.gp} g$ (${lastPayout.reason}). Cards revealed.`
                : 'Match over — cards revealed.'}
  </p>
)}
```
`reason` values from the server: `mutual_like` | `no_match` | `opponent_rejected` | `timeout` —
add them to the payout object in Task 3e (one string field, mapped where each branch ends).

7b. `useNotifications`: the match-end notification (find the `last_result`/`ended` handling near the
WS notification fan-out ~100-140) currently announces generically. When the ended payload arrives,
notify with the truth: title `Match ended`, body
`${opponent} — ${result === 'both_like' ? 'mutual like, +' + payout.gp + ' g$' : result === 'timeout' ? 'ran out of time' : 'no match'} · +${payout.gp} g$`.
The SW already gets `sound:` — set `sound: undefined` for endings already announced in-app
(document.hidden-only rule already exists for match_start at 250-257; replicate for ended:
skip `playReject` in YourMatchTab when `document.hidden` so exactly ONE channel speaks per state).

7c. Validation: unit — extract the body-building into `matchEndSummary(match, payout): string` in
`src/utils/` (new file + vitest with 4 cases) so the string is testable without DOM. tsc/lint/tests.
Commit `fix(match): truthful end-of-match screen and notification`.

### Task 8 — spectate + gameplay screen pass (light, house-consistent)

Files: `src/components/SpectateModal.tsx`, `src/components/MatchRoundPanel.tsx`

Scope discipline (ponytail): NO redesign of layout — the reports are SFX spam (fixed in T1) and the
known visual bugs. Two targeted touches only, using the house tokens:
1. SpectateModal decision-countdown/last-seconds block (mirror of MatchRoundPanel ~117): gate
   `playPress` on sound setting if missing and ensure NO result sounds play while minimized
   (`if (isMinimized) return` before any effect that plays audio; visual-only while minimized).
2. MatchRoundPanel: when `phase === 'round_result'` and both cards revealed, add rarity chips under
   each card (`RARITY_ORDER` from `src/game/rarity.ts` — reuse, do not duplicate the ladder)
   `<span className="text-[10px] uppercase tracking-wider text-retro-muted">{rarityLabel}</span>`
   so the card-value economy from Task 3 is VISIBLE where it happens. `rarityLabel` =
   `RARITY_ORDER[rarity] ?? RARITY_ORDER[0]` (adapt to actual `Rarity` type: grep `type Rarity`).
Validation: `npx vitest run src/components`, tsc, lint. Commit `fix(match): quiet minimized spectate, visible card rarity in result`.

### Task 9 — full gate + build

1. `cd /i/goongrid/apps/desktop && npx tsc -p tsconfig.json --noEmit && npm run lint && npx vitest run` → 0/0/all.
2. `cd /i/goongrid/apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run` → 0/all.
3. CJS: `node electron/imageCache.test.cjs && node electron/imageCacheMemory.test.cjs`.
4. Rebuild portable (retry loop because of the Defender EPERM on rename — pattern already proven):
   `npx electron-builder --win portable -c.directories.output="I:/goongrid/apps/desktop/release-build"`
   then `cp release-build/gMatch-*.exe release/` and `isql` verify via `npx asar list` that
   `matchEconomy` is absent (renderer bundle) but `throttled(` and `mediaUrlToCachedFile` present.

## Tests / validation

Every task above is TDD-shaped: RED command + expected failure, minimal GREEN, exact commit with
named files. Task 2/8 are deliberately non-TDD (existing suites + manual gates) to avoid test churn
on pure call-site swaps. Manual checklist after Task 9 (user runs the exe): drag image → card; paste
realbooru/redgifs URL → card offline-safe; feed shows tall/wide images uncropped; one beep per
countdown second; end screen shows g$ delta and reason; spectate minimized = silent.

## Risks, tradeoffs, open questions

- Task 3e depends on the real Cards schema (column name for rarity and the wallet-credit mechanism);
  the plan pins exact greps — if rarity lives only client-side, move `matchEconomy` to the desktop
  store (`src/game/economy.ts`, where `clickValue`/`passiveGps` already read tag/gallery values) and
  make the server just relay `last_result` — same tests, different home. Decide at 3a, do not fork both.
- `/px` proxy in packaged builds: `mediaUrlToCachedFile` must fall back to the Electron
  `imageCache` IPC (`electron/imageCache.cjs` `cache-media` invoke) when `window.gmatch` exists —
  check `preload.cjs` for the exposed channel name and add a branch; dev `/px` is only a dev affordance.
- `text/url` objects already in D1 from old hotlink cards: Task 5 renders them via CachedImg (best
  effort); migrating them is out of scope.
- Boost economy change may break bots' fixed `boosts_remaining` assumption (`match.boosts_remaining`
  line ~137) — bots never boost server-side (grep `bot` near decision route); verify in 3e.
- Toast cap and dt-catch-up landed earlier this session; re-check nothing regressed in Task 9 gate.
