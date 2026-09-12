# gMatch Desktop (.exe) Hardening Wave for Public Release

Goal: before the public release, close every gap in the packaged Electron app's error handling, crash visibility, startup reliability, and duplicate/dead UI logic, and document the desktop flow so a fresh maintainer (or support thread) can diagnose a user's install.

Repo: `I:\goongrid` (monorepo). The .exe lives in `apps/desktop` (Electron + Vite + React + TS strict, portable build via electron-builder). Current version 1.1.4, branch `main`, clean-ish tree. Read `AGENTS.md` and `docs/SPEC.md` first. All UI copy is English, no em dashes in user-facing strings (repo-wide gate), DESIGN.md governs styling.

---

## Current context (verified, with evidence)

The wave is grounded in these audited facts (all paths relative to `I:\goongrid\apps\desktop`):

1. **Renderer logging is a no-op black hole.** `src/utils/logger.ts` is 5 lines of empty functions. 22 files import `logger`, and `src/components/ErrorBoundary.tsx:27` calls `logger.error(...)` into nothing. There is no `window.onerror` / `unhandledrejection` listener anywhere in `src/` (grep: 0 hits). For a public release this means renderer crashes are undiagnosable.
2. **Main process HAS crash logging** (`electron/main.cjs:22-29`: `mainLog()` to `%APPDATA%\gMatch\main.log` + `uncaughtException` dialog), but the log never rotates (grows forever), and the path hint string `%APPDATA%\\gMatch\\main.log` is hardcoded 3x (lines 27, 89, 1042).
3. **ErrorBoundary is useless twice.** Duplicate copy ("Something went wrong" heading + "Something unexpected happened. Try reloading." body, lines 39-40) and its only button (`setState({hasError:false})`, line 42) re-renders the same component that just crashed — it will re-throw in a loop. There is no reload/relaunch path.
4. **Raw internal errors leak into toasts.** 11+ call sites do `toast(err?.message || 'fallback', 'error')` (e.g. `src/App.tsx:1619,1659`, `src/components/BabecockPanel.tsx:105,271`), while the repo already has the right helper `src/utils/userError.ts` (`userFacingError`) used by only 4 files. Inconsistent, leaks "fetch failed"/stack text to users.
5. **Host-mode sidecar death is silent.** `electron/main.cjs:1015-1022` catches bundled-server start failure with `console.error` only — the user gets a broken app with zero explanation. `electron/apiSidecar.cjs:101-104` logs a sidecar crash at exit with no restart, no user-facing signal.
6. **Server mode switch silently force-restarts the app.** `src/components/settings/ServerTab.tsx:38-46`: `save()` toasts "restart to apply" then immediately calls `window.gmatch.serverRelaunch()` — the app quits under the user mid-click without confirmation.
7. **Window state is not persisted.** `electron/main.cjs:833-847`: always 1440x900, `minWidth: 1200`, no saved bounds, no height clamp — on a 1366x768 laptop the window is taller than the screen and the title bar can sit off-display.
8. **UPDATER has em-dash user copy** (repo bans em dashes): `electron/updater.cjs:111` ("...update — run gMatch from..."), `:124` ("mismatch — download discarded"), and `src/components/settings/UpdateSection.tsx:162` (`{status?.error} — you can grab the .exe manually.`).
9. **SOURCES block is copy-paste soup.** `electron/main.cjs:631-786`: 14 sources where 7 booru.org subdomains are identical 6-line fetchers (only sub differs), and tbib/xbooru differ only by hostname. ~90 lines to collapse to ~30.
10. **Dead code / arg drift**: `hasBadTag(tags)` is declared with 1 param (`main.cjs:189`) but called with 2 at ~7 sites (`hasBadTag(p.tags, captions)`) — `captions` is silently ignored in main. `SettingsTabId` union still contains `'wallpaper'` (`src/components/settings/GMatchSettingsModal.tsx:41`) which is not in `navItems` (handled by a separate `wallpaperExpanded` hack at :222, :227-235), and `src/App.tsx:468` re-declares its own `'preferences' | 'wallpaper'` union for `settingsInitialTab`.
11. **Duplicated beforeunload handlers** in `src/App.tsx`: save-on-unload at :129 and the key-warning gate at :245 are two separate effects doing related work on the same event; the gate fires `e.preventDefault()` whenever `orbit_key_saved !== 'true'` even right after the user already exported a key in the same session (IdentityModal.tsx:77 does write the marker, so this is mostly fine — but the two handlers' ordering is load-bearing and undocumented).

## Assumptions

- Do NOT restructure App.tsx (3852 lines); touch it only at the named line sites.
- The `gmatch-frontend-work` skill rules apply: commit explicit paths only (never `git add -A` — shared tree with sibling agents), CRLF-preserving edits, DESIGN.md token rules, English copy, em-dash ban.
- `npm run test` (vitest ~663 desktop tests) and `node electron/*.test.cjs` (plain-node assert tests, e.g. `node electron/admin-pin.test.cjs`) must stay green. Lint gate = 0 errors.
- New pure electron logic goes in `*-core.cjs` files with no `electron` import (pattern: `server-mode-core.cjs`, `updater-core.cjs`) so plain-node tests can require them.

## Architecture / approach

Three layers, bottom-up: (A) make errors observable — a renderer→main log IPC bridge, global error listeners, a working ErrorBoundary, log rotation; (B) make failure paths honest — route all toast errors through `userFacingError`, surface sidecar death, confirmation before restart; (C) remove duplication — SOURCES factory, dead `wallpaper`/arg-drift cleanup, window bounds persistence. Documentation ships with the wave: a new `docs/DESKTOP.md` describing the exe boot flow, log locations, and troubleshooting, linked from README.

Branch: `feat/desktop-hardening-wave` off `main`. One commit per numbered task.

Workdir for all commands below: `I:\goongrid\apps\desktop` (call it `$D`). bash on Windows: `cd /i/goongrid/apps/desktop`.

---

## Phase A — Error visibility

### A1. Renderer → main process log bridge

**Files:** `electron/preload.cjs`, `electron/main.cjs`, `src/utils/logger.ts`, new `src/utils/logger.test.ts`

RED first — create `src/utils/logger.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger';

afterEach(() => vi.unstubAllGlobals());

describe('logger', () => {
  it('forwards error calls to the gmatch bridge when present', () => {
    const logError = vi.fn();
    vi.stubGlobal('window', { ...(globalThis.window || {}), gmatch: { logError } });
    logger.error('feed', new Error('boom'));
    expect(logError).toHaveBeenCalledWith('feed', expect.stringContaining('boom'));
  });
  it('never throws when the bridge is missing (browser mode)', () => {
    vi.stubGlobal('window', {});
    expect(() => logger.warn('x', 'y')).not.toThrow();
  });
});
```

Run `npx vitest run src/utils/logger.test.ts` → expect FAIL (logger is a no-op).

Implementation:

1. `electron/preload.cjs` — inside the `contextBridge.exposeInMainWorld('gmatch', {...})` object add:

```js
  logError: (scope, msg) => { try { ipcRenderer.send('log:renderer', { scope: String(scope || ''), msg: String(msg || '') }) } catch { /* never log-loop */ } },
```

2. `electron/main.cjs` — after `initSecureKV()` call inside `app.whenReady()` (line ~877) add:

```js
  ipcMain.on('log:renderer', (_event, { scope, msg }) => mainLog(`[renderer:${scope}] ${msg}`))
```

3. `src/utils/logger.ts` — replace the whole file body:

```ts
type Bridge = { logError?: (scope: string, msg: string) => void }

function report(level: string, scope: unknown, args: unknown[]): void {
  try {
    const g = (typeof window !== 'undefined' ? (window as { gmatch?: Bridge }).gmatch : undefined)
    const msg = args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (g?.logError) g.logError(String(scope ?? level), `${level}: ${msg}`.slice(0, 4000))
  } catch { /* logging must never throw */ }
}

export const logger = {
  log(...args: unknown[]) { report('log', args[0], args.slice(1)); },
  info(...args: unknown[]) { report('info', args[0], args.slice(1)); },
  warn(...args: unknown[]) { report('warn', args[0], args.slice(1)); },
  error(...args: unknown[]) { report('error', args[0], args.slice(1)); },
};
```

4. Add to `src/electron/global.d.ts` (or wherever `window.gmatch` is declared — grep `gmatch?:` to find the Window interface) the line: `logError?(scope: string, msg: string): void`.

GREEN: `npx vitest run src/utils/logger.test.ts && npm run typecheck` → pass.
Commit: `git add electron/preload.cjs electron/main.cjs src/utils/logger.ts src/utils/logger.test.ts src/electron/global.d.ts && git commit -m "feat(desktop): renderer errors land in main.log via IPC bridge"`

### A2. Global renderer crash listeners

**Files:** `src/boot.tsx` (or `src/main.tsx` where `initSecureStorage()` is called — put it as early as possible)

Add before `mount()` (verify failure by grepping first: `grep -n unhandledrejection src/*.tsx` → currently 0):

```tsx
import { logger } from './utils/logger'

window.addEventListener('error', (e) => logger.error('window', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => logger.error('rejection', e.reason))
```

No test (two one-line listeners, YAGNI); verify with `npm run typecheck && npm run build` → build succeeds. Commit `feat(desktop): report uncaught renderer errors and rejections`.

### A3. ErrorBoundary that can actually recover

**Files:** `src/components/ErrorBoundary.tsx`, new `src/components/ErrorBoundary.test.tsx`

RED — write `src/components/ErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

const Boom = () => { throw new Error('kaboom') }

describe('ErrorBoundary', () => {
  it('renders fallback and offers a reload, not an infinite re-render', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('This screen hit an error.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(reload).toHaveBeenCalled()
    spy.mockRestore()
    vi.unstubAllGlobals()
  })
})
```

`npx vitest run src/components/ErrorBoundary.test.tsx` → FAIL (old copy, no reload button).

GREEN — edit the `render()` fallback block of `ErrorBoundary.tsx`:
- Heading → `This screen hit an error.`
- Body line → `Reloading keeps your progress (saves every 10s). If this keeps happening, the log in Settings can help us look.`
- Keep the "Try again" reset button ONLY if it is the meaningful path; replace it with a primary Reload button:

```tsx
<button
  onClick={() => window.location.reload()}
  className="bg-retro-accent text-black px-4 py-2 text-xs font-bold hover:bg-retro-fg hover:text-retro-bg transition-colors"
>
  Reload
</button>
```

- In `componentDidCatch` also `logger.error('ErrorBoundary', error, info.componentStack)` (already there — now it actually persists after A1).

Verify: `npx vitest run src/components/ErrorBoundary.test.tsx && npm run typecheck` → pass. Commit `fix(desktop): ErrorBoundary reload path + honest copy`.

### A4. main.log rotation + single LOG_HINT constant

**Files:** `electron/main.cjs` (lines 20-29, 89, 1042), new pure core `electron/mainlog-core.cjs`, `electron/mainlog.test.cjs`

RED — `electron/mainlog.test.cjs` (plain node asserts, run `node electron/mainlog.test.cjs`):

```js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { appendWithRotation } = require('./mainlog-core.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainlog-'))
const file = path.join(dir, 'main.log')
const big = 'x'.repeat(100)
for (let i = 0; i < 15; i++) appendWithRotation(file, big, 1000)
assert.ok(fs.existsSync(file), 'log exists')
assert.ok(fs.statSync(file).size <= 1000, `current log capped: ${fs.statSync(file).size}`)
assert.ok(fs.existsSync(file + '.1'), 'rotated copy kept')
console.log('mainlog tests passed')
```

Run → FAIL (module missing).

GREEN — `electron/mainlog-core.cjs`:

```js
// main.log writer with a hard size cap: append, rotate to .1 when > maxBytes.
const fs = require('node:fs')

function appendWithRotation(file, line, maxBytes = 1024 * 1024) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, file + '.1')
    }
  } catch { /* rotation is best-effort; never lose the append for it */ }
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\r\n`)
}

