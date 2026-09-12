# Plan: fix the create-node cycle (handle-only sharing, owner controls, admin PIN, server switching)

Repo: `I:/goongrid` (gMatch / goongrid monorepo, npm workspaces).
Backend: Hono + SQLite (D1Turso) in `apps/api`. Desktop: Electron + React/Vite in `apps/desktop`.

## Goal

Make the server (node) create→share→manage cycle complete and IP-free: the creator can
copy a shareable `gmatch://node/…` handle before and after creating, rename/delete/make-private
their server at any point, never sees a raw IP in any UI, never sees the admin's name in the
server browser, sees the admin PIN once when first logging into a server they host, and can
switch between servers.

## Current context (verified, read the files before starting)

- Directory API: `apps/api/src/routes/servers.ts`
  - `GET /api/servers` returns rows incl. `endpoint_hint` (to authed callers only) and `owner_name`.
  - `POST /api/servers` upserts by `id = sha256(ownerPub|name)`; accepts name/description/
    endpoint_hint/password_required/user_count/online_count/owner_name. There is NO privacy flag.
  - `PATCH /api/servers/:id` updates name/description/endpoint_hint/password_required (owner only).
  - `DELETE /api/servers/:id` unregisters (owner only).
- Schema: `apps/api/migrations/045_server_directory.sql` (+ 046 admin flags, 047 counts, 050 owner_name).
  Latest migration is `050_…` — new one is `051`.
- Desktop UI: `apps/desktop/src/components/servers/ServersView.tsx` (~1012 lines)
  - Create drawer (~line 736) has an "Address friends use" input whose placeholder literally shows
    an IP (`192.168.0.42:8790`).
  - Directory rows (~line 935) render `maskedServerUrl(s.endpoint_hint)` (a half-masked IP — still
    leaks two octets) and `by {s.owner_name}` (the admin name — must go).
  - `unregister()` (~line 438) removes the directory row and `DIRECTORY_ID_KEY` but NOT `REG_KEY`
    (`gmatch.server.register`, line 72). Because `create()` (line 304) refuses when `REG_KEY` is set
    in host mode, **once you create a server on an install you can never create another one** —
    that's the stuck "create node cycle".
  - Share button (line 505) exists post-create (host mode) → `shareServer()` copies
    `buildNodeCode(lanUrls[0], serverName)` to clipboard. No handle is offered BEFORE create, and
    it's never rendered on screen.
  - `mine(s)` rows only get "unregister" + "Share"; there's no rename/private/delete affordance
    keyed off the directory row, and the hero Rename (line 519) only edits the LOCAL node
    (`PATCH /api/servers/node`), not the directory row if `directoryId` is unknown.
  - Leave button (line 496) only renders in `client` mode; joining covers client→X, but there is no
    visible "switch" affordance and a client cannot jump back to their own hosted node from a row.
- Handle codec: `apps/desktop/src/utils/nodeMask.ts` (`encodeNodeMask`/`decodeNodeMask`,
  `gmatch://node/<b64>`), wrapper `apps/desktop/src/utils/nodeShare.ts` (`buildNodeCode`).
- Admin PIN: minted per install in `apps/desktop/electron/admin-pin.cjs`, exposed to the renderer by
  `server:state` IPC (`apps/desktop/electron/main.cjs:942`) as `adminPin`, typed in
  `apps/desktop/src/types/gmatch-bridge.ts:30`. It is currently only visible in
  Settings → Server (`apps/desktop/src/components/settings/ServerTab.tsx:70`), buried.
- Host claim flow: `apps/desktop/src/hooks/usePendingServerHost.ts` (`claimPendingHost`) runs after
  create+relaunch; on success toasts "You are now hosting … You are its admin." — that is the
  "admin first logs into the server" moment.
