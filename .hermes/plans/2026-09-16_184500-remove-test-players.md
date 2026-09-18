# Remove Test Players Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Delete every dev/test player and dev artifact so lists, contacts, followers, and suggestions show only real players.

**Architecture:** No new code. Reuse existing `deleteUserCascade` per-user delete path plus admin Bots endpoints, then clear client-side caches. Bulk-delete endpoint skipped (YAGNI — one-time cleanup).

**Tech Stack:** TypeScript, SQLite/Turso (D1Turso), vitest, existing admin panel.

---

## Current context / assumptions

- Users live in `Users` table; no seed script creates them (`apps/api/src/migrate.ts` seeds only `SystemMeta` economy keys). Test players = rows created manually during dev, identifiable by name/pattern (see Open Q1).
- Existing hard-delete path: `deleteUserCascade(db, userId)` in `apps/api/src/routes/users.ts:730`, exposed as `POST /api/admin/users/:id/delete` in `apps/api/src/routes/admin.ts:1758`, clickable per-row in `apps/desktop/src/admin/components/tabs/UsersTab.tsx:203` ("delete" action).
- Bot duelists live in `Bots` table (`apps/api/migrations/038_bots.sql`), managed via `/api/admin/bots` (`apps/api/src/bot-image-api.ts`: `getBotProfiles`, `deleteBotProfile`). `bot_names` SystemMeta key is fallback pool for fresh DBs.
- Frontend lists render live server data, no hardcoded fakes found: `suggestFollows.ts` (real `users`), `ChatPlayerList.tsx` + `mergeRoster` (`apps/desktop/src/utils/peerRoster.ts`), server directory `mergeDirectory` (`apps/desktop/src/components/servers/directoryMerge.ts`) with localStorage cache that can retain dev entries after server wipe.
- API `*.test.ts` files and `apps/api/src/test-utils.ts` use in-memory DBs only — never touch prod data, leave them alone.

---

### Task 1: Back up the production database file

**Objective:** Snapshot DB before any delete.

**Files:** none (ops only).

**Step 1: Locate the DB file**

Run: `ls -la I:/goongrid/apps/api/.data 2>/dev/null; ls -la I:/goongrid/.data 2>/dev/null; grep -rn "sqlite\|turso\|libsql\|DATABASE_URL\|db.sqlite" I:/goongrid/apps/api/src/db.ts | head -20`
Expected: path to the live `.sqlite`/`.db` file (or `TURSO_*` env vars if remote).

**Step 2: Copy it**

Run: `cp <live-db-path> <live-db-path>.bak-2026-09-16 && ls -la <live-db-path>.bak-2026-09-16`
Expected: backup file listed, size ≈ original.

**Step 3: Commit nothing (backup is untracked).**

---

### Task 2: Inventory all Users rows

**Objective:** Full list of candidate rows to classify.

**Files:**
- Read: `apps/api/src/routes/admin.ts:1470-1530` (GET `/api/admin/users` shape)

**Step 1: Query the live DB directly (read-only)**

Run: `sqlite3 <live-db-path> "SELECT id, display_name, substr(public_key,1,12), last_seen FROM Users ORDER BY last_seen;"`
Expected: one row per player. If `sqlite3` CLI missing, use: `node -e "const {createClient}=require('@libsql/client');(async()=>{const db=createClient({url:'file:<live-db-path>'});const r=await db.execute('SELECT id, display_name, last_seen FROM Users');console.log(JSON.stringify(r.rows,null,1))})()"` run from `I:/goongrid/apps/api`.

**Step 2: Save the inventory to a temp file (not in repo):** `/tmp/users-inventory-2026-09-16.json`.

**Step 3: Commit nothing.**

---

### Task 3: Classify test vs real, get sign-off

**Objective:** Explicit delete-list; no guessing at delete time.

**Files:** none (decision only).

**Step 1: Mark every row from Task 2 as KEEP or DELETE.** Suggested test signals (confirm with owner): `display_name` matching `test|demo|fake|bot|dev|asdf|xxx`, duplicate `public_key` prefixes, `last_seen` clustered in dev sessions, zero posts/matches AND never-online.

**Step 2: Write delete-list to `/tmp/users-delete-2026-09-16.txt` (one orbit-id per line).**

**Step 3: Owner confirms the list in chat before any delete proceeds.** Do not continue to Task 4 without this.

---

### Task 4: Delete each test user via the existing cascade

**Objective:** Full purge of each test account (content + follows + account row).

