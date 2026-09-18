# gMatch: ditch RAM storage for compacted, encrypted local storage

## Goal

Move the gMatch API's durable state out of RAM (in-memory SQLite + inline base64 media) onto the existing /data volume as a file-backed SQLite DB + AES-256-GCM encrypted blob files, cutting RSS from >3 GB to a small constant.

## Current context / assumptions (all verified in-repo 2026-09-17)

- Repo: `I:/goongrid` (monorepo; API = `apps/api`, package `@orbit/api`, runtime Bun, tests vitest, lint eslint 0-error gate). Deploy: fly.io app `gmatch`, volume `gmatch_data` mounted at `/data` (`fly.toml`), `SNAPSHOT_PATH=/data/orbit.sqlite` (`Dockerfile`), `kill_timeout=75s`.
- `apps/api/src/serve.ts:21` opens `createClient({ url: ':memory:' })` — the ENTIRE database lives in RAM. Every 30 s `takeSnapshot()` runs `VACUUM INTO` (a full second copy in RAM/disk), and boot does `restoreDb()` back into RAM. This is the RAM hog, and the snapshot cycle temporarily ~2x's it.
- `Objects.content_url` routinely stores full `data:` base64 images INLINE in rows (see `routes/objects.ts:130,239,325`, `routes/users.ts:33,90`, `lobby.ts:121`, `rooms.ts:86`). Base64 is 1.37x raw size, all resident in RAM forever.
- A file blob store ALREADY exists and ALREADY encrypts: `apps/api/src/blob.ts` (`LocalBlobStore`, dir = `BLOB_STORE_DIR`, defaults to `<snapshot dir>/blobs`) and `apps/api/src/crypto.ts` (`encryptBlob`/`decryptBlob`, AES-256-GCM with `STORAGE_ENCRYPTION_KEY`; key resolved by `storage-key.ts` from env or `storage.key` next to the DB). `proxy.ts:330` and `lobby.ts:1652` already `bucket.put('objects/<id>', encryptBlob(bytes), ...)`.
- Read path already understands bucket keys: `routes/lobby.ts:505` treats `content_url` as a bucket key when it doesn't start with `http`/`data:` and `c.env.BUCKET` exists. `Objects` rows with bucket-key `content_url` are the established convention.
- Sensitive TEXT columns already support at-rest column encryption (`encryptText`/`decryptText` in `crypto.ts`); `decryptText` passes legacy plaintext through, so mixed data is safe.
- libsql has NO SQLCipher-style whole-file encryption. "Cryptographed" is satisfied by: encrypted blob files (AES-256-GCM), encrypted sensitive columns, and the DB file holding no plaintext media after the data-URL migration. Whole-disk encryption is a non-goal (see Risks).

## Architecture / proposed approach

One change with three parts: (1) open the SAME libsql engine against `file:/data/orbit.sqlite` instead of `:memory:` — the existing snapshot file is already a valid SQLite DB, so it becomes the live database with zero migration; delete the snapshot/restore cycle entirely. (2) One-shot CLI that lifts every inline `data:` URL out of `Objects.content_url` into the already-encrypted blob store, replacing the column with the bucket key `objects/<id>`. (3) Stream blob reads instead of `readFile`-ing whole files, and set WAL + auto_vacuum for compaction.

## Step-by-step tasks

Work on a branch: `git -C I:/goongrid checkout -b ram-to-disk`. Run all commands from `I:/goongrid`. Gates after every task:
`npm run lint -w @orbit/api` → 0 errors; `npm run typecheck -w @orbit/api` → clean; `npm run test -w @orbit/api` → all green. Commit after each green task.

### Task 0 — Baseline + read-path reconnaissance (no code)

1. Record current prod RAM: `flyctl ssh console -a gmatch -C "cat /sys/fs/cgroup/memory.current"` (bytes; expect > 3e9). Write the number in the PR description.
2. Confirm how object content is served from the bucket — run:
   `grep -n "objects/" apps/api/src/routes/objects.ts | head -20`
   Expected: a GET route that does `c.env.BUCKET.get(...)` for keys shaped `objects/<id>` (same pattern as `routes/lobby.ts:1643`). If no such route exists, STOP and report — the migration target changes.

### Task 1 — File-backed DB in serve.ts (the RAM kill shot)

TDD: this is config plumbing verified by the existing suite + a boot smoke test, not new unit logic.