- Heartbeat: `apps/desktop/src/hooks/useServerHeartbeat.ts` replays the `REG_KEY` body to
  `POST {central}/api/servers` every 15 min. Any new field (private) must ride in `REG_KEY` or the
  replay must not clobber it (see Task 3 — it won't).
- Tests exist and must keep passing / be extended:
  `apps/api/src/routes/servers.test.ts`, `apps/desktop/src/components/servers/ServersView.test.tsx`
  (note line 62 asserts `by Alice` IS shown — it flips), `nodeMask.test.ts`, `nodeShare.test.ts`.

## Assumptions (defaults picked, no user available to ask)

- "Handle" = the existing `gmatch://node/…` code (`buildNodeCode`). It encodes the address in
  base64 — treat it as opaque; it is the share artifact, same as Settings→Server already does.
- "Delete it" = unregister the directory row + clear the install's claim marker so a fresh create
  is possible again (the cycle). It does NOT wipe the local SQLite node (destructive; out of scope —
  Settings has that).
- "Make it private" = unlisted in the public directory (joinable only via the handle out-of-band).
  The existing `hidden` column is master-admin moderation; owners get a new `is_private` flag.
- "Admin name" in the browser = `owner_name`; strip it from the public listing response AND stop
  rendering it client-side (defense in depth).
- Admin PIN "when the admin first logs in" = one-time banner in the Servers hero while hosting as
  admin, until dismissed (marker in localStorage), covering both fresh-create and an existing
  host-mode install that never saw it.

## Architecture

One new column (`is_private`) owned by the row creator, filtered server-side for non-owners. The
directory UI stops rendering any address/name text and instead renders the shareable handle chip
(copy = real code, display = truncated). The create drawer grows a live handle preview + a private
checkbox; `unregister` clears the claim marker so the create→delete→create cycle un-sticks. A
first-login PIN banner reads `serverState().adminPin` (already exposed) and self-dismisses.

---

## Task 1 — API: add `is_private` to the schema

File: create `apps/api/migrations/051_server_directory_private.sql`

```sql
-- Migration 051: owner-controlled privacy. is_private rows are omitted from the
-- public directory for everyone except their owner; joining still works
-- out-of-band via the gmatch://node/ handle (the hub is never needed to reach
-- a node — see docs/ADR-002-servers.md).
ALTER TABLE ServerDirectory ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
```

Copy the header/format from `046_server_directory_admin.sql`. Check how migrations are applied
(read `apps/api/src/migrate-cli.ts` + `apps/api/src/db.ts` mock env — `createMockEnv` in
`apps/api/src/test-utils.ts` builds the schema; find where it applies migrations and make sure
051 is picked up the same way 046-050 were; if the mock applies all files in `migrations/`, no
test code change is needed).

Verify (no test yet — schema only):

```
cd I:/goongrid/apps/api && npx vitest run src/routes/servers.test.ts
```
Expected: all existing tests still pass (green).

Commit: `git add apps/api/migrations/051_server_directory_private.sql && git commit -m "feat(servers): is_private column on ServerDirectory"`

## Task 2 — API: privacy + owner_name stripping in the listing (TDD)

Files: `apps/api/src/routes/servers.test.ts` (test first), `apps/api/src/routes/servers.ts`.

**RED** — append to the `describe('Server directory API')` in `servers.test.ts`:

```ts
  it('private servers are omitted for everyone except the owner; owner_name never listed', async () => {
    const priv = JSON.stringify({ name: 'Hidden Realm', endpoint_hint: 'secret.host:8790', private: true })
    const reg = await app.request('/api/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(owner, 'POST', '/api/servers', priv) }, body: priv,
    }, env)
    expect(reg.status).toBe(201)
    const created = (await reg.json()) as { server: { id: string; is_private: number } }
    expect(created.server.is_private).toBe(1)

    // anonymous + other authed users must not see it at all
    const anon = (await (await app.request('/api/servers', {}, env)).json()) as { servers: Array<{ id: string }> }
    expect(anon.servers.some((s) => s.id === created.server.id)).toBe(false)
    const otherList = (await (await app.request('/api/servers', { headers: headers(other, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string; owner_name?: string }> }
    expect(otherList.servers.some((s) => s.id === created.server.id)).toBe(false)
    // and owner_name is stripped from every listed row
    expect(JSON.stringify(otherList.servers)).not.toContain('owner_name')

    // the owner sees their own private row
    const ownList = (await (await app.request('/api/servers', { headers: headers(owner, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string }> }
    expect(ownList.servers.some((s) => s.id === created.server.id)).toBe(true)
  })
```

Run: `cd I:/goongrid/apps/api && npx vitest run src/routes/servers.test.ts -t "private servers"` → expect FAIL.

**GREEN** — in `servers.ts`:

1. `GET /` (line 72): add the owner filter and stop returning `owner_name`/raw hint for privacy:

```ts
servers.get('/', softAuth, async (c) => {
  const viewer = c.get('orbitId') || ''
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description, owner_id, password_required, endpoint_hint, user_count, online_count, is_private, created_at, last_seen
     FROM ServerDirectory
     WHERE last_seen >= datetime('now', ?)
       AND COALESCE(hidden, 0) = 0 AND COALESCE(blocked, 0) = 0
       AND (COALESCE(is_private, 0) = 0 OR owner_id = ?)
     ORDER BY last_seen DESC LIMIT 100`,
  ).bind(`-${STALE_MS / 1000} seconds`, viewer).all<Record<string, unknown>>()
  // Host addresses go to signed-in callers only (anti-scraper); the admin
  // display name is NEVER listed — browsers join by handle, not by person.
  const authed = !!c.get('orbitId')
  return c.json({ servers: (results || []).map((r) => ({ ...r, owner_name: undefined, ...(authed ? {} : { endpoint_hint: undefined }) })) })
})
```

(Drop `owner_name` from the SELECT list entirely if lint complains about the undefined-spread; the
point is: the key must not appear in the JSON.)

2. `POST /` (line 86): accept the flag and preserve it across heartbeats. In the body parse block
   add after the `owner_name` line:

```ts
    // Owner privacy: true/false sets it; absent (heartbeat replay) preserves.
    let priv: 0 | 1 | null = null
    if (body?.private === true) priv = 1
    if (body?.private === false) priv = 0