**Files:**
- Read: `apps/api/src/routes/users.ts:725-795` (`deleteUserCascade`, `wipeUserContent`)

**Step 1 (no new test — reuse path):** Preferred: Admin UI → Users tab → per-row `delete` action (`apps/desktop/src/admin/components/tabs/UsersTab.tsx:203`), one row per id in the delete-list. Alternative (same function, scripted): loop the ids through `POST /api/admin/users/:id/delete` with signed admin headers (see `apps/api/src/test-utils.ts:28` `signRequestHeaders` for header construction).

**Step 2: Verify per id**

Run: `sqlite3 <live-db-path> "SELECT COUNT(*) FROM Users WHERE id='<deleted-id>'; SELECT COUNT(*) FROM Followers WHERE follower_id='<deleted-id>' OR followee_id='<deleted-id>';"`
Expected: `0` / `0` for each deleted id.

**Step 3: Commit nothing (data-only change).**

---

### Task 5: Remove dev bot profiles and bot-name pool entries

**Objective:** Bots table and `bot_names` fallback contain only intended bots (or none).

**Files:**
- Read: `apps/api/src/bot-image-api.ts` (`getBotProfiles`, `deleteBotProfile`); `apps/api/migrations/038_bots.sql`

**Step 1: List**

Run: `sqlite3 <live-db-path> "SELECT id, name, enabled FROM Bots; SELECT key, value FROM SystemMeta WHERE key LIKE 'bot_%';"`
Expected: rows showing dev bots / `bot_names` value.

**Step 2: Delete dev bot profiles** via Admin UI bots section, or: `sqlite3 <live-db-path> "DELETE FROM Bots WHERE id IN ('<bot-id-1>','<bot-id-2>');"`
Expected: `SELECT COUNT(*) FROM Bots WHERE id IN (...)` → `0`.

**Step 3: If `bot_names` contains dev names, reset via admin bot-config save (empty or real-only list).** Do not hand-edit other `SystemMeta` keys.

---

### Task 6: Clear client-side caches holding dev entries

**Objective:** Directory/peer caches on dev machines stop resurrecting deleted players.

**Files:**
- Read: `apps/desktop/src/components/servers/directoryMerge.ts` (read/writeDirectoryCache + cache key), `apps/desktop/src/utils/peerRoster.ts:27-40` (`mergeRoster`)

**Step 1: In each dev client (DevTools console or fresh profile):** `localStorage.removeItem` for the directory-cache key defined in `directoryMerge.ts`, plus any `peerRoster`/peer-map keys; then reload. No repo edit — cache repopulates from the now-clean server on next fetch.

**Step 2: Verify:** server directory (ServersView right column), ChatPlayerList, and empty-feed follow suggestions show only KEEP ids.

---

### Task 7: Verify gates green, no code changed

**Objective:** Prove nothing broke; working tree clean except plan.

**Step 1: Run**

Run: `cd I:/goongrid && npm run typecheck && npm run test --workspaces --if-present`
Expected: typecheck 0 errors; API 867 passed, desktop 935 passed (counts from 2026-09-16 baseline; equal-or-higher pass with 0 failures is acceptance).

**Step 2: Run** `cd I:/goongrid && git status --short`
Expected: no modified/deleted source files (plan file only).

---

## Tests / validation

No new code → no new tests (YAGNI). Per-task verification is the SQL `COUNT(*)=0` checks (Tasks 4–5), UI spot-checks (Task 6), and full gates (Task 7). TDD cycle not applicable; the reused `deleteUserCascade` path is already covered by existing suites (`apps/api/src/routes/*`, `apps/desktop/src/admin/*`).

## Risks, tradeoffs, and open questions

- Q1 (BLOCKING Task 4): What marks a row as "test"? No `is_test` column exists; classification is name/behavior heuristic + owner sign-off (Task 3). Wrong KEEP/DELETE call is irreversible past backup.
- Q2: Remote vs local DB? Plan assumes file DB at path found in Task 1. If `TURSO_*`/remote, replace `sqlite3` with the same SQL via the remote client and snapshot via provider backup instead of `cp`.
- Tradeoff: per-row delete via existing cascade is slower than one `DELETE FROM` but keeps referential cleanup (`wipeUserContent`, wallet/counter recompute) — raw SQL user delete would orphan rows. Kept deliberately.
- Skipped: new bulk-delete admin endpoint, `is_test` flag column, automated name-pattern purge. Add only if this cleanup recurs.