module.exports = { appendWithRotation }
```

In `electron/main.cjs`: define `const LOG_HINT = 'Details were written to:\n%APPDATA%\\gMatch\\main.log'` near `mainLog` (line 22), rewrite `mainLog` to call `appendWithRotation(path.join(app.getPath('userData'), 'main.log'), line)`, and replace the three hardcoded hint strings with `` `...\n\n${LOG_HINT}` ``.

Verify: `node electron/mainlog.test.cjs` → `mainlog tests passed`. Commit `fix(desktop): rotate main.log at 1MB, one log-hint string`.

---

## Phase B — Honest failure paths

### B1. Route every raw `err.message` toast through `userFacingError`

**Files:** `src/App.tsx` (~1619, 1659), `src/components/BabecockPanel.tsx` (~105, 271), plus every hit of the grep below.

Enumerate first:

```
cd /i/goongrid/apps/desktop && grep -rn "toast(.*\.message" src --include=*.tsx --include=*.ts | grep -v test | grep -v userFacingError
```

For each hit, replace the pattern `toast(err.message || 'X', 'error')` with:

```ts
toast(userFacingError(err, { fallback: 'X' }), 'error')
```

(import `userFacingError` from `../../utils/userError` — depth varies; `X` keeps the original fallback text). Where the code already distinguishes status (`res.status`), use `userFacingResponse(res, fallback)` instead.

Gate (must print 0 after the sweep):

```
grep -rn "toast(.*\.message" src --include=*.tsx --include=*.ts | grep -v test | grep -v userFacing | wc -l
```

Verify: `npm run typecheck && npm run test` → green (existing tests assert some toast copy; if a test asserts an old raw-message string, update the assertion to the userFacingError output, e.g. 'Please sign in again and try again.'). Commit `fix(desktop): all error toasts go through userFacingError`.

### B2. Host-mode sidecar failure must be loud + one auto-restart

**Files:** `electron/apiSidecar.cjs`, `electron/main.cjs`

In `apiSidecar.cjs`: add a module-level crash channel so main can react:

1. Top of file add `const { EventEmitter } = require('node:events')` and `const sidecarEvents = new EventEmitter()`; export it (`module.exports = { startApi, stopApi, API_BASE, PORT, sidecarEvents }`).
2. In `startApi`, capture `let intentionalStop = false`; set it true at the top of `stopApi()`.
3. In the `proc.on('exit', ...)` handler (line ~101) replace the console-only body with:

```js
  proc.on('exit', (code) => {
    proc = null
    if (!intentionalStop && code !== 0) sidecarEvents.emit('crashed', code)
  })