```

   declare `let isPrivate = 0` next to the other lets, `if (priv !== null) isPrivate = priv`,
   add `is_private` to the INSERT column list + one more `?` value, and in the `ON CONFLICT DO
   UPDATE` set clause add:

```sql
      is_private = CASE WHEN ? IS NULL THEN ServerDirectory.is_private ELSE excluded.is_private,
```

   i.e. bind order: insert values…, then in DO UPDATE the `priv` param (`null` when the client
   omitted it). If the CASE/excluded mix is fiddly in the D1 mock, the equivalent simpler form is
   `is_private = COALESCE(?, ServerDirectory.is_private)` in DO UPDATE with `priv` bound after
   `.bind(...)` of the main values — pick whichever the mock accepts, the test below pins behavior.

   The 201 response SELECT (line 133) must include `is_private`.

3. `PATCH /:id` (line 189): after `password_required` handling add:

```ts
  const isPrivate = typeof body.private === 'boolean' ? (body.private ? 1 : 0) : current.is_private
```

   (include `is_private` in the `current` SELECT) and add `is_private = ?` to the UPDATE +
   the updated-row SELECT.

4. Remove `owner_name` from the GET/`PATCH` response surfaces as applicable (POST response may
   keep it — it's the owner's own row).

Run: `npx vitest run src/routes/servers.test.ts` → ALL green (existing tests: the `by owner_name`
counts test asserts DB-side behavior via the row response, keep it passing; the
`not.toContain('example.org')` anonymous assertion still holds).

Commit: `git add apps/api/src/routes/servers.ts apps/api/src/routes/servers.test.ts && git commit -m "feat(servers): owner-set private listings; no owner_name in public directory"`

## Task 3 — API: `is_private` survives heartbeat replay (regression test)

**RED** — add to `servers.test.ts`:

```ts
  it('heartbeat re-register without the private flag does not make a private server public', async () => {
    const first = JSON.stringify({ name: 'Stay Hidden', private: true })
    const reg = (await app.request('/api/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(other, 'POST', '/api/servers', first) }, body: first,
    }, env)) as Response
    const row = ((await reg.json()) as { server: { id: string } }).server
    const replay = JSON.stringify({ name: 'Stay Hidden' })
    await app.request('/api/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(other, 'POST', '/api/servers', replay) }, body: replay,
    }, env)
    const list = (await (await app.request('/api/servers', { headers: headers(owner, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string }> }
    expect(list.servers.some((s) => s.id === row.id)).toBe(false)
  })
```

Run → fails against Task 2's code if the upsert clobbers `is_private`; fix the DO UPDATE clause
(`COALESCE(?, ServerDirectory.is_private)` with `priv` bound as `null` when absent). Re-run green.

Commit: `git commit -am "test(servers): private flag survives heartbeat upsert"`

## Task 4 — Desktop: directory rows show the handle, never IP or admin name (TDD)

Files: `apps/desktop/src/components/servers/ServersView.test.tsx`, `ServersView.tsx`.

**RED** — in the first test (`lists public servers …`, line ~51):
- flip line 62 to: `expect(screen.queryByText('by Alice')).not.toBeInTheDocument()`
- add: `expect(screen.getByText('yours')); ` — no. Precisely:

```ts
    // never a raw/semi-masked IP; the share artifact is the opaque handle
    expect(screen.queryByText(/192\.168/)).not.toBeInTheDocument()
    expect(screen.getByTitle('Copy node code')).toBeInTheDocument()
```

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/components/servers/ServersView.test.tsx` → the new assertions FAIL.

**GREEN** — in `ServersView.tsx` row meta block (line ~934):

Replace

```tsx
<span>{s.endpoint_hint ? maskedServerUrl(s.endpoint_hint) : 'no address published'}</span>
{s.owner_name && <span>by {s.owner_name}</span>}
```

with a handle chip (the code comes from `buildNodeCode`, already imported):

```tsx
<span className="flex items-center gap-1">
  {s.endpoint_hint ? (
    <>
      <span className="truncate max-w-[140px]">{(buildNodeCode(s.endpoint_hint, s.name) || 'handle unavailable').slice(0, 18)}…</span>
      <button
        type="button"
        title="Copy node code"
        aria-label={`Copy code for ${s.name}`}
        onClick={() => { playPress(820); void shareServer(s.endpoint_hint, s.name) }}
        className="text-retro-muted hover:text-retro-fg cursor-pointer"
      >
        <Share2 className="w-3 h-3" />
      </button>
    </>
  ) : 'no address published'}
</span>
```

Also in `ServersView.tsx`:
- `DirectoryServer` (line 25): add `is_private?: number`, drop `owner_name?: string`.
- `visibleServers` search string (line 247): remove `s.owner_name ?? ''`.
- Delete the `maskedServerUrl` import (line 15) once no usage remains (hero/dir rows); if
  `ServersView.mask.test.tsx` targets another file, leave that file alone.
- Your own private row: `{!!s.is_private && <span className="…">PRIVATE</span>}` badge next to the
  lock badge (reuse the YOURS badge classes).
- Update the existing test at line 62 (`by Alice`) as above and any other test asserting
  `maskedServerUrl` output — grep first:
  `grep -n "192.168\\|by Alice\\|maskedServerUrl" src/components/servers/ServersView*.test.*`

Re-run the file's suite → green. Also run `npx vitest run src/utils/nodeShare.test.ts`
(behavior unchanged).

Commit: `git add apps/desktop/src/components/servers && git commit -m "feat(servers-ui): rows show shareable node handle only — no IPs, no admin name"`

## Task 5 — Desktop: create drawer — live handle preview, private checkbox, no IP placeholder (TDD)

**RED** — new test in `ServersView.test.tsx`:

```ts
  it('create drawer previews the node handle before creating and offers a private toggle', async () => {
    (window as any).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'https://central.test', lanUrls: ['http://192.168.0.42:8790'], adminPin: 'abcd1234' }),
      serverSet: async () => ({ ok: true }),
      serverRelaunch: () => {},
    }
    mockFetch(async () => json({ servers: [] }))
    render(<ServersView identity={identity} toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Create server/i }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'My Realm' } })
    const code = await screen.findByTestId('create-handle-preview')
    expect(code.textContent).toMatch(/^gmatch:\/\/node\//)
    expect(screen.queryByText(/192\.168/)).not.toBeInTheDocument() // IP shown only inside the opaque code
    expect(screen.getByLabelText(/Private server/i)).toBeInTheDocument()
  })
```

**GREEN** — `ServersView.tsx`:
1. Hoist host state so the drawer can use `lanUrls` before create: add
   `const [hostState, setHostState] = useState<Awaited<NonNullable<typeof window.gmatch.serverState>> | null>(null)`
   and set it in the existing `serverState()` effect (line 222-226): `setHostState(s)`.
2. In the create drawer, replace the "Address friends use" input (line ~759-763 — remove the
   placeholder `192.168.0.42:8790`; keep the input but relabel "Advanced address override (optional)"
   with empty placeholder) with, below the name field, a live preview:

```tsx
{(() => {
  const preview = buildNodeCode(hint.trim() || hostState?.lanUrls?.[0] || '', name.trim())
  return preview ? (
    <div data-testid="create-handle-preview" className="flex items-center gap-2 text-xs font-mono text-retro-muted">
      <span className="truncate max-w-[220px]">{preview.slice(0, 28)}…</span>
      <button type="button" onClick={() => void navigator.clipboard.writeText(preview)}
        className="glass-action px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer">Copy code</button>
    </div>
  ) : <p className="text-xs text-retro-muted">Type a name to get your share code.</p>
})()}
```

3. Private checkbox next to the password checkbox:
   `const [isPrivate, setIsPrivate] = useState(false)` +

```tsx
<label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer pt-0.5">
  <input type="checkbox" aria-label="Private server" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
  Private — hide from the public browser (friends join with your code)
</label>
```

4. Wire it through: `registerDirectory(n, d, h, pwRequired, privateFlag)` → body gets
   `private: privateFlag`; `REG_KEY` payload (line 314) gets `private: isPrivate` so the heartbeat
   (which POSTs the stored body verbatim) keeps the row private; `closeCreateForm` resets
   `setIsPrivate(false)`.

Run the file → green.

Commit: `git add apps/desktop/src/components/servers apps/desktop/src/hooks && git commit -m "feat(servers-ui): pre-create handle preview + private flag in create flow"`

## Task 6 — Desktop: fix the stuck cycle — unregister clears the claim (TDD)

**RED** — new test:

```ts
  it('unregistering my server clears the host claim so create works again', async () => {
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    stubLocalStorage({
      'gmatch.central.url': 'https://central.test',
      'gmatch.server.register': JSON.stringify({ name: 'My Realm', private: false }),
      'gmatch.server.directoryId': 'bbb',
    })
    ;(window as any).confirm = () => true
    mockFetch(async (url, init) => {
      if (String(init?.method) === 'DELETE' && url.includes('/api/servers/bbb')) return json({ ok: true })
      if (url.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 1 })
      if (url.includes('/api/servers/node')) return json({ name: 'My Realm', description: '', isAdmin: true })
      return json({ servers: [{ id: 'bbb', name: 'My Realm', owner_id: ownId, password_required: 0, endpoint_hint: '10.0.0.1:8790' }] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    fireEvent.click(await screen.findByText('unregister'))
    await waitFor(() => expect(localStorage.getItem('gmatch.server.register')).toBeNull())
    expect(localStorage.getItem('gmatch.server.directoryId')).toBeNull()
  })
```

**GREEN** — `unregister()` (ServersView line 438): after a successful DELETE, also

```ts
      // Un-stick the create cycle: the claim marker must die with the row, or
      // create() will refuse forever ("This computer already hosts").
      try {
        const raw = localStorage.getItem(REG_KEY)
        const reg = raw ? JSON.parse(raw) : null
        const myDirectoryId = (() => { try { return localStorage.getItem(DIRECTORY_ID_KEY) } catch { return '' } })()
        if (reg && (!myDirectoryId || s.id === myDirectoryId)) localStorage.removeItem(REG_KEY)
      } catch { /* session-only */ }
```

(If `serverMode === 'host'`, this is enough — the next Create re-claims the local node; the
in-flight heartbeat will 404-free replay into a fresh row on next create.)

Run file → green.

Commit: `git add apps/desktop/src/components/servers && git commit -m "fix(servers): unregister clears REG claim marker — create/delete cycle un-stuck"`

## Task 7 — Desktop: per-row owner controls (rename / private / delete) post-create

`ServersView.tsx` `mine(s)` button stack (line ~946): currently `unregister` + `Share`. Make it:
`Share`, `Rename`, `Private`, `Delete`.

- Rename: reuse the existing inline editor — on click, `setEditingServer(true)` (hero editor is
  already wired to sync the directory row via `renameServer()`'s `PATCH /api/servers/:id`) and
  scroll focus isn't needed; single line:
  `onClick={() => { playPress(780); setServerName(s.name); setEditingServer(true) }}` with
  `<Pencil className="w-3 h-3" /> Rename` label (Pencil already imported).
- Private toggle: new async helper next to `unregister`:

```ts
  const setPrivate = async (s: DirectoryServer, v: boolean) => {
    if (!identity) return
    const res = await orbitFetch(`${central}/api/servers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ private: v }),
    }, identity)
    if (!res.ok) { toast('Could not change privacy for this server', 'error'); return }
    try {
      const raw = localStorage.getItem(REG_KEY)
      if (raw) localStorage.setItem(REG_KEY, JSON.stringify({ ...JSON.parse(raw), private: v }))
    } catch { /* session-only */ }
    toast(v ? 'Server is private — reachable only via your code.' : 'Server is public again.', 'success')
    void refresh()
  }
