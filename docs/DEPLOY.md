# Deploy notes (security-relevant ops)

## Host status (2026-10-21) — both central hosts are being decommissioned

| Host | State | Action |
|---|---|---|
| `gmatch.fly.dev` | **frozen / stuck** on an old release (1.4.7) | not redeployed; treat as dead. Do not depend on it. |
| `gmatch-wcz1.onrender.com` | the current stand-in (courier + release feed); was returning 503 for ~40 min on 2026-10-21 | redeploy or migrate; the site tree now carries only the current artifact, so the build context is small again. |

The end state is direct peer-to-peer (SPEC §12b): no central host storing
posts, media, comments, likes or profiles. What stays central is a rendezvous
(sealed mail / TURN / directory) and optionally a node a player hosts.

Recovery, in order:
1. `fly auth login && fly deploy` from the repo root — brings the API **and**
   `site/releases/` (the current portable exe) up on fly, which is
   always-on (`min_machines_running = 1`).
2. If Render is the one down, check its deploy log for a failed build
   (context size, disk) rather than assuming the app is broken: the API
   bundles cleanly (`npm run stage:api`).

**The release feed is the last host-dependent piece.** When the hosts are
gone, the artifact has to be served by peers or by the user; until then the
updater must say "no host answered" rather than pretend the app is current.

## Central node (gmatch-wcz1.onrender.com)

- Secrets live in fly (`fly secrets list -a gmatch`); never in the repo.
- Admin suite on the official node: `ADMIN_PIN_HASH` (sha256 hex of the PIN)
  + `ADMIN_ORBIT_ID` (the one orbitId allowed to unlock) +
  `SITE_SERVICES=mail,turn` (content routes 404 at the edge).
  Without `ADMIN_ORBIT_ID` the PIN alone grants admin (self-host model).
- Front proxy (wave 2, PENDING): put the domain behind Cloudflare Proxied so
  the fly origin only sees CF egress IPs — the app layer already never
  stores/echoes/logs client IPs (`scripts/security-greps.sh` gate); this
  closes the network-edge view. Verify once fronted:
  `curl -sI https://gmatch-wcz1.onrender.com/api/health | grep -i server` shows cloudflare.

## API_SEALED_ONLY flip (wave 2 B2)

`API_SEALED_ONLY=1` now rejects plaintext GETs too. Flip ONLY after the
desktop release that seals GET headers is the minimum supported client —
old clients break otherwise. Rollback: unset the secret (signed-plaintext
legacy path stays implemented).

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

`GMATCH_DEV_API=remote` points dev at a remote FULL node (`gmatch.fly.dev`)
instead of the local sidecar. Default is the local sidecar so browser dev
debugs the same node the packaged app runs.

**The central node is a directory/mail/TURN courier, never a data base.** It
404s (and the dev proxy 503s) every stateful route, so no client may persist it
as `gmatch.api.url` — older builds did, which is why `purgeCourierApiState()`
(`apps/desktop/src/utils/api.ts`) clears that state on boot. e2e
`api-network.spec.ts` fails if the dev `/api` ever points back at a courier.