1. Edit `apps/api/src/serve.ts`:
   - Replace line 21 `const client = createClient({ url: ':memory:' })` with:
     ```ts
     const DB_PATH = process.env.SNAPSHOT_PATH || join(process.cwd(), 'orbit.sqlite')
     const client = createClient({ url: `file:${DB_PATH}` })
     ```
   - Directly after `await ensureSchema(client)` in `dbReadyPromise`, add compaction pragmas:
     ```ts
     await client.execute('PRAGMA journal_mode = WAL')
     await client.execute('PRAGMA auto_vacuum = FULL')
     ```
     (`auto_vacuum` only takes effect on fresh DBs; on the existing prod file add a one-time `await client.execute('VACUUM')` guarded by `if (!(await client.execute('PRAGMA auto_vacuum')).rows[0].auto_vacuum) { await client.execute('PRAGMA auto_vacuum = FULL'); await client.execute('VACUUM') }` — keep the guard version, it is correct for both cases.)
   - DELETE: the `restoreDb(client, SNAPSHOT_PATH)` call + its `restore summary` log block (keep the `access()` existence check + warning); `takeSnapshot`, `snapshotInFlight`, both `SNAPSHOT_INTERVAL_MS`/`SNAPSHOT_INITIAL_DELAY_MS` consts and their `setInterval`/`setTimeout`; the `persistAndExit` body's `takeSnapshot` call (keep `flushParties()` + exit); remove `snapshotDb`/`restoreDb` from the imports (line 3 → `import { } from './persistence'` becomes deleting the import entirely).
   - Keep everything else (blob store, parties flush, maintenance ticks) untouched.
2. Do NOT touch `persistence.ts` or its tests — they stay green as isolated units; note in the PR that they are now unused and can be deleted later (ponytail: deletion is a follow-up, not a risk in this diff).
3. Verify: gates above, then boot smoke test:
   `cd apps/api && rm -f smoke.sqlite* && DB_PATH=./smoke.sqlite timeout 15 bun run src/serve.ts; ls smoke.sqlite` → file exists.

### Task 2 — Streaming blob reads (perf)

TDD cycle in `apps/api/src/blob.test.ts` (new file):
```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBlobStore } from './blob'

describe('LocalBlobStore', () => {
  it('round-trips bytes and streams the body', async () => {
    const store = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blob-')))
    const data = new Uint8Array(1024 * 1024).map((_, i) => i & 0xff)
    await store.put('objects/x', data)
    const got = await store.get('objects/x')
    expect(got).not.toBeNull()
    const chunks: Uint8Array[] = []
    for await (const c of got!.body as any) chunks.push(c as Uint8Array)
    const joined = Buffer.concat(chunks)
    expect(Buffer.compare(joined, Buffer.from(data))).toBe(0)
  })
})
```
1. RED: run `npx vitest run src/blob.test.ts -w @orbit/api` (from `apps/api`) — fails only if `get()` semantics differ; current `readFile` impl actually passes, so the real change is: rewrite `get()` in `apps/api/src/blob.ts` to stream:
   ```ts
   import { createReadStream } from 'node:fs'
   import { stat } from 'node:fs/promises'
   import { Readable } from 'node:stream'
   // inside get():
   try { await stat(filePath) } catch { return null }
   return {
     body: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
     httpEtag: `orbit-blob-${key}`,
     writeHttpMetadata(headers: Headers) {
       headers.set('Content-Type', 'application/octet-stream')
     },
   }
   ```
   (Drop the `bodyUsed` latch and the in-memory `data` buffer; Content-Length comes from the stream/range handling already upstream — if a consumer asserts Content-Length from `writeHttpMetadata`, add `stat` size there.)
2. GREEN: same vitest command passes. Gates. Commit.

### Task 3 — One-shot migration: inline data: URLs → encrypted blobs

1. RED: add `apps/api/src/migrate-dataurls.test.ts`:
   - seed an in-memory libsql client via `ensureSchema`, INSERT one Objects row with `content_url = 'data:image/png;base64,' + Buffer.from('hello').toString('base64')` and one row with an http URL;
   - run `migrateDataUrls(db, bucket)` (new export, see below);
   - assert the first row's `content_url` is now `objects/<id>`, `bucket.get('objects/<id>')` decrypts (`decryptBlob`) back to `hello`, `mime_type`/`size_bytes` updated (size 5), and the http row is untouched.
   Run `npx vitest run src/migrate-dataurls.test.ts` from `apps/api` → fails (module missing).