```

4. In `main.cjs` after `await apiSidecar.startApi()` succeeds inside the host-mode branch (line ~1018), wire:

```js
      let restartTried = false
      apiSidecar.sidecarEvents.on('crashed', async (code) => {
        mainLog(`sidecar crashed code=${code}`)
        if (!restartTried) {
          restartTried = true
          try { await apiSidecar.startApi(); mainLog('sidecar restarted ok'); return } catch (e) { mainLog(`sidecar restart failed: ${e.message}`) }
        }
        dialog.showErrorBox('The local server stopped', `gMatch could not keep its bundled server running.\n\nRestart the app, or switch to a friend's server in Settings > Server.\n\n${LOG_HINT}`)
      })
```

5. Also wrap the initial host-mode `catch` (line 1019-1021) to show `dialog.showErrorBox('gMatch could not start its server', err.message + '\n\nOpen Settings > Server to switch to a friend\'s server, then restart.\n\n' + LOG_HINT)` instead of `console.error`.

Verify: `npm run lint && npm run typecheck` → 0 errors. Manual check later in D3 smoke test. Commit `fix(desktop): bundled server failure is loud, with one auto-restart`.

### B3. No silent force-restart on server-mode switch

**Files:** `src/components/settings/ServerTab.tsx`

`save()` currently toasts and immediately calls `serverRelaunch()` (lines 38-46). Replace with a pending-restart state:

1. Add `const [restartPending, setRestartPending] = useState(false)` next to existing `useState`s.
2. In `save()`, replace the `if (window.gmatch.serverRelaunch && state.packaged) { window.gmatch.serverRelaunch() }` block with `if (state.packaged) setRestartPending(true)`.
3. Under the save controls, render only when pending:

```tsx
{restartPending && (
  <div className="glass-panel p-3 flex items-center gap-3">
    <p className="text-xs text-retro-fg">Saved. Restart now to switch servers.</p>
    <button
      type="button"
      onClick={() => window.gmatch?.serverRelaunch?.()}
      className="ml-auto rounded-lg bg-retro-accent px-3 py-1.5 text-xs font-bold text-black hover:bg-retro-fg"
    >
      Restart now
    </button>
    <button
      type="button"
      onClick={() => setRestartPending(false)}
      className="rounded-lg border border-border-glass px-3 py-1.5 text-xs text-retro-muted hover:text-retro-fg"
    >
      Later
    </button>
  </div>
)}
```

4. Toast copy for `!res.ok` stays (already honest). Test: add to an existing ServerTab test file if one exists (`ls src/components/settings/ServerTab.test.tsx`), else new file, asserting that clicking Save does NOT call `serverRelaunch` and that the "Restart now" button appears:

```tsx
// vi.stubGlobal('window', { gmatch: { serverSet: async () => ({ ok: true }), serverRelaunch: vi.fn() } }) style
// assert serverRelaunch not called after Save; called after Restart now.
```

(Use the repo localStorage-stub pattern from `ServerPasswordSection.test.tsx` if the component touches storage.)

Verify: `npx vitest run src/components/settings && npm run typecheck` → green. Commit `fix(desktop): server switch restarts only on user confirmation`.

### B4. Em-dash sweep in updater copy

**Files:** `electron/updater.cjs` (111, 124), `src/components/settings/UpdateSection.tsx` (~162)

- `updater.cjs:111` → `'no writable folder to place the update. Run gMatch from your Downloads folder and retry'`
- `updater.cjs:124` → `throw new Error('sha256 mismatch. The download was discarded.')`
- `UpdateSection.tsx` → `<span className="break-words">{status?.error || 'Update failed'}. You can grab the .exe manually.</span>`

Gate (must print 0):

```
grep -rn '—' electron/updater.cjs electron/updater-core.cjs src/components/settings/UpdateSection.tsx
```

(`updater-core.cjs` em dashes are comments only, allowed; if the grep hits comment lines 5/36/114 leave them, the gate is for string literals — visually confirm hits are `//` comments.)

