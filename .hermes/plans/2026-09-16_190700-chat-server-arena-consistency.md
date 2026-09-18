# Chat Players / Server Counter / Arena Consistency Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Chat player list, server counters, and arena badge all derive online/active counts from one server-computed definition.

**Architecture:** Server becomes the single source of truth: `GET /api/servers/dashboard` returns explicit `online_count` (60s window) and `active_24h_count` alongside the userlist, computed with the same SQL predicates that select the list. Clients render those numbers verbatim instead of recomputing with divergent local windows. No new endpoints, no new polling.

**Tech Stack:** TypeScript, Hono API (`apps/api`), React (`apps/desktop`), vitest.

---

## Current context / assumptions

Root causes found by inspection (all verified in code):

1. `members_total` lies: `apps/api/src/routes/servers.ts:248-252` counts ALL non-admin `Users` ever (`id NOT LIKE 'bot_%'`), but `ServersView.tsx:205` maps it to `user_count` next to `online_count`, and `useServerHeartbeat.ts:52` pushes the same pair to the directory. Readers parse "X / Y" as online/active, but Y is all-time.
2. Three online definitions: dashboard SQL 60s (`servers.ts:242`), `GET /api/users` JS 60s (`routes/users.ts:241`), domination picker 10min (`routes/domination.ts:275`), lobby `STALE_PLAYER_MS` 2min (`lobby.ts:39`, feeds arena badge `App.tsx:1311-1315` = `waiting_count + liveMatches*2`).
3. `ChatPlayerList.tsx:78-194` merges two snapshots (dashboard 30s poll + `users` prop) with its own freshness math (`SEEN_FRESH_MS=60s`, flag budgets 150s/75s, lines 86-99) and recomputes `onlineCount` locally (line 194) — so its header can disagree with both the server counter and the arena badge even when data is identical.
4. Dashboard userlist is `LIMIT 100` (`servers.ts:246`) — any client-side count over the list silently caps at 100.

Assumption: 60s = canonical "online", 24h = canonical "active". Arena badge stays a lobby-presence number but must be labeled as such, not mixed with online counts.

---

### Task 1: Locate the ChatPlayerList caller and its users-prop source

**Objective:** Name the exact file/line feeding `users` into ChatPlayerList so later tasks edit the right call site.

**Files:**
- Read: `apps/desktop/src/components/chat/GMatchDMs.tsx` (renders ChatPlayerList per file search)
- Read: `apps/desktop/src/components/chat/ChatPlayerList.presence.test.tsx`, `ChatPlayerList.test.tsx` (mount patterns)

**Step 1:** Find the mount:

Run: `rg -n "ChatPlayerList" apps/desktop/src --glob '!*.test.*'`
Expected: mount line(s), e.g. `GMatchDMs.tsx:<N>` with the `users={...}` expression visible.

**Step 2:** Trace that expression to its fetch (likely `GET /api/users` poll in `App.tsx` or a hook). Record file + line + poll interval in the plan file as a comment. No code change.

**Step 3: Commit nothing.**

---

### Task 2: Dashboard returns server-computed counts (failing test)

**Objective:** `GET /api/servers/dashboard` returns `online_count` and `active_24h_count` computed by the same predicates that build the userlist.

**Files:**
- Modify: `apps/api/src/routes/servers.ts:239-270`
- Test: `apps/api/src/routes/servers.test.ts` (extend the `dashboard:` test at line 89)

**Step 1: Write failing test.** Append to the existing dashboard test (after line 102):

```ts
const counts = (await authed.json()) as { online_count: number; active_24h_count: number; members_total: number }
expect(typeof counts.online_count).toBe('number')
expect(typeof counts.active_24h_count).toBe('number')
// counts agree with the list served in the same response
expect(counts.online_count).toBe(body.users.filter((u) => u.online).length)
expect(counts.active_24h_count).toBe(body.users.length)
expect(counts.members_total).toBeGreaterThanOrEqual(counts.active_24h_count)
```

**Step 2: Run test to verify failure**

Run: `cd I:/goongrid/apps/api && npx vitest run src/routes/servers.test.ts -t dashboard`
Expected: FAIL — `online_count` undefined.

**Step 3: Minimal implementation.** In `servers.ts`, replace the `counts` query (lines 248-252) with:

