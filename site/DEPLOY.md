# Deploying the site

Hosted on **Cloudflare Pages** (project `gmatch`) at
`https://gmatch.pages.dev`. Since gmatch 2.0 it is a **static page only**: the
download page, the legal pages and `release.json`. There is no function, no D1
binding, no mailbox and no directory behind it — nothing hosted holds app state
for an install. The artifact never contains binaries: `site/releases/*.exe` is
local staging and gitignored.

## One-time

```bash
npx wrangler login                        # OAuth, opens the browser
npx wrangler pages project create gmatch --production-branch main --force
```

`--force` is only for **creating** the project: it opts into classic Pages
instead of the Workers-backed default, which is what gives the neutral
`gmatch.pages.dev` hostname. Do not pass it again.

There is no D1 database to create. The `gmatch-courier` database and its
`Mail` / `ServerDirectory` tables were deleted in gmatch 2.0; the directory and
the mail relay now live on the node each client is connected to.

## Every release

```bash
cd site
node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
node sync-hash.mjs
node check.mjs                            # must print OK
node deploy-pages.mjs                     # stages + uploads, no exe
```

`deploy-pages.mjs` stages `index.html`, `release.json`, `img/`, `legal/` and a
generated `wrangler.toml` inside the repo (`.pages-stage/`, gitignored, removed
after), then runs `wrangler pages deploy`. Nothing in `site/releases/` is
uploaded.

`--preview` deploys a preview alias instead of production.

Screenshots are regenerated from the app itself, never hand-made:

```bash
cd ../apps/desktop && NODE_ENV=test npx playwright test e2e/capture.spec.ts
```

That spec drives the real UI against synthetic 1x1 placeholder media, so no
external image is fetched and nothing adult is captured. Output lands in
`site/img/` (`feed`, `servers`, `watch`, `games-hub`, `idle-grid`, `cards`).

The download link always points at the GitHub Release asset. `release.json` is
derived from the published bytes, so its sha256/size describe exactly what
users download.

## Verify

```bash
curl -s https://gmatch.pages.dev/release.json
curl -sI https://gmatch.pages.dev/ | head -1
curl -s -o /dev/null -w "%{http_code}\n" https://gmatch.pages.dev/api/health   # no courier JSON (static fallback)
curl -s https://gmatch.pages.dev/api/health | head -c 60                     # "<!doctype html>" — the page, not a node
```

There is no CI deploy token on purpose: publishing the page is a local,
auditable step. The release workflow only builds the exe and publishes the
GitHub Release.