Commit `fix(desktop): updater copy obeys the em-dash ban`.

---

## Phase C — Window + duplication cleanup

### C1. Persist window bounds (and never restore off-screen)

**Files:** `electron/main.cjs` (createWindow ~833), new `electron/window-bounds-core.cjs` + `electron/window-bounds.test.cjs`

RED — `electron/window-bounds.test.cjs`:

```js
const assert = require('assert')
const { sanitizeBounds } = require('./window-bounds-core.cjs')

const workArea = { x: 0, y: 0, width: 1366, height: 768 }
assert.deepStrictEqual(sanitizeBounds(null, workArea), null, 'null stays null')
assert.deepStrictEqual(sanitizeBounds({ x: 5000, y: 5000, width: 1440, height: 900 }, workArea), null, 'off-screen bounds rejected')
const ok = sanitizeBounds({ x: 100, y: 50, width: 1200, height: 700 }, workArea)
assert.strictEqual(ok.width, 1200)
const clamped = sanitizeBounds({ x: 0, y: 0, width: 5000, height: 5000 }, workArea)
assert.ok(clamped.height <= 768, 'height clamped to work area')
console.log('window-bounds tests passed')
```

GREEN — `electron/window-bounds-core.cjs`:

```js
// Validate saved BrowserWindow bounds against the primary work area:
// reject anything off-screen (monitor changed), clamp oversized windows.
function sanitizeBounds(b, workArea) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return null
  if (b.width < 800 || b.height < 600) return null
  const visible = b.x + 200 > workArea.x && b.x + b.width - 200 < workArea.x + workArea.width &&
    b.y + 40 > workArea.y && b.y + Math.min(b.height, 200) < workArea.y + workArea.height
  if (!visible) return null
  return { x: b.x, y: b.y, width: Math.min(b.width, workArea.width), height: Math.min(b.height, workArea.height) }
}
module.exports = { sanitizeBounds }
```

