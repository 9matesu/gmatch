# Deploy notes (security-relevant ops)

## Central node (gmatch.fly.dev)

- Secrets live in fly (`fly secrets list -a gmatch`); never in the repo.
- Admin suite on the official node: `ADMIN_PIN_HASH` (sha256 hex of the PIN)
  + `ADMIN_ORBIT_ID` (the one orbitId allowed to unlock) +
  `SITE_SERVICES=mail,turn` (content routes 404 at the edge).
  Without `ADMIN_ORBIT_ID` the PIN alone grants admin (self-host model).
- Front proxy (wave 2, PENDING): put the domain behind Cloudflare Proxied so
  the fly origin only sees CF egress IPs — the app layer already never
  stores/echoes/logs client IPs (`scripts/security-greps.sh` gate); this
  closes the network-edge view. Verify once fronted:
  `curl -sI https://gmatch.fly.dev/api/health | grep -i server` shows cloudflare.

## API_SEALED_ONLY flip (wave 2 B2)

`API_SEALED_ONLY=1` now rejects plaintext GETs too. Flip ONLY after the
desktop release that seals GET headers is the minimum supported client —
old clients break otherwise. Rollback: unset the secret (signed-plaintext
legacy path stays implemented).

## Dev sidecar

`ADMIN_PIN=<pin> [ADMIN_ORBIT_ID=<orbitId>] npm run dev` in apps/desktop
(vite spawns the bun sidecar with the env). Never commit PIN values.
