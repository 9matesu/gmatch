# Deploying the site

Hosted on **Cloudflare Pages** (project `gmatch`) at
`https://gmatch.pages.dev`. One project serves both the static page and the
**blind courier** (`functions/api/[[path]].ts`): a signed public-node directory
plus a sealed-mail relay backed by D1. It has no content tables, no accounts,
no presence and no TURN, and answers 404 on every stateful route. The artifact
never contains binaries: `site/releases/*.exe` is local staging and gitignored.

## One-time

```bash
npx wrangler login                        # OAuth, opens the browser
npx wrangler pages project create gmatch --production-branch main --force
npx wrangler d1 create gmatch-courier     # paste the id into wrangler.toml
npx wrangler d1 execute gmatch-courier --remote --file=site/schema.sql
```

`--force` is only for **creating** the project: it opts into classic Pages
instead of the Workers-backed default, which is what gives the neutral
`gmatch.pages.dev` hostname. Do not pass it again.

The D1 binding is declared by `deploy-pages.mjs` in the staged
`wrangler.toml` (`binding = "DB"`, database `gmatch-courier`). Schema:
`site/schema.sql` (`Mail` + `ServerDirectory`).

## Every release

```bash
cd site
node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
node sync-hash.mjs
node check.mjs                            # must print OK
node deploy-pages.mjs                     # stages + uploads, no exe
```

`deploy-pages.mjs` stages `index.html`, `release.json`, `img/`, `legal/`,
`functions/` and a generated `wrangler.toml` inside the repo (`.pages-stage/`,
gitignored, removed after), then runs `wrangler pages deploy`. Staging stays
inside the workspace so esbuild can resolve `@noble/curves`/`@noble/hashes` for
the Functions bundle. Nothing in `site/releases/` is uploaded.

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
curl -s https://gmatch.pages.dev/api/health          # {"ok":true,"mode":"courier",...}
curl -s https://gmatch.pages.dev/api/servers         # {"servers":[...]}
curl -s -o /dev/null -w "%{http_code}\n" https://gmatch.pages.dev/api/posts   # 404
curl -s -o /dev/null -w "%{http_code}\n" https://gmatch.pages.dev/api/turn    # 404
```

There is no CI deploy token on purpose: publishing the page is a local,
auditable step. The release workflow only builds the exe and publishes the
GitHub Release.