Wire in `main.cjs`:

```js
const boundsPath = () => path.join(app.getPath('userData'), 'window-bounds.json')
```

In `createWindow()`:

```js
  let bounds = { width: 1440, height: 900 }
  try {
    const { screen } = require('electron')
    const saved = JSON.parse(fs.readFileSync(boundsPath(), 'utf8'))
    bounds = sanitizeBounds(saved, screen.getPrimaryDisplay().workArea) || bounds
  } catch { /* first run */ }
  const win = new BrowserWindow({ ...bounds, minWidth: 1000, ... })
```

(also lower `minWidth: 1200` → `1000` so a 1366px laptop can reach the saved width; keep the rest of the options). Save on move/resize with a debounce right after creating the window:

```js
  let saveTimer = null
  const persistBounds = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(boundsPath(), JSON.stringify(win.getBounds())) } catch { /* best effort */ }
    }, 500)
  }
  win.on('moved', persistBounds); win.on('resized', persistBounds)
```

Verify: `node electron/window-bounds.test.cjs` → passed; `npm run typecheck`. Commit `feat(desktop): remember window size and position`.

### C2. SOURCES factory (DRY the 14-entry copy-paste block)

**Files:** `electron/main.cjs:631-786`, new `electron/booru-sources-core.cjs` + `electron/booru-sources.test.cjs`

