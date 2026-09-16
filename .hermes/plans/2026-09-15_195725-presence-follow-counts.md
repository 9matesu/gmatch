# Fix: ghost "online" players in chat tab + imprecise follower/following counts

Goal: make `Users.last_seen` (the single presence truth) reflect real interactive
activity only, and make profile follow counters always derived from the Followers
table so counts and the modal list can never disagree.

## Current context (traced, verified in code)

Presence chain (chat tab = `apps/desktop/src/components/chat/ChatPlayerList.tsx`):
- Server truth: `Users.last_seen`. "online" = seen within 60s
  (`apps/api/src/routes/servers.ts:242` dashboard query; same window in
  `routes/users.ts` GET / mapping, ~line 243).
- The chat list polls `/api/servers/dashboard` every 30s + gets the `users` prop
  from `loadUsers()` (`App.tsx:2166` → GET `/api/users`, polls every 60–120s).
- Desktop heartbeats `POST /api/users/heartbeat` every 30s, **skipped while the
  window is hidden** (`App.tsx:2823-2826`) — good.

Why ghosts show "Active now" (two root causes):
1. `apps/api/src/middleware/auth.ts:164` — every signed API request runs
   `INSERT INTO Users ... ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`.
   So any background traffic from a minimized/tray Electron app or a forgotten
   open tab (mail sync, WS-reconnect storms, feed polls) pins that user "online"
   forever, even though heartbeats are gated on visibility. Presence must mean
   *interactive* activity (heartbeat / lobby), not "some HTTP request happened".
2. `apps/api/src/serve.ts:342-347` — WS close marks the user offline
   (`last_seen = datetime('now','-10 minutes')`) ONLY inside
   `if (conn.userId && conn.rooms.has('lobby'))`. Users authenticated on the
   socket who never joined 'lobby' (watch-party-only, chat-only) leave a ghost
   that only decays after heartbeat stops (~30-60s, and forever if cause 1 pins it).

Follow counts (modal shows fewer users than the counter claims):
- The lists (`GET /api/users/:id/followers|following`, `routes/users.ts:667/690`)
  and the GET /api/users + GET /api/users/:id + GET /me counts are all COUNTs
  derived from the `Followers` table (fixed in an earlier wave — see the tests in
  `routes/users-follow-counts.test.ts`).
- BUT `PATCH /api/users/profile` (`routes/users.ts:599`) still returns the raw
  denormalized `Users.followers_count/following_count` columns, which drift
  (cascade deletes + admin manual edits via `routes/admin.ts:1653`). The desktop
  seeds its own profile (`myUser.followers_count`) from that response, and
  `GMatchProfile.tsx:201-202` renders `myUser?.followers_count` → stale count vs
  fresh server list. That is the "more users than in the modal" symptom.

Out of scope (say so, do NOT build): server-directory `online_count` is
self-reported by each server operator (`routes/servers.ts:137`); presence
replication across nodes is ADR-002 research territory. Bots are already
excluded from totals.

## Architecture / proposed approach

Three minimal deletions-of-drift, no new abstractions: (1) auth middleware stops
touching `last_seen` on existing rows (auto-registration INSERT still works);
(2) WS close marks offline for ANY authed conn with no other live conn for the
same user, not only lobby members; (3) PATCH profile returns derived counts like
every other endpoint. The existing decay windows client-side (90s seen-fresh,
60s server) already handle the rest.

Working dir for all commands: `I:\goongrid\apps\api` (bun + vitest repo).
Run gates from the repo root where stated. Commit only the named paths
(shared tree may have other agents' work — never `git add -A`).

---

## Task 1 — PATCH /profile returns derived follow counts (TDD)

1a. Failing test. Append a new `describe` inside
`apps/api/src/routes/users-follow-counts.test.ts` (reuse its `build`? No — it
has none; write a self-contained block using the existing imports + helpers):

```ts
describe('PATCH /profile response is derived too (ghost-count fix)', () => {
  it('returns table counts, not the stale denormalized columns', async () => {
    const env = await createMockEnv()
    const me = createTestIdentity()
    const other = createTestIdentity()
    await env.DB.prepare(
      `INSERT INTO Users (id, public_key, display_name, followers_count, following_count, last_seen)
       VALUES (?, ?, 'Me', 42, 42, datetime('now'))`)
      .bind(me.orbitId, me.publicKeyHex).run()
    await env.DB.prepare(`INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, datetime('now'))`)
      .bind(other.orbitId, other.publicKeyHex).run()
    await env.DB.prepare('INSERT INTO Followers (follower_id, followee_id, accepted) VALUES (?, ?, 1)')
      .bind(other.orbitId, me.orbitId).run()
    const res = await app.fetch(new Request('http://localhost/api/users/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(me, 'PATCH', '/api/users/profile', JSON.stringify({ bio: 'hi' })) },
    }), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.followers_count).toBe(1)
    expect(body.following_count).toBe(0)
  })
})
```