```

  button: `{s.is_private ? 'Make public' : 'Make private'}`.
- Keep `unregister` as the Delete action (relabel to `delete` — test 6 looks up by text 'unregister';
  either keep the label 'unregister' or update that test's `findByText` — **keep the label**).

Extend test from Task 6/4 with one assertion: `expect(await screen.findByText('Make private')).toBeInTheDocument()`
inside a `mine(s)` fixture. TDD as before.

Verify: `npx vitest run src/components/servers/ServersView.test.tsx` green;
`npx tsc --noEmit` in `apps/desktop` clean.

Commit: `git commit -am "feat(servers-ui): owner rename/private controls on your directory rows"`

## Task 8 — Desktop: admin PIN shown on first login into a hosted server

`ServersView.tsx`, inside the left hero `<section>` (after the title row, line ~529):

```tsx
{serverMode === 'host' && node?.isAdmin && pinToDismiss && (
  <div role="alert" className="glass-inset p-2.5 rounded-lg space-y-1.5" data-testid="admin-pin-banner">
    <p className="text-xs text-retro-fg font-bold">You are the admin of this server</p>
    <p className="text-xs text-retro-muted">
      Your admin passcode (unlocks the console — store it somewhere safe):{' '}
      <button type="button" className="font-mono text-amber-200 cursor-pointer"
        onClick={() => { void navigator.clipboard.writeText(pinToDismiss); toast('Passcode copied', 'success') }}>
        {pinToDismiss}
      </button>
    </p>
    <button type="button"
      onClick={() => { try { localStorage.setItem(PIN_SEEN_KEY, '1') } catch { /* session-only */ }; setPinToDismiss('') }}
      className="glass-action glass-action-primary px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer">
      Got it
    </button>
  </div>
)}
```

Wiring at component top:

```ts
const PIN_SEEN_KEY = 'gmatch.server.pinSeen'
const [pinToDismiss, setPinToDismiss] = useState('')
useEffect(() => {
  window.gmatch?.serverState?.()
    .then((st) => {
      let seen = false
      try { seen = Boolean(localStorage.getItem(PIN_SEEN_KEY)) } catch { /* private mode */ }
      if (!seen && st?.mode === 'host' && st?.adminPin) setPinToDismiss(st.adminPin)
    })
    .catch(() => { /* no bridge: browser/dev */ })
}, [])
```

The `isAdmin` gate comes from the already-fetched `/api/servers/node` (`node?.isAdmin`), so a client
joined to someone else's server never sees a PIN (their `serverState().adminPin` is THEIR local
install's pin and mode is 'client' → hidden; correct).

Test (RED first, then green): fixture with `gmatch.serverState` returning
`{ packaged: true, mode: 'host', url: '', lanUrls: [], adminPin: 'beefcafe' }` + `/api/servers/node`
→ `{ name: 'My Realm', description: '', isAdmin: true }`; assert
`screen.getByTestId('admin-pin-banner')` contains 'beefcafe'; click 'Got it'; re-render → absent
(marker set). Remember the test stub helper `stubLocalStorage` already exists — reuse it.

Commit: `git commit -am "feat(servers-ui): one-time admin passcode banner on first host login"`

## Task 9 — Desktop: switching servers is a first-class action

Gaps to close (the mechanics — `joinServer`/`leave`/`serverSet`/`serverRelaunch` — all exist):
1. Host mode has no Leave equivalent needed, but a CLIENT has no way to get back to *its own*
   hosted node from the browser, and neither mode gets a labeled "Switch" affordance.
2. `mine(s)` rows currently render no Join/Switch button at all.

In `ServersView.tsx`:

```ts
  const currentUrl = getApiBaseUrl().replace(/\/+$/, '').toLowerCase()
  const isCurrent = (s: DirectoryServer) =>
    !!s.endpoint_hint && currentUrl === normalizeServerUrl(s.endpoint_hint)?.replace(/\/+$/, '').toLowerCase()

  // Switch = join another node, or hop back to this machine's own host node.
  const switchTo = async (s: DirectoryServer) => {
    if (!mine(s)) { void joinServer(s, toast, askPassword); return }
    if (!window.gmatch?.serverSet) return
    const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
    if (res.ok) { toast('Switching to your own server. The app restarts.', 'success'); window.gmatch.serverRelaunch?.() }
    else toast(res.error || 'Could not switch servers', 'error')
  }