2. GREEN: create `apps/api/src/migrate-dataurls.ts`:
   ```ts
   import type { D1Turso } from './db'
   import type { LocalBlobStore } from './blob'
   import { encryptBlob } from './crypto'

   // One-shot: move inline data: URLs out of Objects.content_url into the
   // encrypted blob store. Idempotent — rows already pointing at bucket keys
   // or http(s) URLs are skipped.
   export async function migrateDataUrls(db: D1Turso, bucket: LocalBlobStore): Promise<number> {
     const { rows } = await db.prepare(
       "SELECT id, content_url FROM Objects WHERE content_url LIKE 'data:%'"
     ).all<{ id: string; content_url: string }>()
     let moved = 0
     for (const r of rows) {
       const m = r.content_url.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
       if (!m) continue
       const bytes = m[2]
         ? Buffer.from(m[3], 'base64')
         : Buffer.from(decodeURIComponent(m[3]))
       await bucket.put(`objects/${r.id}`, encryptBlob(new Uint8Array(bytes)), { httpMetadata: { contentType: m[1] } })
       await db.prepare(
         'UPDATE Objects SET content_url = ?, mime_type = ?, size_bytes = ? WHERE id = ?'
       ).bind(`objects/${r.id}`, m[1], bytes.length, r.id).run()
       moved++
     }
     return moved
   }
   ```
   Then a thin CLI `apps/api/src/migrate-dataurls-cli.ts` (open `file:` client from `DATABASE_URL` env, `ensureSchema`, build `D1Turso` + `LocalBlobStore(process.env.BLOB_STORE_DIR)`, set `STORAGE_ENCRYPTION_KEY` via `resolveStorageKey`, call `migrateDataUrls`, print count, exit). Add script in `apps/api/package.json`: `"migrate:dataurls": "bun run src/migrate-dataurls-cli.ts"`.
3. Gates. Commit.
4. Wire nothing at boot — this is deliberately manual (runs once against prod data; idempotent if re-run).

### Task 4 — Run migration + deploy + verify

1. Local gates one last time: lint, typecheck, test (all `-w @orbit/api`).
2. `git push` the branch, open PR, squash to main (repo convention per skill: push + `flyctl deploy -a gmatch`).
3. BEFORE deploy finishes booting, run the data migration ONCE against the volume:
   `flyctl ssh console -a gmatch -C "cd /app && DATABASE_URL=file:/data/orbit.sqlite BLOB_STORE_DIR=/data/blobs bun run src/migrate-dataurls-cli.ts"`
   Expected stdout: `moved N` (N >= 0). If the app is holding the DB open, stop the machine first (`flyctl machine stop` / start after) — WAL allows concurrency but the one-shot is safer single-writer.
4. Verify (all must hold before calling it done):
   - `flyctl logs -a gmatch` shows clean boot, no `[DB]` errors.
   - `flyctl ssh console -a gmatch -C "cat /sys/fs/cgroup/memory.current"` → report the number; expect order-of-magnitude drop vs Task 0 baseline.
   - Smoke: `curl -s https://gmatch.fly.dev/` returns the site; open one feed image in the browser — images serve from the bucket path (Task 0 route).
   - Restart survival: `flyctl machine restart` (or redeploy) and confirm posts/profiles persist (file DB on the volume; no restore step anymore).

## Tests / validation summary

Per-task TDD as specified above; global gates after each commit:
`npm run lint -w @orbit/api` (0 errors), `npm run typecheck -w @orbit/api`, `npm run test -w @orbit/api`. Final acceptance = the four checks in Task 4 step 4, with before/after RAM numbers in the PR.

## Risks, tradeoffs, open questions

- Crash durability: file SQLite in WAL loses at most the last uncommitted transaction; strictly better than today (30 s snapshot window). No mitigation needed.
- `data:` URL migration rewrites `content_url` — any code path that pattern-matches `data:` on Objects rows (e.g. `routes/admin.ts:972`, `routes/lobby.ts:454,482`, `routes/users.ts:90`) simply takes the non-data branch afterwards; that branch already exists for bucket-key rows (lobby.ts:505). Task 0 step 2 is the gate that confirms the Objects read path does the same — if it doesn't, add the bucket-key branch there first.
- The DB FILE itself is not encrypted (libsql has no SQLCipher). Residual exposure after this change: non-sensitive metadata only (ids, timestamps, sizes); media is AES-256-GCM in the blob store, sensitive text has `encryptText`. If full-file DB encryption becomes a hard requirement, the options are SQLCipher (dependency swap) or OS-level volume encryption — say the word and it gets its own plan.
- `persistence.ts` becomes dead code; kept (with tests) in this diff to keep it boring. Delete in a follow-up.
- 32 leftover `test-blobs-*` dirs at repo root are test litter — do not ship them; add to `.gitignore` if not already.
- Open: none blocking. Deploy order (stop → migrate → start) is the only manual step; everything else is code.