```ts
const counts = await c.env.DB.prepare(
  `SELECT
     (SELECT COUNT(*) FROM Objects WHERE is_public = 1 AND created_at >= datetime('now', '-1 day')) as posts_24h,
     (SELECT COUNT(*) FROM Users WHERE (is_admin = 0 OR is_admin IS NULL) AND id NOT LIKE 'bot_%') as members_total,
     (SELECT COUNT(*) FROM Users WHERE (is_admin = 0 OR is_admin IS NULL) AND last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-60 seconds')) as online_count,
     (SELECT COUNT(*) FROM Users WHERE (is_admin = 0 OR is_admin IS NULL) AND last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-24 hours')) as active_24h_count`,
).first<{ posts_24h: number; members_total: number; online_count: number; active_24h_count: number }>()
```

and add to the JSON response (after line 268):

```ts
online_count: counts?.online_count ?? 0,
active_24h_count: counts?.active_24h_count ?? 0,
```

**Step 4: Run test to verify pass**

Run: `cd I:/goongrid/apps/api && npx vitest run src/routes/servers.test.ts -t dashboard`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/routes/servers.ts apps/api/src/routes/servers.test.ts
git commit -m "feat(api): dashboard returns server-computed online/active counts"
```

---

### Task 3: ServersView + heartbeat render server counts verbatim

**Objective:** Directory row and heartbeat stop recomputing online from the (capped) list.

**Files:**
- Modify: `apps/desktop/src/components/servers/ServersView.tsx:49-54` (`Dashboard` interface), `:205-206` (central row), wherever directory rows render `user_count`/`online_count`
- Modify: `apps/desktop/src/hooks/useServerHeartbeat.ts:48-55`

**Step 1: Extend the `Dashboard` interface:**

```ts
export interface Dashboard {
  name?: string
  users: DashboardUser[]
  posts_24h: number
  members_total: number
  online_count?: number
  active_24h_count?: number
}
```

**Step 2: Central row (line 205-206) — prefer server counts, fall back to list computation:**

```ts
user_count: dash?.active_24h_count ?? dash?.members_total ?? null,
online_count: dash?.online_count ?? (dash?.users ? dash.users.filter((u) => u.online).length : null),
```

**Step 3: `useServerHeartbeat.ts` lines 52-53 — same substitution:**

```ts
if (typeof dj?.active_24h_count === 'number') body.user_count = dj.active_24h_count
else if (typeof dj?.members_total === 'number') body.user_count = dj.members_total
if (typeof dj?.online_count === 'number') body.online_count = dj.online_count
else if (Array.isArray(dj?.users)) body.online_count = dj.users.filter((u: { online?: boolean }) => u?.online).length
```

**Step 4: Verify**

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/hooks/useServerHeartbeat.test.ts src/firstRun/serverSort.test.ts`
Expected: all PASS (mock at `useServerHeartbeat.test.ts:37` returns `{ users: [], posts_24h: 0, members_total: 3 }` — no `online_count`, so the fallback branch covers it; if the mock type errors on the new optional fields, no change needed since they are optional).

**Step 5: Commit**

```bash
git add apps/desktop/src/components/servers/ServersView.tsx apps/desktop/src/hooks/useServerHeartbeat.ts
git commit -m "fix(desktop): server counters use server-computed online/active counts"
```

---

### Task 4: ChatPlayerList header uses dashboard counts when fresh

**Objective:** Chat header `online / 24h` matches the server counter instead of local recompute.

**Files:**
- Modify: `apps/desktop/src/components/chat/ChatPlayerList.tsx:44-76` (add counts state + capture), `:194` (onlineCount), `:237-239` (24h render)
- Test: extend `apps/desktop/src/components/chat/ChatPlayerList.presence.test.tsx`

**Step 1: Write failing test.** Add to `ChatPlayerList.presence.test.tsx`:

```tsx
it('header shows server counts while the dashboard snapshot is fresh', async () => {
  // dashboard returns 2 online of 5 active; local merge would compute otherwise
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({
    users: [], online_count: 2, active_24h_count: 5,
  }) } as Response)
  render(<ChatPlayerList identity={null} users={[]} />)
  await screen.findByText('2', { selector: 'span' })
  // total shows server active count, not merged list length
})
```

Adjust selectors to the header markup (lines 231-240). Run to verify failure:

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/components/chat/ChatPlayerList.presence.test.tsx`
Expected: FAIL — header shows merged-list numbers.

