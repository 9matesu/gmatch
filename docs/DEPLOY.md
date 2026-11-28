# Deploy notes (security-relevant ops)

## Hosts (updated 2026-11-27) — no hosted data node; blind rendezvous Worker only

| Host | State | Action |
|---|---|---|
| `https://gmatch.pages.dev` | **live**: static release page + legal pages + `release.json`. No function, no D1, no mailbox, no directory. | deploy with `node site/deploy-pages.mjs` |
| `https://gmatch-rendezvous.mcos-mateus.workers.dev` | **live, DEFAULT**: blind rendezvous — sealed mail (`/api/mail/:token`) + public server directory (`/api/servers`). ONE SQLite Durable Object, no KV; no world rows. | deploy with `npx wrangler deploy --config worker/wrangler.toml` |
| a self-hosted full node | optional, run by whoever hosts a world | `npm run dist` on that machine, or `docker build` + the image |

The end state is direct peer-to-peer (SPEC §12b): no third-party host stores
posts, media, comments, likes or profiles. Every install runs its own node —
the world, plus the directory and sealed-mail relay for its clients — AND the
blind Worker above is the default meeting point when no peer's node is
reachable. It holds only sealed ciphertext and self-declared directory
metadata in one SQLite-backed Durable Object (no KV). A peer on another node
is reached through the address its signed beacon carries; the Worker buys
reachability, never a direct WebRTC channel or a copy of the world.

**The release feed is the last host-dependent piece.** `release.json` lives on
the Pages origin; the updater also asks the node this install talks to when
that node serves a manifest. If neither answers, the updater says "no host
answered" rather than pretend the app is current.

## Cloudflare Pages (static page only)

The project is a **classic Pages project** named `gmatch` (`gmatch.pages.dev`),
because a Worker project would expose `<name>.<account>.workers.dev`. Deploy is
manual and local:

```sh
npx wrangler login                  # once
node site/deploy-pages.mjs          # production (branch main)
node site/deploy-pages.mjs --preview  # preview alias only
```

`site/deploy-pages.mjs` stages `index.html`, `release.json`, `img/`, `legal/`
inside the repo (`.pages-stage`, gitignored, removed after), writes a
`wrangler.toml` with no bindings, and calls `wrangler pages deploy`.

The hosted courier that used to live here (`site/functions/api/[[path]].ts` +
the `gmatch-courier` D1 database) was **removed in gmatch 2.0**: the D1 was
emptied and then deleted, and the function is gone. `/api/*` on this origin now
returns the static page (the Pages fallback), never courier JSON — a client
that still points here gets HTML and fails loudly instead of talking to a stale
rendezvous. The shared rendezvous is now ON by default at the Worker in the
table above; set `gmatch.central.url` (or `VITE_CENTRAL_URL`) to a hub you run
instead, or `none`/`off`/`0` to switch it off.

## Self-hosted node (optional)

A full node is the normal Bun API (`apps/api`): `bun run src/serve.ts`, SQLite
snapshot, blob dir. The `Dockerfile` builds it; run it wherever you host.

- Secrets live in the environment (or `apps/api/.env.local`); never in the repo.
- Admin suite: `ADMIN_PIN_HASH` (`scrypt$<salt-hex>$<digest-hex>` — preferred —
  or legacy sha256 hex) + `ADMIN_ORBIT_ID` (the one orbitId allowed to unlock).
  The packaged install writes its first identity to `admin-owner.json` and
  passes it as `ADMIN_OWNER_FILE`, read live by `/verify-pin`. Without either
  binding the PIN alone grants admin (self-host model).
- A node can also run as a pure relay with `SITE_SERVICES=mail` — it then
  serves the directory and mail and 404s content routes.

## API_SEALED_ONLY flip (wave 2 B2)

`API_SEALED_ONLY=1` now rejects plaintext GETs too. Flip ONLY after the
desktop release that seals GET headers is the minimum supported client —
old clients break otherwise. Rollback: unset the secret (signed-plaintext
legacy path stays implemented). This applies to full nodes.

## Dev sidecar

`ADMIN_PIN=<pin> [ADMIN_ORBIT_ID=<orbitId>] npm run dev` in apps/desktop
(vite spawns the bun sidecar with the env). Never commit PIN values.

Or put `ADMIN_PIN_HASH=scrypt$...` in `apps/api/.env.local` (gitignored). Bun
loads that file from the sidecar's cwd, so it applies to `npm run dev`. The
plaintext is never written there.

In a PACKAGED install there is no repo and no `.env.local`, so
`electron/admin-pin.cjs` persists only a salted scrypt hash to
`userData/admin-pin.hash` and `apiSidecar.cjs` injects it as `ADMIN_PIN_HASH`.
The first identity this install loads is recorded as the node owner; the Admin
button and `/verify-pin` both check it. Settings → Account & Security shows a
read-only node-admin status badge instead of the passcode.

Reading the failure: the admin console now names the node and the reason.
`401` wrong PIN (or the identity is not `ADMIN_ORBIT_ID` — that gate runs
*before* the PIN compare, so a correct PIN from the wrong account also 401s);
`403` admin grant expired; `404` the node does not run the admin service
(`SITE_SERVICES` without `admin`); `429` 5-strikes/15-minutes lockout; `503`
no `ADMIN_PIN`/`ADMIN_PIN_HASH` set, so nothing to compare against.

Dev is **local-only** (`scripts/dev.cjs` + `vite.config.ts`): there is no
`GMATCH_DEV_API=remote`. Port 5173 is strict because localStorage, IndexedDB
and the identity are origin-bound.

**A relay node is a directory/mail relay, never a data base.** A node in
`SITE_SERVICES=mail` mode 404s every stateful route, so no client may persist
it as `gmatch.api.url` — older builds did, which is why
`purgeCourierApiState()` (`apps/desktop/src/utils/api.ts`) clears that state on
boot, and why `central.ts` drops a pointer to the retired hosted courier
instead of dialing it. e2e `api-network.spec.ts` fails if the dev `/api` ever
points back at a blind relay.
