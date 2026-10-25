# Deploying the site

Hosted on **Cloudflare Pages** (project `gmatch`) at
`https://gmatch.pages.dev`. The artifact is static and never contains binaries:
`site/releases/*.exe` is local staging and gitignored.

## One-time

```bash
npx wrangler login                        # OAuth, opens the browser
npx wrangler pages project create gmatch --production-branch main --force
```

`--force` is only for **creating** the project: it opts into classic Pages
instead of the Workers-backed default, which is what gives the neutral
`gmatch.pages.dev` hostname. Do not pass it again.

## Every release

```bash
cd site
node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
node sync-hash.mjs
node check.mjs                            # must print OK
node deploy-pages.mjs                     # stages + uploads, no exe
```

`deploy-pages.mjs` copies only `index.html`, `release.json` and `legal/` into a
temp dir and deploys that, so no binary can leak into the artifact. It must run
wrangler from outside this workspace (wrangler refuses the workspace root).

The download link always points at the GitHub Release asset. `release.json` is
derived from the published bytes, so its sha256/size describe exactly what
users download.

## Verify

```bash
curl -s https://gmatch.pages.dev/release.json
curl -sI https://gmatch.pages.dev/ | head -1
```

There is no CI deploy token on purpose: publishing the page is a local,
auditable step. The release workflow only builds the exe and publishes the
GitHub Release.
