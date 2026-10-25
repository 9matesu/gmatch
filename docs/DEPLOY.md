# Deploy notes (security-relevant ops)

## Hosts (2026-10-24) — one Cloudflare project, no hosted data node

| Host | State | Action |
|---|---|---|
| `https://gmatch.pages.dev` | **live**: release page + blind courier (directory + sealed mail) | deploy with `node site/deploy-pages.mjs` |
| a self-hosted full node | optional, run by whoever hosts a world | `npm run dist` on that machine, or `docker build` + the image |

The end state is direct peer-to-peer (SPEC §12b): no third-party host stores
posts, media, comments, likes or profiles. What stays central is a rendezvous
(directory + sealed mail). The Cloudflare Pages project is that rendezvous and
nothing else.

**The release feed is the last host-dependent piece.** `release.json` lives on
the same Pages origin; the updater also asks the node this install talks to
when that node serves a manifest. If neither answers, the updater says "no host
answered" rather than pretend the app is current.

## Cloudflare Pages (release page + courier)

The project is a **classic Pages project** named `gmatch` (`gmatch.pages.dev`),
because a Worker project would expose `<name>.<account>.workers.dev`. Deploy is
manual and local:

```sh
npx wrangler login                  # once
node site/deploy-pages.mjs          # production (branch main)
node site/deploy-pages.mjs --preview  # preview alias only
```

`site/deploy-pages.mjs` stages `index.html`, `release.json`, `img/`, `legal/`
and `functions/` inside the repo (`.pages-stage`, gitignored, removed after),
writes a `wrangler.toml` with the D1 binding, and calls `wrangler pages deploy`.
Staging stays inside the workspace so esbuild can resolve `@noble/*` for the
Functions bundle.

The courier (`site/functions/api/[[path]].ts`) keeps **only**:

- `GET /api/health` — mode `courier`, services `mail,directory`;
- `GET /api/identity` — `sealed_available:false` (no transport key here);
- `GET /api/servers` — public directory; addresses only to signed callers;
- `POST /api/servers`, `POST /api/servers/:id/ping`, `DELETE /api/servers/:id`
  — Ed25519-signed (`X-Orbit-*` headers) and owner-bound;
- `PUT/GET /api/mail/:token`, `POST /api/mail/:token/ack`, `/api/mail/stats/size`
  — sealed envelopes, TTL 7 days, drain requires proof of key ownership;
- everything else — `404` (the blind-courier law).

Storage is D1 (`gmatch-courier`, id `3773d27c-23cc-4fe4-bcc6-8bf17cb70009`).
Schema: `site/schema.sql`.

```sh
npx wrangler d1 create gmatch-courier                       # once, then paste the id
npx wrangler d1 execute gmatch-courier --remote --file=site/schema.sql
```

No secrets are required: the courier publishes no transport key and verifies
mail ACKs against the caller's own pubkey. There is **no TURN** — `/api/turn`
answers 404 on purpose, so clients stay on STUN/direct paths instead of being
handed credentials to a relay that does not exist. (A TURN service can be added
later as its own deployment.)

There is **no WebSocket** on the courier: a Pages isolate cannot notify a socket
held by another isolate without a Durable Object. `MailClient` detects the
courier origin and polls its boxes every 20 s instead.

## Self-hosted node (optional)

A full node is the normal Bun API (`apps/api`): `bun run src/serve.ts`, SQLite
snapshot, blob dir. The `Dockerfile` builds it; run it wherever you host.

- Secrets live in the environment (or `apps/api/.env.local`); never in the repo.
- Admin suite: `ADMIN_PIN_HASH` (sha256 hex of the PIN) + `ADMIN_ORBIT_ID` (the
  one orbitId allowed to unlock). Without `ADMIN_ORBIT_ID` the PIN alone grants
  admin (self-host model).
- A courier can also be run by a node with `SITE_SERVICES=mail` — it then
  serves the directory and mail and 404s content routes, exactly like the
  Cloudflare function.

## API_SEALED_ONLY flip (wave 2 B2)

`API_SEALED_ONLY=1` now rejects plaintext GETs too. Flip ONLY after the
desktop release that seals GET headers is the minimum supported client —
old clients break otherwise. Rollback: unset the secret (signed-plaintext
legacy path stays implemented). This applies to full nodes, not to the
Cloudflare courier (which never advertises a transport key).

## Dev sidecar

`ADMIN_PIN=<pin> [ADMIN_ORBIT_ID=<orbitId>] npm run dev` in apps/desktop
(vite spawns the bun sidecar with the env). Never commit PIN values.

Or put `ADMIN_PIN=...` in `apps/api/.env.local` (gitignored). Bun loads that
file from the sidecar's cwd, so it applies to `npm run dev` AND to
`npm run electron` — the Electron main deliberately does NOT inject a generated
ADMIN_PIN when unpackaged, precisely so it cannot shadow `.env.local`. A real
process env var beats a `.env` file in Bun, so injecting one silently overrode
whatever the developer had configured.

In a PACKAGED install there is no repo and no `.env.local`, so
`electron/apiSidecar.cjs` mints an 8-hex PIN into
`userData/admin-pin.txt` and Settings -> Server displays it. That is the
self-hoster path and it is unaffected by the rule above.

Reading the failure: the admin console now names the node and the reason.
`401` wrong PIN (or the identity is not `ADMIN_ORBIT_ID` — that gate runs
*before* the PIN compare, so a correct PIN from the wrong account also 401s);
`403` admin grant expired; `404` the node does not run the admin service
(`SITE_SERVICES` without `admin`); `429` 5-strikes/15-minutes lockout; `503`
no `ADMIN_PIN`/`ADMIN_PIN_HASH` set, so nothing to compare against.

Dev is **local-only** (`scripts/dev.cjs` + `vite.config.ts`): there is no
`GMATCH_DEV_API=remote`. Port 5173 is strict because localStorage, IndexedDB
and the identity are origin-bound.

**A courier is a directory/mail relay, never a data base.** The Cloudflare
function 404s every stateful route, so no client may persist it as
`gmatch.api.url` — older builds did, which is why `purgeCourierApiState()`
(`apps/desktop/src/utils/api.ts`) clears that state on boot. e2e
`api-network.spec.ts` fails if the dev `/api` ever points back at a courier.