```

Row buttons (mine branch, Task 7 stack): add
`{!isCurrent(s) && <button … onClick={() => void switchTo(s)}><ArrowLeft className="w-3 h-3" /> Switch</button>}`
above Share; non-mine rows: keep `Join` but disable+label `Connected` when `isCurrent(s)`.
Hero (line 496): relabel the client-mode `Leave` button to `Switch` (icon `ArrowLeft`, text
`Switch server`) — it goes back to this install's host node, which is exactly switching. Also
render the hero switch button in host mode only if `visibleServers.length > 0` is false — no: host
users switch by clicking Join/Switch on any row; leave hero host-mode unchanged (YAGNI).

Test: non-mine row + `serverMode==='client'` state shows 'Join'; row whose `endpoint_hint` matches
`getApiBaseUrl()` shows 'Connected' disabled. (jsdom: `getApiBaseUrl()` returns VITE default
`https://gmatch.fly.dev` — mock `import.meta.env.VITE_API_URL` via vi.stubEnv if needed, or drive
`isCurrent` off a prop with a default; keep the helper exported for unit test:
`export function isCurrentServerUrl(base: string, hint: string): boolean` in
`apps/desktop/src/utils/serverUrl.ts` (where `normalizeServerUrl` already lives) and test it there
directly — one small pure fn, one test, no DOM gymnastics.)