1b. `npx vitest run src/routes/users-follow-counts.test.ts`
Expected: FAIL — new test gets 42/42 (`expected 42 to be 1`). 4 old pass.

1c. Implement. In `apps/api/src/routes/users.ts` replace the saved-row query at
~line 599:

```ts
  const saved = await c.env.DB.prepare(
    `SELECT id, display_name, tags, pfp_url, bio, website, posts_count, is_private,
            (SELECT COUNT(*) FROM Followers f WHERE f.followee_id = Users.id AND f.accepted = 1) as followers_count,
            (SELECT COUNT(*) FROM Followers f WHERE f.follower_id = Users.id AND f.accepted = 1) as following_count
     FROM Users WHERE id = ?`
  ).bind(orbitId).first<any>()
```

(Only the SELECT changes; the response mapping below it already reads
`saved?.followers_count`.) Leave `bumpFollowCounts` alone — the columns are now
write-only (admin manual edits + cheap bookkeeping), nothing user-facing reads them.

1d. `npx vitest run src/routes/users-follow-counts.test.ts` → 5 passed.
Also `npx vitest run src/routes/users-profile-skew.test.ts` → all pass (PATCH
contract unchanged otherwise).

1e. Commit (from `I:\goongrid`):
`git add apps/api/src/routes/users.ts apps/api/src/routes/users-follow-counts.test.ts && git commit -m "fix(users): PATCH /profile returns table-derived follow counts (ghost counter fix)"`

---

## Task 2 — Auth middleware stops refreshing presence on every request (TDD)

2a. Failing test. Append to `apps/api/src/middleware/auth-middleware.test.ts`
(match its existing style — it already imports app/identities; the key additions):

```ts
it('does NOT refresh last_seen on existing users (presence = interactive activity only)', async () => {
  const env = await createMockEnv()
  const id = createTestIdentity()
  const old = new Date(Date.now() - 30 * 60 * 1000).toISOString()  // 30 min ago
  await env.DB.prepare('INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, ?)')
    .bind(id.orbitId, id.publicKeyHex, old).run()
  const res = await app.fetch(new Request('http://localhost/api/users', {
    headers: signRequestHeaders(id, 'GET', '/api/users'),
  }), env)
  expect(res.status).toBe(200)
  const row = await env.DB.prepare('SELECT last_seen FROM Users WHERE id = ?')
    .bind(id.orbitId).first<{ last_seen: string }>()
  // unchanged (still ~30 min old), NOT stamped now
  expect(new Date(row!.last_seen).getTime()).toBeLessThan(Date.now() - 25 * 60 * 1000)
})

it('still auto-registers unknown users with a fresh last_seen', async () => {
  const env = await createMockEnv()
  const id = createTestIdentity()
  const res = await app.fetch(new Request('http://localhost/api/users', {
    headers: signRequestHeaders(id, 'GET', '/api/users'),
  }), env)
  expect(res.status).toBe(200)
  const row = await env.DB.prepare('SELECT last_seen FROM Users WHERE id = ?')
    .bind(id.orbitId).first<{ last_seen: string }>()
  expect(row).toBeTruthy()
  expect(Date.now() - new Date(row!.last_seen).getTime()).toBeLessThan(60_000)
})
```

Adapt `app`/`createMockEnv`/`signRequestHeaders` imports to whatever
auth-middleware.test.ts already uses (it exists and tests this middleware).

2b. `npx vitest run src/middleware/auth-middleware.test.ts` → new first test FAILS
(last_seen bumped to now).

2c. Implement. `apps/api/src/middleware/auth.ts:164` — one word:

```ts
    await c.env.DB.prepare('INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(orbitId, publicKeyHex, nowIso).run()
```

(`DO UPDATE SET last_seen = excluded.last_seen` → `DO NOTHING`.)

2d. Same command → all pass. Then regression sweep of anything relying on
request-time presence (these endpoints touch last_seen themselves, verified by
grep, they stay): heartbeat route (`routes/users.ts:323`), lobby snapshots +
join/autoQueue (`lobby.ts:126,155,1498`), profile PATCH (`routes/users.ts:581`),
WS-close mark-offline. Run: `npx vitest run src/routes/users.test.ts src/routes/users-online.test.ts src/lobby.test.ts` (whatever of these exist)
→ pass. If a test asserts the old bump behavior, update THAT test to the new
contract (presence only via heartbeat/lobby), not the code.

2e. Commit: `git add apps/api/src/middleware/auth.ts apps/api/src/middleware/auth-middleware.test.ts && git commit -m "fix(presence): auth middleware no longer pins users online on every signed request; presence = heartbeat/lobby activity only"`

