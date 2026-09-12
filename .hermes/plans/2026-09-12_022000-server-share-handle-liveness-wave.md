# gMatch Game-Layer Wave: Share Flows, Handles, Node Liveness

Goal: make the in-game server experience release-ready — every hosted node lives and is linked to the central directory, hosts can share their server with one copy action that shows WHO owns it and HOW to reach it, and the join flows actually work inside the .exe.

Repo: `I:\goongrid` (monorepo). Desktop app: `apps/desktop` (Electron+Vite+React+TS strict). API: `apps/api` (Hono + D1/sqlite, bun). Branch off `feat/desktop-hardening-wave` (the desktop-exe wave, currently `main..HEAD` = 19 commits) into `feat/server-share-wave`. Read `AGENTS.md`, `docs/ADR-002-servers.md`, `docs/DESIGN.md` first. Copy voice: flat English, no em dashes anywhere user-facing, no "successfully", errors name the thing + next move. Taste: one function one control; `glass-action` buttons never `glass-inset`; DESIGN.md tokens only.

## Current context (verified, evidence below)

Topology (already shipped, keep it working): packaged exe defaults to **client → central node `https://gmatch.fly.dev`** (blind courier + public server directory). **Host mode** runs the bundled bun server; its registration is replayed to the central directory by `useServerHeartbeat` every 15 min. Clients gossip: on refresh they ALSO fetch the directory from the node they're on (`ServersView.tsx:185-193`) and cache it (`directoryMerge.ts`, key `orbit_node_directory_v1`), so the list survives the hub dying. Directory rows prune after 24h silence (`apps/api/src/routes/servers.ts:34` `STALE_MS`); anonymous browsers never see `endpoint_hint` (signed-in only, line 83-84). Central is LIVE right now: `GET https://gmatch.fly.dev/api/servers` returns one row with `last_seen` minutes old.

Findings this wave must fix (all re-verify before editing; line numbers from commit 7f3700e):

1. **P0: `window.prompt` does not exist in Electron.** It returns `null` (Chromium logs "prompt() is not supported"), so in the .exe BOTH join paths are silently dead:
   - `src/utils/join-server.ts:20` — password-protected join: `entered === null` → `return 'cancelled'`. A friend can never join a password server from the exe.
   - `src/components/servers/ServersView.tsx:395` — `joinByCode` paste node code: always cancelled.
   In browser dev (`npm run dev`) prompt works, which is why nobody noticed. These are the only two `window.prompt` call sites in `src` (verified by grep).
2. **No share affordance.** `encodeNodeMask` exists (`src/utils/nodeMask.ts:18`) with tests, but grep shows ZERO non-test callers — the host has no in-game way to produce the `gmatch://node/...` code a friend must paste. The only share path today is Settings → Server raw-LAN-address copy (client mode only text; wrong surface, wrong format: raw IP vs node code).
3. **Directory rows hide the owner.** The server `GET /api/servers` returns `owner_id` (64-hex) only (`apps/api/src/routes/servers.ts:74`); `ServersView.tsx:894` renders the masked address. The user directive: "Explicit the user handle and node link to them, so they can share their server." Owner needs a display name on the row: `owner_name`, host-reported like `user_count`/`online_count`.
4. **Liveness is invisible.** Rows carry `last_seen` but the UI never renders it; "Recent" sort hides nothing. A 23h-silent node looks identical to one that answered 2 min ago. `formatRelativeTime` already exists in `ServersView.tsx:77` (used for users).
5. **A bare host never lists itself.** `useServerHeartbeat` early-returns when `REG_KEY` (`gmatch.server.register`) is missing (`src/hooks/useServerHeartbeat.ts:26`), and the marker is only written by the in-game Create flow (`ServersView.tsx:301`). An install that switched to host mode via Settings → Server (host mode IS opt-in per `docs/DESKTOP.md`) runs a node the directory never sees. "Ensure everything is live and linked to central node" = bootstrap the registration for host-mode installs.

## Assumptions