Commit: `git commit -am "feat(servers-ui): switch between servers (own host + directory rows)"`

## Task 10 — Full sweep + release hygiene

```
cd I:/goongrid && npm run test --workspaces --if-present
```
Expected: all workspaces green (api, desktop, protocol, crypto). Pre-existing failures on
unrelated suites: note them, do not "fix" them here.

```
cd I:/goongrid/apps/desktop && npx tsc --noEmit && npx eslint src/components/servers src/hooks/useServerHeartbeat.ts
cd I:/goongrid/apps/api && npx tsc --noEmit && npx eslint src/routes/servers.ts
```
Expected: zero new errors.

Manual smoke (dev): `npm run dev` (desktop) → create flow with fake gmatch bridge is covered by
tests; packaged sanity is out of scope for this plan.

Final commit if sweep touched anything.

## Risks / tradeoffs / open questions

- The `gmatch://node/` handle base64-encodes the address — it is obfuscation, not encryption
  (already documented as such in `nodeMask.ts` header; "never show the IP" is a UI/transport-hint
  guarantee, unchanged by this plan). Flag to user if they expected real hiding (would need relay
  or onion — way out of ponytail scope).
- Renaming a server via the directory `PATCH /:id` changes display name only; `id` is
  `sha256(pub|originalName)` so rows keep their id — existing behavior, untouched.
- `is_private` rows still answered anonymous `GET /api/servers/<hint>` joins? No — joins go
  directly to the node, hub-independent (ADR-002), so privacy is real: unlisted = undiscoverable.
- Heartbeat stores `private` inside `REG_KEY` (plaintext localStorage, same as today's
  name/description) — consistent with current threat model; the join PASSWORD already rides the
  DPAPI secure KV and stays there.
- If `createMockEnv` doesn't auto-apply `migrations/*.sql` (check in Task 1), wire 051 the same way
  050 was wired (search `050_server_owner_name` in `apps/api/src/`).
- Open question: should `DELETE` also tear down the local node DB? Deliberately NO (destructive,
  out of scope) — the plan only un-sticks the directory/claim cycle.