---

## Task 3 — WS close marks offline for ANY authed conn (not just lobby members)

3a. Implement in `apps/api/src/serve.ts` close handler (lines ~336-352). Replace
the lobby-only block with: mark offline whenever the closing conn had a userId
and no other live conn shares it (ponytail: linear scan over the in-memory
conns set — fine at this scale), and keep the lobby-leave + refresh broadcast:

```ts
      if (conn) {
        const wasLobbyMember = conn.userId && conn.rooms.has('lobby')
        if (wasLobbyMember) {
          leaveLobby(db, conn.userId!).catch((err) =>
            console.warn('[WS] lobby leave on disconnect failed:', err?.message || err)
          )
        }
        // Mark offline immediately so the roster drops the ghost on the next
        // poll — but only if no other live socket still serves this user.
        if (conn.userId) {
          const stillConnected = [...conns].some((o) => o !== conn && o.userId === conn.userId)
          if (!stillConnected) {
            db.prepare("UPDATE Users SET last_seen = datetime('now','-10 minutes') WHERE id = ?")
              .bind(conn.userId)
              .run()
              .then(() => {
                if (wasLobbyMember) broadcastToRoom('lobby', { type: 'lobby', action: 'refresh' })
              })
              .catch((err) => console.warn('[WS] mark offline on disconnect failed:', err?.message || err))
          }
        }
        conns.delete(conn)
        watchDisconnect(conn)
        wsToConn.delete(ws)
      }
```

Note `conns.delete(conn)` MUST stay after the scan (order above is correct:
scan happens while conn is still in the set; the `o !== conn` guard handles it).

3b. Verification — serve.ts is bootstrap code with no unit-test harness (risk
noted below); do a live check instead. From `I:\goongrid\apps\api`:
`bun src/serve.ts &` then:
```
curl -s "http://localhost:8080/api/health"            # expect {"ok":true...} 200
```
Kill the server. Manual e2e (optional, if two test accounts exist in the dev DB):
login desktop A + B, close B's window, within ~5s A's chat list shows B offline
(was: B lingered until heartbeat decay). If you can't run e2e, state that in the
commit body — do not claim it verified.

3c. `cd I:\goongrid\apps\api && npx tsc -p tsconfig.json --noEmit` → no errors.

3d. Commit: `git add apps/api/src/serve.ts && git commit -m "fix(presence): WS close marks any authed user offline (watch/chat-only sockets included), multi-conn guarded"`

---

## Task 4 — Client decay windows: no change (verify only)

`ChatPlayerList.tsx` already decays: server 60s window + 90s client seen-fresh
grace + snapshot flag budgets. `App.tsx loadUsers` (line ~2180) admits swarm-only
peers only <90s. With server truth fixed by Tasks 1-3 these are correct. The one
remaining local reviver is acceptable (≤90s). No edits.

## Task 5 — Gates + docs

5a. `cd I:\goongrid\apps\api && npx vitest run` → all green (record count).
5b. `cd I:\goongrid\apps\desktop && npx vitest run src/components/chat` → green
(presence tests keep their behavior; they mock the server shape, unaffected).
5c. Append a bullet to `docs/AUDIT-2026-09-15.md` "Watch-out (accepted,
documented)" section — or a short new "## Presence wave (2026-09-15)" section
recording the presence contract: last_seen is written ONLY by heartbeat,
lobby routes, profile PATCH, WS auth ticket redeem, first-register INSERT, and
WS-close (negative mark). Commit:
`git add docs/AUDIT-2026-09-15.md && git commit -m "docs(presence): record last_seen write contract"`

## Risks, tradeoffs, open questions

- Removing the auth-middleware presence touch means any client that makes signed
  requests but NEVER heartbeats looks offline after 60s. Both desktop and web
  build from the same `App.tsx` heartbeat loop (`apps/desktop/src/App.tsx:2823`),
  so shipping the API change with the current client is safe; ancient cached
  web bundles would go dark for their own roster display (self-injected online
  locally at `App.tsx:2190`) but vanish for others. Accept.
- `serve.ts` has no unit tests (bun.serve bootstrap). Task 3 is verified by
  tsc + optional manual e2e; that's honest, label the commit accordingly.
- Multi-device same account: presence now only survives on a device that
  heartbeats (visible window). A phone tab backgrounded shows offline — this is
  the correct semantics the user asked for ("status must match reality").
- The `-10 minutes` offline mark makes "Seen 10m ago" slightly wrong for the
  clean-close case; pre-existing behavior, keep (one-line tweak later if it
  bothers anyone).
- `bumpFollowCounts` columns become pure write-only except admin's manual edit
  (`admin.ts:1653` sets the column, and admin's own dashboard reads it). If a
  future ticket wants admin edits to move real counts, that's a product call —
  YAGNI now.