**Step 2: Minimal implementation.** In `fetchDashboardUsers` (lines 55-68), capture counts:

```ts
const [dashboardCounts, setDashboardCounts] = useState<{ online: number; active: number } | null>(null);
// inside res.ok branch after setDashboardUsers:
if (typeof (data as { online_count?: unknown })?.online_count === 'number'
  && typeof (data as { active_24h_count?: unknown })?.active_24h_count === 'number') {
  setDashboardCounts({ online: data.online_count, active: data.active_24h_count })
} else {
  setDashboardCounts(null) // stale/older server: fall back to local compute
}
```

Header (lines 194, 231-240): when `dashboardCounts` is non-null AND `dashboardAge < DASHBOARD_FLAG_BUDGET_MS`, render `dashboardCounts.online` / `dashboardCounts.active`; else current local values. Keep the list itself merged as today (only the header numbers change).

**Step 3: Run to verify pass**

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/components/chat/ChatPlayerList.test.tsx src/components/chat/ChatPlayerList.presence.test.tsx`
Expected: all PASS.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/chat/ChatPlayerList.tsx apps/desktop/src/components/chat/ChatPlayerList.presence.test.tsx
git commit -m "fix(desktop): chat header renders server online/active counts when fresh"
```

---

### Task 5: Label the arena badge as lobby presence, not online

**Objective:** Arena badge stops reading as a third "online" number.

**Files:**
- Modify: `apps/desktop/src/App.tsx:1309-1315` + wherever `gamesOnlineCount` renders (badge/tooltip)

**Step 1: Rename + relabel (no logic change):**

```ts
// Lobby presence: players queued or in a match right now. NOT the same
// population as chat online (60s heartbeat) — labeled separately on purpose.
const lobbyPresenceCount = useMemo(() => {
  const waiting = lobby.state?.waiting_count ?? 0;
  const inMatch = (lobby.liveMatches?.length ?? 0) * 2;
  return waiting + inMatch;
}, [lobby.state?.waiting_count, lobby.liveMatches]);
```

Rename usages `gamesOnlineCount` → `lobbyPresenceCount`, and change the rendered label/tooltip to `In lobby` / `Players in queue or match` (find exact strings at the render site; keep styling identical).

**Step 2: Verify**

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/utils/lobby.test.ts`
Expected: PASS (rename is local to App.tsx; no test references the old name — confirm with `rg gamesOnlineCount apps/desktop/src` returning 0 hits after rename).

**Step 3: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "fix(desktop): arena badge labeled as lobby presence"
```

---

### Task 6: Full gates + consistency assertion

**Objective:** Prove all three surfaces agree and nothing regressed.

**Step 1: Run**

Run: `cd I:/goongrid && npm run typecheck && npm run test --workspaces --if-present`
Expected: typecheck 0 errors; API ≥867 passed, desktop ≥935 passed, 0 failures.

**Step 2: Manual consistency check (two clients, 2 minutes):** sign in on client A, observe client B chat header `1 online`, ServersView central row `online_count 1`, arena badge `0 in lobby` (not queued). Join queue on A → badge `1`, chat online still `1`. Leave → badge `0`.

**Step 3: Commit nothing (verification only).**

---

## Tests / validation

TDD per task (Tasks 2, 4 write failing test first; Tasks 3, 5 reuse existing suites as the gate). Full gates in Task 6. Baseline counts from 2026-09-16: API 867, desktop 935 — equal-or-higher with 0 failures is acceptance.

## Risks, tradeoffs, and open questions

- `LIMIT 100` userlist vs uncapped counts: header numbers (Task 4) can exceed visible rows when >100 active. Accepted — numbers are truthful, list is a preview. Full fix (paginated roster) skipped; add when >100 concurrent actives is real.
- `members_total` (all-time) kept in the response for compat (heartbeat fallback, admin views) but no longer displayed as a live counter. Removing it is a breaking change for older clients — kept deliberately.
- 60s vs lobby 2min vs domination 10min windows intentionally NOT unified: different features (presence vs matchmaking grace vs picker). Unity would cause false-offline in matches. Only the displayed numbers are unified, via server counts + honest labels.
- Q: does any other client (mobile/web) consume `members_total` as a live counter? `rg members_total` outside `apps/desktop` before closing — if yes, same verbatim-counts treatment applies.
- Skipped: new endpoint, new polling, unifying all windows into one constant. Add when a fourth consumer appears.
