# Deploying the site

Hosted on **Cloudflare Pages** (project `gmatch`) at
`https://gmatch.pages.dev`. It is a **static page only**: the download page, the
legal pages and `release.json`. There is no function, no KV binding, no mailbox
and no directory behind it — nothing hosted holds app state for an install. The
`site/functions/` courier that used to run here was removed; the directory and
the sealed-mail relay are the node each client is connected to
(`docs/SPEC.md` §12b, `docs/ARCHITECTURE-P2P.md`). The artifact never contains
binaries: `site/releases/*.exe` is local staging and gitignored.

## One-time

```bash
npx wrangler login                        # OAuth, opens the browser
npx wrangler pages project create gmatch --production-branch main --force
```

`--force` is only for **creating** the project: it opts into classic Pages
instead of the Workers-backed default, which is what gives the neutral
`gmatch.pages.dev` hostname. Do not pass it again.

There is no KV namespace and no D1 database to create. The `gmatch-courier`
database and its `Mail` / `ServerDirectory` tables were deleted in gmatch 2.0,
and the Cloudflare-KV mailbox that replaced them is gone too: the directory and
the mail relay live on the node each client is connected to.

## Every release

```bash
cd site
node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
node sync-hash.mjs
node check.mjs                            # must print OK
node deploy-pages.mjs                     # stages + uploads, no exe
```

`deploy-pages.mjs` stages `index.html`, `release.json`, `img/` and `legal/`
inside the repo (`.pages-stage/`, gitignored, removed after), then runs
`wrangler pages deploy`. It writes no `wrangler.toml` and ships no function; it
refuses to run if `site/functions/` exists again. Nothing in `site/releases/`
is uploaded.

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
curl -s -o /dev/null -w "%{http_code}\n" https://gmatch.pages.dev/api/health   # 404/200 with the static fallback, never courier JSON
curl -s https://gmatch.pages.dev/api/health | head -c 60                     # "<!doctype html>" — the page, not a node
```

There is no CI deploy token on purpose: publishing the page is a local,
auditable step. The release workflow only builds the exe and publishes the
GitHub Release.