- Shared server = node-code copy; raw host:port stays masked everywhere (`maskedServerUrl`, hard product rule: never show the player's IP; copy-to-clipboard may carry the real value only in the existing ServerTab LAN rows — do not extend raw copies).
- Node codes carry LAN/real addresses by design (noted in `nodeMask.ts` header: the string is not a security boundary; it's already gated to signed-in users server-side).
- Migration count: `apps/api/src/migrate.test.ts` pins `user_version` 49 in 3 places; adding a column REQUIRES the 050 migration + bumping all asserts (grep `49` in that file) — proven cost the last time.
- `npm run test` = desktop vitest (703 now) + api `npx vitest run` (~840) must stay green; `bash scripts/security-greps.sh` → ALL GREPS CLEAN; eslint 0 errors.
- CRLF files: use the incremental-file-editing python newline-preserving recipe for text surgery; commit explicit paths only (shared tree).

## Architecture

Two small new primitives carry the whole wave: (1) `PromptDialog` (an in-app replacement for the two dead `window.prompt` flows, same provider idiom as `ConfirmDialog`), and (2) a `Share` button on the current-server hero + owned directory rows that renders the node's `gmatch://node/` code (encode from existing data, copy via clipboard) plus the owner handle. Server side: one migration adds `owner_name` to `ServerDirectory`, the POST accepts it clamped, GET returns it, the heartbeat starts reporting it and bootstraps the registration for unclaimed host-mode installs. Docs update in the same wave (`ADR-002-servers.md`, HelpModal Network tab).

Workdir: `I:\goongrid\apps\desktop` ($D) and `I:\goongrid\apps\api`.

---

## Task 1 — PromptDialog: kill both window.prompt calls (P0)

**Files:** new `src/components/PromptDialog.tsx`, new `src/components/PromptDialog.test.tsx`, `src/utils/join-server.ts`, `src/components/servers/ServersView.tsx`

RED — `src/components/PromptDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  it('submits the typed value on Enter and closes', async () => {
    const onResolve = vi.fn();
    render(
      <PromptDialog
        title="Password required"
        description="Friend World is password-protected."
        onSubmit={(v) => onResolve(v)}
        onCancel={() => onResolve(null)}
      />,
    );
    await userEvent.type(screen.getByLabelText('Password required'), 'sekrit');
    await userEvent.keyboard('{Enter}');
    expect(onResolve).toHaveBeenCalledWith('sekrit');
  });
  it('resolves null on cancel', async () => {
    const onResolve = vi.fn();
    render(<PromptDialog title="Paste node code" onSubmit={(v) => onResolve(v)} onCancel={() => onResolve(null)} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onResolve).toHaveBeenCalledWith(null);
  });
});
```

`cd $D && npx vitest run src/components/PromptDialog.test.tsx` → FAIL (no module).

GREEN — `src/components/PromptDialog.tsx` (controlled-free: one input, autofocus, Enter=submit, Esc=cancel; DESIGN.md: `glass-field` input, `glass-action` buttons, `bg-black/70` scrim, `--z-modal`):

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

// In-app prompt. Electron does NOT implement window.prompt (it returns null),
// so every "ask the user for a string" flow in the .exe must come through here.
export function PromptDialog({
  title,
  description,
  placeholder = '',
  submitLabel = 'Confirm',
  onSubmit,
  onCancel,
}: {
  title: string
  description?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="glass-panel w-full max-w-sm rounded-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <h3 className="text-sm font-bold text-retro-fg">{title}</h3>
        {description && <p className="text-xs text-retro-muted">{description}</p>}
        <input
          ref={inputRef}
          aria-label={title}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(value.trim()) }}
          className="glass-field w-full px-3 py-2 text-xs font-mono"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="glass-action rounded-lg px-3 py-1.5 text-xs text-retro-muted hover:text-retro-fg cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
            className="glass-action glass-action-primary rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Wire it. `joinServer` is a plain async util, so convert the two prompts into an injected resolver rather than a context provider (fewest files, no provider chain through App): change signature to accept `askPassword?: (name: string) => Promise<string | null>`, defaulting to `undefined` meaning "caller must supply on desktop":

1. `src/utils/join-server.ts`: replace lines around the `window.prompt` with

```ts
  let password: string | undefined
  if (s.password_required) {
    const entered = await askPassword(s.name)
    if (entered === null) return 'cancelled'
    password = entered
  }
```

   and add `askPassword: (name: string) => Promise<string | null>` to the parameter list (required, not optional: tsc then FORCES every caller to wire the UI — the compiler is the migration test; the only callers are ServersView's `join` and `joinByCode`, per `grep -rn 'joinServer(' src --include=*.ts*`).

2. `src/components/servers/ServersView.tsx`: add state `const [joinAsk, setJoinAsk] = useState<null | { server: DirectoryServer }>(null)` next to the other useStates; a promise-ref `const pendingAsk = useRef<((v: string | null) => void) | null>(null)` (add `useRef` to the react import). Rewrite the two join helpers:

```ts
  const askPassword = (name: string) =>
    new Promise<string | null>((resolve) => { pendingAsk.current = resolve; setJoinAsk({ server: { name } as DirectoryServer }) })
  const join = async (s: DirectoryServer) => { void joinServer(s, toast, askPassword) }
```

   Render at the bottom of the component tree (inside the outer div):

```tsx
      {joinAsk && (
        <PromptDialog
          title="Server password"
          description={`${joinAsk.server.name} is password-protected. Enter the password the host gave you.`}
          submitLabel="Join"
          onSubmit={(v) => { pendingAsk.current?.(v); pendingAsk.current = null; setJoinAsk(null) }}
          onCancel={() => { pendingAsk.current?.(null); pendingAsk.current = null; setJoinAsk(null) }}
        />
      )}
```

3. `joinByCode` (ServersView.tsx:394-403): replace with a dialog too — state `const [codeAskOpen, setCodeAskOpen] = useState(false)`, the "Node code" button opens it (`onClick={() => { playPress(700); setCodeAskOpen(true) }}`), and a second `<PromptDialog title="Node code" submitLabel="Connect" onSubmit={(v) => { ...decodeNodeMask(v)...; setCodeAskOpen(false) }} .../>` carrying the current body (move the existing decode/writeDirectoryCache/joinServer lines into `joinByCode(entered: string)`).

Gate: `grep -rn 'window.prompt' src --include=*.ts --include=*.tsx | grep -v test` → **0 hits**. Update `src/components/servers/ServersView.test.tsx` mocks to pass `askPassword: async () => 'pw'` where join flows run.

Verify: `npx vitest run src/components/PromptDialog.test.tsx src/components/servers && npm run typecheck` → green.
Commit: `fix(desktop): in-app join prompts (Electron has no window.prompt; password + node-code join were dead in the exe)`

## Task 2 — `owner_name` on the directory (server)

**Files:** `apps/api/migrations/050_server_owner_name.sql`, `apps/api/schema.sql`, `apps/api/src/routes/servers.ts`, `apps/api/src/migrate.test.ts`, `apps/api/src/routes/servers.test.ts`

RED — add to `apps/api/src/routes/servers.test.ts` (follow the file's existing helper patterns for signed POSTs/GETs; check how the existing POST register test constructs identity first):

```ts
it('stores and returns a clamped owner_name; oversized names truncate', async () => {
  const res = await postServer({ name: 'N', owner_name: 'x'.repeat(80) })
  expect(res.status).toBe(201)
  const list = await getServers()
  const row = list.servers.find((s: { name: string }) => s.name === 'N')
  expect(row.owner_name).toBe('x'.repeat(40))
})
```

(`postServer`/`getServers` = whatever the file already uses; if there's no such helper, extend the nearest existing POST `/api/servers` test with the two extra asserts instead — one integration test, no new scaffold.)

Run: `cd /i/goongrid/apps/api && npx vitest run src/routes/servers.test.ts` → FAIL.

GREEN:

1. `apps/api/migrations/050_server_owner_name.sql`:

```sql
-- 050: directory rows carry the host's display name (share flows wave).
ALTER TABLE ServerDirectory ADD COLUMN owner_name TEXT;
PRAGMA user_version = 50;
```

2. `apps/api/schema.sql`: add `owner_name TEXT,` to the `ServerDirectory` CREATE TABLE (place after `owner_pubkey`).
3. `apps/api/src/routes/servers.ts`:
   - GET list SELECT (line ~74): add `owner_name` after `owner_id`.
   - POST: next to the other body parses add `if (typeof body?.owner_name === 'string') ownerName = body.owner_name.trim().slice(0, 40)` (declare `let ownerName = ''` with the others; empty string stays `null`-ish — bind `ownerName || null`). Extend the INSERT column list + VALUES + ON CONFLICT with `owner_name = COALESCE(excluded.owner_name, ServerDirectory.owner_name)` (absent never erases a known name, same rule as user_count).
   - The 201 row SELECT (line ~133): add `owner_name` to that select too (the create flow reads it back).
4. `apps/api/src/migrate.test.ts`: `grep -n '49' src/migrate.test.ts` → bump every user_version assert 49→50 (title string on line 30 included).

Verify: `npx vitest run src/routes/servers.test.ts src/migrate.test.ts` → green; `cd /i/goongrid && bash scripts/security-greps.sh` → ALL GREPS CLEAN.
Commit (repo root): `feat(api): directory owner_name column, clamped host-reported display name`

## Task 3 — Heartbeat carries owner_name + bootstraps unclaimed hosts

**Files:** `src/hooks/useServerHeartbeat.ts`, new `src/hooks/useServerHeartbeat.test.ts`

RED — `src/hooks/useServerHeartbeat.test.ts` (renderHook from @testing-library/react, vi.mock `../utils/api` orbitFetch + `../utils/central`, localStorage Map-stub per repo pattern):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServerHeartbeat } from './useServerHeartbeat';

const orbitFetch = vi.fn();
vi.mock('../utils/api', () => ({ orbitFetch: (...a: unknown[]) => orbitFetch(...a) }));
vi.mock('../utils/central', () => ({ getCentralApiUrl: () => 'https://central.test' }));

const store = new Map<string, string>();
const identity = { orbitId: 'me' } as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  Object.defineProperty(window, 'gmatch', { configurable: true, value: {
    serverState: async () => ({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: ['http://192.168.0.9:8790'] }),
  } });
  orbitFetch.mockReset();
  orbitFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/servers/node')) return { ok: true, json: async () => ({ name: 'My Box', description: 'd', isAdmin: true }) };
    return { ok: true, json: async () => ({ users: [], members_total: 3 }) };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as unknown as { gmatch?: unknown }).gmatch; });

describe('useServerHeartbeat bootstrap (host without a claim marker)', () => {
  it('registers the node itself so host mode is always linked to central', async () => {
    store.clear(); // no gmatch.server.register
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => expect(orbitFetch).toHaveBeenCalled());
    const centralPost = orbitFetch.mock.calls.find(([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST');
    expect(centralPost).toBeTruthy();
    const body = JSON.parse((centralPost![1] as { body: string }).body);
    expect(body.name).toBe('My Box');
    expect(body.endpoint_hint).toContain('192.168.0.9');
    expect(store.get('gmatch.server.register')).toBeTruthy();
  });
});
```

(`store.get` inside the hook: read `localStorage.getItem('gmatch.server.register')` in the assertion via `store`; keep the assertion via `store.get` — plain Map works since the hook only uses getItem/setItem, not Object.keys.)

Also extend an existing-or-second test: when REG_KEY exists, the POST body carries `owner_name` from `orbit_display_name`.

Run → FAIL.

GREEN — `src/hooks/useServerHeartbeat.ts`, restructure `tick` (keep the existing shape; two additions):

1. After `if (!raw) { ... }` — instead of early-return, bootstrap:

```ts
      if (!raw) {
        // Host mode without an in-game Create (switched via Settings): the
        // node still belongs on the directory. Claim it with its own name
        // and a LAN address, then the normal replay takes over next tick.
        try {
          const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
          if (!n.ok) return
          const nj = (await n.json()) as { name?: string; description?: string }
          const hint = (st.lanUrls?.[0] || '').replace(/^https?:\/\//, '')
          body = {
            name: (nj.name || 'gmatch').slice(0, 60),
            description: (nj.description || '').slice(0, 200),
            endpoint_hint: hint,
            password_required: false,
          }
          localStorage.setItem(REG_KEY, JSON.stringify(body))
        } catch { return }
      } else {
        try { body = JSON.parse(raw) } catch { return }
      }
```

   (`st` must expose `lanUrls` — the type already returns it from `serverState()`; check the mock's return shape here and thread `st` down. Note: the existing heartbeat gets `st` already.)

2. Before the central POST add the owner handle, read locally (never a network call for it):

```ts
      try {
        const dn = localStorage.getItem('orbit_display_name')
        if (dn) body.owner_name = dn.trim().slice(0, 40)
      } catch { /* session-only */ }
```

   `orbit_display_name` is the existing key (`grep -n orbit_display_name src/hooks/useIdentity.ts` — it's in the wipe list; confirm where it's WRITTEN: onboarding/profile save. If it turns out display name lives only on the server row, fall back to a one-shot `GET /api/users/me` cached in a module-level var — decide by reading `useIdentity.ts` first, implement the lazier of the two.)

3. Also update `registerDirectory` body in `ServersView.tsx` (~line 257) to include `owner_name: localStorage.getItem('orbit_display_name') || undefined` so fresh Creates carry it immediately, not only after the first heartbeat.

Verify: `npx vitest run src/hooks/useServerHeartbeat.test.ts && npm run typecheck` → green.
Commit: `feat(desktop): heartbeat bootstraps unclaimed hosts + reports owner_name`

## Task 4 — Share button: node code + handle, visible and copyable

**Files:** `src/components/servers/ServersView.tsx`, new `src/utils/nodeShare.ts` + `src/utils/nodeShare.test.ts`

The share string's source data all exists: hero knows `serverName`; `window.gmatch.serverState()` gives `lanUrls` + mode; a `mine(s)` directory row has `endpoint_hint` + `id`. One pure helper so both surfaces share it:

RED — `src/utils/nodeShare.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildNodeCode } from './nodeShare';

describe('buildNodeCode', () => {
  it('encodes host:port from a lanUrl or raw hint with the server name', () => {
    const code = buildNodeCode('http://192.168.0.42:8790', 'Beach House')!
    expect(code.startsWith('gmatch://node/')).toBe(true)
    expect(decodeNodeMask(code)).toEqual({ host: '192.168.0.42', port: 8790, name: 'Beach House' })
  })
  it('accepts a bare host:port hint', () => {
    const code = buildNodeCode('203.0.113.9:8790', 'Box')!
    expect(decodeNodeMask(code)!.port).toBe(8790)
  })
  it('null on junk or missing name', () => {
    expect(buildNodeCode('not a url', 'x')).toBeNull()
    expect(buildNodeCode('http://a.b:8790', '')).toBeNull()
  })
})
```
(plus the `decodeNodeMask` import at top)

GREEN — `src/utils/nodeShare.ts`:

```ts
// One builder for the human-shareable node code (Servers hero + directory
// rows). Wraps encodeNodeMask; input is a lanUrl ('http://h:p') or bare hint.
import { encodeNodeMask } from './nodeMask'

export function buildNodeCode(address: string, name: string): string | null {
  const trimmed = String(address || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!trimmed) return null
  const colon = trimmed.lastIndexOf(':')
  const maybePort = colon > 0 ? trimmed.slice(colon + 1) : ''
  const hasPort = /^\d{1,5}$/.test(maybePort)
  const host = hasPort ? trimmed.slice(0, colon) : trimmed
  const port = hasPort ? Number(maybePort) : null
  return encodeNodeMask(host, port, String(name || '').trim().slice(0, 40))
}
```
(encodeNodeMask returns null for empty name — but slice(0,40) of '' is '', and it rejects falsy name; still guard `if (!name.trim()) return null` FIRST for the empty-name case above.)

UI, two placements (different surfaces, one-control rule intact — the Settings tab owns raw addresses, the Servers tab owns node codes):

1. Hero (`ServersView.tsx`, the button row next to Rename, ~line 480), renders only for a host-mode node (`serverMode === 'host'`):

```tsx
                <button
                  type="button"
                  onClick={() => {
                    playPress(820)
                    void (async () => {
                      const st = await window.gmatch?.serverState?.().catch(() => null)
                      const code = buildNodeCode(st?.lanUrls?.[0] || '', serverName)
                      if (!code) { toast('No shareable address yet. Check your server settings.', 'warning'); return }
                      try {
                        await navigator.clipboard.writeText(`${code}\n\nServer handle: ${localStorage.getItem('orbit_display_name') || serverName}\nPaste in your friend's Servers tab: button "Node code".`)
                        toast('Server code copied. Send it to your friends.', 'success')
                      } catch { toast('Could not reach the clipboard.', 'error') }
                    })()
                  }}
                  className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" /> Share
                </button>
```
(import `Share2` from lucide-react; add to the existing import line.)

2. Owned directory rows (`mine(s)` branch next to the unregister button ~line 903): same button, address from `s.endpoint_hint`, name from `s.name`. Extract the copy body into one local `shareServer(address: string, name: string)` callback in the component (DRY: hero calls it with the LAN url, rows with the hint).

3. Paste target already exists (Task 1's "Node code" dialog). Copy payload is ONE string a friend pastes whole? No — the dialog decodes strictly `gmatch://node/<token>`; keep the extra handle lines OUT of the clipboard. Lazy final answer: hero copies just the code; the handle is already visible on the row (Task 4.4 below) and in the dialog description. Fix the copy string to `` code `` alone. (Documented decision; do not ship a paste blob that the decoder rejects.)

4. Show the handle explicitly: directory row meta line (`ServersView.tsx:894` area) — when `s.owner_name` exists, render `<span>by {s.owner_name}</span>` inside the existing meta flex (same `text-[10px] text-retro-muted` row, NOT green, no new control). Anonymous callers never receive owner_name? They do (it's public metadata like name/description; only endpoint_hint is auth-gated server-side) — keep it that way; add `owner_name?: string` to the `DirectoryServer` interface and include it in the search filter string at line 234.

Verify: `npx vitest run src/utils/nodeShare.test.ts && npm run typecheck && npm run lint` → green. Add one assertion to `ServersView.test.tsx`: a fixture row with `owner_name: 'Alice'` renders 'by Alice' (reuse the file's fetch-mock pattern; check that the mock GET /api/servers fixture supports extra fields).
Commit: `feat(desktop): server share button, node code to clipboard, owner handle on rows`

## Task 5 — Liveness on rows

**File:** `src/components/servers/ServersView.tsx` (~line 894 meta row)

One line, reuse `formatRelativeTime` (already in the file). In the row meta flex, after the address span:

```tsx
                            <span>seen {formatRelativeTime(s.last_seen)}</span>
```

No new test (pure formatting call on existing data; `formatRelativeTime` is already exercised via the users list). Sort already prefers `last_seen` ("Recent" is the default).
Commit: `feat(desktop): directory rows show node freshness`

## Task 6 — Docs: ADR + Help + SPEC sweep

**Files:** `docs/ADR-002-servers.md`, `src/components/HelpModal.tsx`, `docs/DESKTOP.md`, `docs/SPEC.md` (only if it contradicts the new share flow)

1. `ADR-002-servers.md`: append a "Share flows (2026-09-12)" section: node code = `gmatch://node/` (opaque-looking, decodes locally, NOT a security boundary), hosts list themselves via heartbeat (bootstrap included), owner_name is host-reported best-effort metadata, join from paste requires the recipient to reach the LAN address (same-network assumption stated honestly), directory freshness 24h prune + `seen Xm ago` display.
2. HelpModal 'network' tab: 2 sentences + the existing rules stay true:
   - `<li><span className="text-retro-body font-medium">Host a world</span>: Settings → Server, switch to host. It lists itself on the directory; Share copies your node code for friends.</li>`
   - `<li><span className="text-retro-body font-medium">Join a friend</span>: Servers tab, "Node code", paste what they sent. Passwords go through the in-app dialog.</li>`
   Read the tab markup first (grep the 'network' section), match its existing `<ul>/<li>` structure exactly.
3. `docs/DESKTOP.md`: troubleshooting table row: "Friend's node code rejected → the code is one line, starts with gmatch://node/; re-copy with Servers → Share."
4. Stale-topology sweep (standing rule): `grep -rn 'no central server\|NO central' apps/desktop/electron docs README.md` → fix any survivors to match reality (central node + blind courier + host opt-in). The `main.cjs:62` + `apiSidecar` headers still say "1.0, no-central-server plan"; update those two comments in-place.
Commit: `docs: share flows, node liveness, stale topology comments`

## Task 7 — Release gates + artifact

```
cd /i/goongrid/apps/desktop && npx vitest run src 2>&1 | tail -3        # all green (was 703)
cd /i/goongrid/apps/api && npx vitest run 2>&1 | tail -3                # all green (~840)
cd /i/goongrid && npm run lint && npm run typecheck                     # 0 errors
bash scripts/security-greps.sh                                           # ALL GREPS CLEAN
grep -rn 'window.prompt' apps/desktop/src --include=*.ts* | grep -v test # 0
cd apps/desktop && npm run dist && ls -la release/gMatch-1.2.1-portable.exe
```

(version 1.2.0 is untagged/unreleased; bump `apps/desktop/package.json` to **1.2.1** with this wave so the built artifact is unambiguous: `sed -i 's/"version": "1.2.0"/"version": "1.2.1"/' apps/desktop/package.json`, commit `chore(desktop): v1.2.1`.)

Manual smoke of the artifact (record in the final report, all must pass):
1. Launch exe (host-mode install). Within ~1 min, `curl -s https://gmatch.fly.dev/api/servers` shows a row for the node with `owner_name` set — proves the bootstrap + central liveness claim END-TO-END against the real hub. (If the user's hub is off, say so; do not fake.)
2. Servers tab, host node hero → Share → clipboard contains a single line starting `gmatch://node/`.
3. Second exe copy (or Settings>Server host->client switch) → Servers → Node code → paste → join dialog path completes WITHOUT any dead prompt.
4. Directory row shows `by <name>` and `seen Xs ago` for a freshly heartbeated node.
5. Password-protected join shows the in-app dialog (not a dead cancel).

## Risks, tradeoffs, open questions

- **Bootstrap listing may surprise host-mode users who wanted a private node.** Mitigation: the row appears in the PUBLIC directory with a LAN address others can't reach unless they're on the network; Settings → Server copy already explains hosting means sharing. Open question for the user: want a "list my server" toggle instead of unconditional? Default shipped here: host = listed (their stated directive is "ensure everything is live and linked").
- **owner_name is host-reported** (best-effort metadata, same class as user_count; a malicious host can lie about its own handle). Accepted per the skill's authoritative-claim rule; ADR states it.
- **LAN-only address in codes:** friends on different networks still can't join (no hole-punching for the HTTP node). Out of scope; ADR documents the same-network assumption (already implicit in the 1.1 share flow — ServerTab LAN list).
- **Task 3 test uses fake timers + promise microtasks**: known-flaky combo; use `vi.waitFor` from the hook's own scope as written, and if the repo's vitest version lacks it, `await act(async () => { await Promise.resolve() })` loops (do NOT abandon the test).
- **Two PromptDialog instances mounted sequentially (code dialog, then join password)** — the code dialog closes before `joinServer` opens the password one (state settles in onResolve handlers); verified by the Task 1 test structure (single resolver ref).
- Skipped (ponytail, add when needed): share via QR, relay-backed public join (needs TURN-like HTTP relay = whole new project), owner handle resolution by orbitId lookup (denormalized owner_name is one fewer network roundtrip and works offline from the gossip cache).