Extract the three parametric builders (pure, injected deps — mirrors `updater-core` pattern):

```js
// electron/booru-sources-core.cjs
// Builders for the repetitive source shapes. httpGet/parsers injected so this
// file is pure-node testable.
function dapiSource(id, base, { httpGet, parse, negatives }) {
  return {
    id,
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 8)
      const query = (variant + ' rating:explicit ' + negatives()).trim()
      const url = (p) => `${base}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(query)}&limit=${n}&json=1&pid=${p}`
      let posts = parse(await httpGet(url(pid)), base, captions)
      if (posts.length === 0 && pid > 0) posts = parse(await httpGet(url(0)), base, captions)
      return posts
    },
  }
}

function booruOrgSource(sub, { httpGet, parse }) {
  return {
    id: sub === 'rule34.booru.org' ? 'rule34-org' : sub.split('.')[0],
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=${pid}`)
      return parse(html, sub.split('.')[0], captions, variant).slice(0, n)
    },
  }
}

module.exports = { dapiSource, booruOrgSource }
```

RED test first (`node electron/booru-sources.test.cjs`): fake `httpGet` returning canned JSON for `dapiSource` (assert it retries pid=0 when random pid returns `[]`, and that negatives() is spliced into the query), and a fake HTML for `booruOrgSource` (assert the URL built has `pid` multiple of 20 and parse gets `(html, sub, captions, variant)`).

Then rewrite the `SOURCES` array in `main.cjs` using the builders for: tbib, xbooru (dapi), hgoon, blacked, allgirl, rule34.booru.org, qoh, celeb, footfetishbooru.booru.org (booruOrg). Leave paheal/redgifs/imhentai/konachan/yandere/realbooru as-is (genuinely different shapes). Note `footfetishbooru.booru.org` maps to `bSub = 'footfetishbooru'` — that is what `parseBooruOrgHtml`'s regex group extracts from the thumbnail URL, but the second arg of `parseBooruOrgHtml` is actually UNUSED inside the parser (it builds the URL from `bSub` captured from HTML) — verify with `grep -n 'function parseBooruOrgHtml' -A6 electron/main.cjs` and drop the dead param while you are there (update all call sites).

Verify: `node electron/booru-sources.test.cjs` passed + `npm run lint`. Sanity: dev boot `npm run electron` (browser-side unaffected). Commit `refactor(desktop): SOURCES built from shared dapi/booru.org factories`.

### C3. Dead-arg and dead-state cleanup

**Files:** `electron/main.cjs`, `src/components/settings/GMatchSettingsModal.tsx`, `src/App.tsx`

1. `hasBadTag(tags)` — drop the phantom second arg at every call: `grep -n 'hasBadTag(' electron/main.cjs` → remove `, captions` from all `hasBadTag(p.tags, captions)` occurrences (6-7 sites). Parser signatures keep `captions` only where used elsewhere; after the edit run `grep -c 'hasBadTag(.*,.*,' electron/main.cjs` → 0.
2. `SettingsTabId`: remove `| 'wallpaper'` from the union (`GMatchSettingsModal.tsx:41`). Keep `wallpaperExpanded` mechanism (it is a preferences-section disclosure, not a tab). In the `useState<SettingsTabId>` initializer and the `initialTab` handling, `'wallpaper'` stays a valid INPUT value for `initialTab` (the prop type is `'preferences' | 'wallpaper'`) — so instead change the prop type to its own small union `type SettingsOpenTarget = SettingsTabId | 'wallpaper'` inside `GMatchSettingsModal.tsx`, and in `src/App.tsx:468` replace the inline union with an import of it: `const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsOpenTarget>('preferences')`. (This deletes the duplicated list of tab literals at :216-221 by comparing against the imported union: `if (initialTab === 'wallpaper') return 'preferences'` first, then `navItems.some(n => n.id === initialTab) ? initialTab : 'preferences'`.)
3. Verify: `npm run typecheck && npm run lint && npm run test` → green. Commit `refactor(desktop): drop dead blocklist arg and wallpaper-tab union drift`.

---

## Phase D — Documentation + release cut

### D1. New `docs/DESKTOP.md` (repo root docs/, `I:\goongrid\docs\DESKTOP.md`)

Write it from the actual code you just touched (no invention). Sections:

1. **What the .exe is** — portable Electron app; single instance lock; bundled bun server (host mode) vs central node client (default `https://gmatch.fly.dev`); one-line pointers to `electron/server-mode.cjs`, `electron/apiSidecar.cjs`.
2. **Boot flow** — numbered: lock -> userData migration -> blocklist load (userData override, then packaged extraResources) -> secure KV -> sidecar (host only) -> window -> updater schedule. Each line cites its function in `electron/main.cjs`.
3. **Where things are stored** — table: `main.log` (1MB rotation), `admin-pin.txt`, `storage.key`, `server-mode.json`, `window-bounds.json`, `blocklist.json`, `orbit.sqlite` + `blobs/`, gmcache (RAM, never disk). Path = `%APPDATA%\gMatch\` (portable: `%PORTABLE_EXECUTABLE_DIR%` unaffected, profile stays roaming).
4. **Error handling map** — renderer crash -> logger bridge -> main.log (A1/A2); UI boundary -> reload button; fatal main crash -> native dialog + log; sidecar crash -> auto-restart once -> dialog (B2).
5. **Self-update** — release.json feed, sha256 verification, swap script (`electron/updater.cjs` header + `updater-core.cjs`).
6. **Troubleshooting** (user-facing, for the site Help + support): app won't open -> check main.log; feed images dead -> Settings > Feed shows source health / OFFLINE badge; lost admin PIN -> Settings > Server (host mode); "switched servers and nothing changed" -> Restart now in Settings > Server.
7. **Release checklist** — bump `apps/desktop/package.json` version, `npm run lint && npm run typecheck && npm run test`, run the `node electron/*.test.cjs` set, `npm run dist`, manual smoke (D3), tag `v<ver>` pushes CI release (`.github/workflows/release.yml`), site hashes blocklist note (see commit 282a348 pattern).

Commit `docs(desktop): how the exe boots, stores, fails and updates`.

### D2. README + HelpModal pointers

- `I:\goongrid\README.md`: one line under "Release .exe": "Architecture, log locations and troubleshooting: `docs/DESKTOP.md`."
- `src/components/HelpModal.tsx`: add an **Open log folder** row/button that calls a new bridge method, so a user reporting a bug can grab the file. Implementation: `electron/main.cjs` add `ipcMain.handle('app:open-log', () => shell.openPath(app.getPath('userData')))`; `preload.cjs` add `openLogFolder: () => ipcRenderer.invoke('app:open-log')`; HelpModal button renders only when `window.gmatch?.openLogFolder` exists (browser mode hides it — same gating pattern as `CustomSourcesModal.tsx:26`). Keep DESIGN.md button idiom (`glass-action` / BTN factories), English copy, no em dash.

### D3. Smoke test the actual artifact (verification, not a code task)

```
cd /i/goongrid/apps/desktop
node electron/admin-pin.test.cjs && node electron/customFolders.test.cjs && node electron/imageCache.test.cjs && node electron/imageCacheMemory.test.cjs && node electron/secureStore.test.cjs && node electron/mainlog.test.cjs && node electron/window-bounds.test.cjs && node electron/booru-sources.test.cjs
npm run lint && npm run typecheck && npm run test
npm run dist          # artifact: release/gMatch-1.2.0-portable.exe
```

Then manually run the exe from `release\` and check, in order (record each as a checkbox in the PR description):

1. Double-click twice -> single window, second launch focuses it.
2. `%APPDATA%\gMatch\main.log` exists, contains the boot lines, no `uncaught`.
3. Settings > Server shows client mode + central node masked URL; switch to host -> "Saved. Restart now" panel appears, no auto-quit.
4. Kill the bundled bun via Task Manager while host mode is running -> app auto-restarts the sidecar once (check main.log for `sidecar restarted ok`).
5. Resize window, quit, relaunch -> size restored.
6. Settings > Update > Check for updates -> no crash; copy contains no `—`.
7. `grep -rn "toast(.*\.message" src --include=*.tsx --include=*.ts | grep -v test | grep -v userFacing | wc -l` → `0`.

### D4. Version bump + tag

`npm version 1.2.0 -w @gmatch/desktop` is wrong here (workspace name is `@gmatch/desktop` per package.json line 2 — verify: `node -p "require('./package.json').name"`); instead edit `apps/desktop/package.json` `"version": "1.1.4"` → `"1.2.0"` directly, commit `chore(desktop): v1.2.0`, then after the wave is merged to `main`: `git tag v1.2.0 && git push origin main v1.2.0` (CI gates + publishes). Only tag when the user says go.

---

## Tests / validation summary

- Per-task TDD as written above: each of A1, A3, A4, B3, C1, C2 has a RED test named before implementation; A2/B1/B2/B4/C3 are wiring/refactor tasks gated by typecheck + existing suites (no new tests for one-liners — YAGNI).
- Full gates every commit: `npm run lint` (0 errors), `npm run typecheck`, `npm run test` (vitest), plus the `node electron/*.test.cjs` battery in D3.
- Playwright journeys stay out of scope (they run the browser build, this wave is electron + shared src; the shared `src/` changes are covered by vitest). If time allows at the end: `NODE_ENV=test npx playwright test` (expect the known flaky single journeys to re-run clean).

## Risks, tradeoffs, open questions

- **Risk: B2 restart path can double-spawn** if the crash handler fires while the user already hit Relaunch. Mitigated by the single-instance lock + `intentionalStop` flag; test host-mode quit in D3 step 3.
- **Risk: C2 refactor changes live feed URLs.** The builders produce byte-identical URLs to the current closures (diff carefully in review); D3 smoke includes loading the idle grid once against a real source to confirm images appear (no fabricated check — feed shows images or it doesn't).
- **Tradeoff (ponytail, skipped here):** custom crash-report UI, electron `crashReporter` (uploads = telemetry, banned by the no-telemetry promise), per-source health dashboard, splitting App.tsx. Add when support load demands it.
- **Open question:** `appId` is still `dev.goonmatch.grid` (package.json:69) while productName is gMatch. Renaming the appId strands userData association for auto-update installs; recommend leaving it, needs user sign-off.
- **Em-dash grep** in the repo sweeps comment lines too; only string literals are in scope (documented in B4).
