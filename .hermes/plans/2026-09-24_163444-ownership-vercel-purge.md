# Ownership migration: goongrid → 9matesu repo + Vercel site + purge ORBIT/Thiago boundaries

## Goal

Consolidate the goongrid codebase fully under github.com/9matesu, deploy the static site to the user's own Vercel account, and remove every external boundary inherited from the previous owner (ORBIT package names, Render/fly central-node URLs, stray key material).

## Current context (verified 2026-09-24)

- Repo: I:/goongrid, remote ALREADY `https://github.com/9matesu/goongrid.git`; gh CLI logged in as 9matesu; all commits authored by matesu/9matesu. Repo move is ~95% done; remaining work is verification + push-all-branches + cleanup.
- Dirty tree: 4 modified files (apps/desktop/src/components/servers/ServersView.test.tsx, ServersView.tsx, settings/GMatchSettingsModal.tsx, utils/api.ts) + utils/central.ts from unrelated WIP. Must be stashed/committed BEFORE this migration to keep the diff clean.
- ORBIT legacy: packages named @orbit/api, @orbit/crypto, @orbit/protocol, @orbit/shared; 188 files import @orbit/*; tsconfig paths in apps/desktop/tsconfig.json lines 18-20; root package.json script serve:api uses -w @orbit/api.
- Protocol identifiers `orbitId`, `orbit-global-presence-v1`, `orbit_node_directory_v1`, `orbit_p2p_swarm` appear in 240 files. RENAMING THESE BREAKS P2P COMPAT with shipped clients — OUT OF SCOPE (see Risks).
- Central node hardcoded: apps/desktop/src/utils/central.ts:8 `https://gmatch-wcz1.onrender.com`; also apps/desktop/electron/apiSidecar.cjs:115, electron/main.cjs:1646; site/check.mjs:20 ALLOW regex; .github/workflows/deploy-site.yml; docs/DEPLOY.md.
- Deploy configs for someone else's infra: fly.toml (app=gmatch, fly volume gmatch_data), render.yaml (gmatch-courier).
- Outside repo: I:/thiagorribeirov@gmail.com-2026-06-22T22_48_59.133Z_public.pem (previous owner's public key).
- Site today: built by .github/workflows/deploy-site.yml (build-legal.mjs → build-release.mjs → sync-hash.mjs → check.mjs honesty gate) → GitHub Pages. Site is plain static HTML (site/index.html + legal/ + releases/ + img/).
- No string 'thiago' or 'ribeiro' exists inside the repo (verified by grep).

## Approach

1. Freeze WIP, verify GitHub ownership, push everything. 2) Mechanical rename @orbit/* → @gmatch/* (build-time only, wire protocol untouched). 3) Make the central courier URL env-driven with empty default (island mode) and delete fly.toml/render.yaml. 4) Move the site pipeline's final step from GitHub Pages to `vercel deploy --prebuilt` using repo secrets. 5) Sweep docs + delete the stray .pem. No new abstractions; every step is sed/edit + grep verification + existing test gate.

## Step-by-step tasks

### Task 0 — Freeze WIP, baseline green (2 min)

```
cd I:/goongrid
git stash push -m "pre-ownership-migration WIP" apps/desktop/src/components/servers/ServersView.test.tsx apps/desktop/src/components/servers/ServersView.tsx apps/desktop/src/components/settings/GMatchSettingsModal.tsx apps/desktop/src/utils/api.ts apps/desktop/src/utils/central.ts
git checkout -b chore/ownership-migration
npm run lint && npm run typecheck && npm run test
```
Expected: lint 0 errors, typecheck clean, tests green. This is the baseline; every later task must end green. If baseline is red, STOP and report — do not migrate on top of a broken tree.

### Task 1 — Verify GitHub ownership + push all refs (3 min)

```
cd I:/goongrid
gh repo view 9matesu/goongrid --json owner,name,isPrivate
git push origin 'refs/heads/*'
git push origin --tags
```
Expected: owner.login == 9matesu; push reports every local branch up-to-date or pushed. Then read back:
```
gh api repos/9matesu/goongrid --jq .owner.login
```
Expected output: `9matesu`.

### Task 2 — Rename workspace packages @orbit/* → @gmatch/* (5 min)

Files: packages/crypto/package.json, packages/protocol/package.json, packages/shared/package.json, apps/api/package.json (own name + deps), apps/desktop/package.json (deps), package.json (root, serve:api script), apps/desktop/tsconfig.json (paths), every import.

```
cd I:/goongrid
# 1. package.json names/deps + tsconfig paths (everything except lock file)
grep -rl '@orbit/' --include='*.ts' --include='*.tsx' --include='*.json' apps packages package.json | grep -v node_modules | xargs sed -i 's|@orbit/|@gmatch/|g'
# 2. regenerate lock file
rm package-lock.json && npm install
```
Verify (all must print 0):
```
grep -rn '@orbit/' --include='*.ts' --include='*.tsx' --include='*.json' apps packages package.json package-lock.json | grep -v node_modules | wc -l
```
Then:
```
npm run lint && npm run typecheck && npm run test
```
Expected: same green as baseline. Commit: `chore: rename @orbit/* workspace packages to @gmatch/*`.

Notes for the implementer:
- Do NOT sed inside .git, node_modules, dist, api-stage/, or .agents/ (api-stage is gitignored build staging; .agents is vendored skill docs, leave alone).
- If a test file asserts on a literal '@orbit/' string, update the assertion to '@gmatch/' in the same commit.

### Task 3 — Env-driven central URL, delete foreign infra configs (5 min)

TDD for central.ts first:
1. Read apps/desktop/src/utils/central.ts and its test apps/desktop/src/utils/central.test.ts.
2. Edit central.test.ts: change/extend the default-case assertion to expect empty string when no env is set, and expect `import.meta.env.VITE_CENTRAL_URL` when set. Run:
   `npm run test -w @gmatch/desktop -- central` → expected FAIL (still returns the Render URL).
3. Edit central.ts line 8: replace
   `const DEFAULT_CENTRAL_URL = 'https://gmatch-wcz1.onrender.com'`
   with
   `const DEFAULT_CENTRAL_URL = import.meta.env.VITE_CENTRAL_URL ?? ''`
   (keep whatever export shape the file already has; empty string = island/host mode, which already exists as a supported mode).
4. Re-run the same test → expected PASS. Then full gate: `npm run lint && npm run typecheck && npm run test`.

Same treatment for the packaged defaults (no test exists for these; verify by grep after):
- apps/desktop/electron/apiSidecar.cjs:115 — replace `'https://gmatch-wcz1.onrender.com'` with `(process.env.GMATCH_CENTRAL_URL || '')`.
- apps/desktop/electron/main.cjs:1646 — replace `url: 'https://gmatch-wcz1.onrender.com'` with `url: process.env.GMATCH_CENTRAL_URL || ''`.

Delete foreign infra:
```
cd I:/goongrid && git rm fly.toml render.yaml
```
Verify: `grep -rn 'gmatch-wcz1\|onrender\|fly\.dev\|fly secrets' apps site docs scripts .github README.md AGENTS.md | grep -v node_modules` → expected: only hits inside docs/ text you will fix in Task 6 (zero hits in code/workflows after Tasks 3-6).

Commit: `chore: make central node env-driven, drop Render/fly infra configs`.

### Task 4 — Site pipeline → Vercel (5 min + one-time user action)

One-time (needs the user's Vercel account; CLI already installed, v56.4.1):
```
cd I:/goongrid/site
vercel login          # browser/device flow, user completes
vercel link           # create new project "gmatch-site", framework: Other, output dir: .
```
This writes site/.vercel/project.json. Commit that file:
```
git add site/.vercel/project.json
```
Then capture IDs for GitHub secrets:
```
vercel whoami
vercel inspect $(vercel ls --json | head -1 | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4) --json   # or read .vercel/project.json: orgId + projectId
```
Set repo secrets (exact):
```
gh secret set VERCEL_TOKEN --repo 9matesu/goongrid       # token from https://vercel.com/account/tokens (user creates it)
gh secret set VERCEL_ORG_ID --repo 9matesu/goongrid --body "<orgId>"
gh secret set VERCEL_PROJECT_ID --repo 9matesu/goongrid --body "<projectId>"
```

Workflow edit — replace the Pages deploy in .github/workflows/deploy-site.yml:
- Keep every existing build/gate step (gen-legal anti-drift, release.json build, build-legal + sync-hash, check.mjs HONESTY GATE, exe strip).
- Delete the `actions/upload-pages-artifact` step, the whole `deploy` job (actions/deploy-pages), and the `pages:` permission block.
- Append to the `build` job, after "Strip the exe":

```
      - name: Deploy to Vercel (prod)
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          npm i -g vercel@56
          cd site
          vercel deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN"
```

Verify after first push to main: `gh run watch` on the Deploy site run → all steps green; read back `vercel ls --json | grep gmatch-site` shows a ready production URL; `curl -fsS <that-url>/ | head -5` returns the site HTML.

Commit: `ci: publish site to Vercel instead of GitHub Pages`.

### Task 5 — Sweep remaining boundary references (4 min)

```
cd I:/goongrid
grep -rn 'onrender\|fly\.dev\|fly secrets\|gmatch-wcz1\|GitHub Pages\|pages\.github' apps site docs scripts .github README.md AGENTS.md 2>/dev/null | grep -v node_modules
```
For each hit: if code/workflow → fix to the env-driven form or Vercel; if prose (README.md, docs/DEPLOY.md, docs/SPEC.md, docs/ARCHITECTURE-P2P.md, docs/DESKTOP.md, site/index.html line ~256 courier-mode sentence, site/build-release.mjs comment line 25) → rewrite to say the central node is operator-supplied via GMATCH_CENTRAL_URL / VITE_CENTRAL_URL and the site lives on Vercel. site/check.mjs:20 ALLOW regex: drop `gmatch\.fly\.dev|gmatch-wcz1\.onrender\.com` members, keep virustotal; if the page then references the new Vercel URL, add its hostname to ALLOW.

Re-run the site honesty gate locally:
```
cd I:/goongrid/site && node build-legal.mjs && node check.mjs
```
Expected: exit 0. Then full gate: `npm run lint && npm run typecheck && npm run test`.

Commit: `chore: purge external-owner references from docs and site`.

### Task 6 — Delete previous owner's key material outside the repo (1 min)

```
rm 'I:/thiagorribeirov@gmail.com-2026-06-22T22_48_59.133Z_public.pem'
```
Confirm with `ls I:/*.pem` → no such file. (Public key only, no secret exposure; deletion is the ownership cleanup. Ask the user first ONLY if they want it archived instead.)

### Task 7 — Merge + final verification (3 min)

```
cd I:/goongrid
git checkout main && git merge --no-ff chore/ownership-migration -m "release: full ownership migration (9matesu repo, Vercel site, ORBIT->gmatch packages)"
git push origin main
npm run lint && npm run typecheck && npm run test
git stash pop
```
Expected: push succeeds, gates green, stash restores the unrelated WIP cleanly. Final assertion set (each must print nothing or 0):
```
grep -rn '@orbit/' apps packages package.json package-lock.json | grep -v node_modules | wc -l   # 0
grep -rn 'gmatch-wcz1\|onrender' apps site scripts .github | grep -v node_modules | wc -l       # 0
gh api repos/9matesu/goongrid --jq .owner.login                                                  # 9matesu
vercel ls --json | grep gmatch-site                                                              # ready deployment
```

## Tests / validation summary

- Baseline gate before and after every code task: `npm run lint && npm run typecheck && npm run test` (must match baseline).
- Task 3 follows strict TDD on central.ts (failing test → minimal change → green).
- Mechanical renames validated by grep-count == 0 plus the full gate (188 import sites are compile-checked by typecheck).
- External state verified by read-back: gh api owner, vercel ls + curl of the production URL, workflow run status.

## Risks, tradeoffs, open questions

1. Courier/multiplayer goes dark until the user runs their own central node (GMATCH_CENTRAL_URL). The packaged default becomes island/host mode. If continuity matters, keep the Render service up until a replacement exists — the env var makes that a one-line revert. DEFAULT CHOSEN: empty default (no foreign dependency). Say the word to keep Render as fallback.
2. orbitId / presence-token / localStorage-key names deliberately NOT renamed (240 files, wire + storage compat with shipped exes). Rename only when a breaking release (v2) is acceptable.
3. Vercel free tier serves the static site fine (HTML + small files; the 114MB exe is never uploaded — the page links the GitHub Release, same as today).
4. VERCEL_TOKEN must be created by the user in their Vercel dashboard; the plan cannot mint it.
5. Repo is named "goongrid" while the product is gmatch — renaming the GitHub repo (9matesu/gmatch) is a separate one-liner (`gh repo rename`) not included; ask if wanted.
6. GitHub Pages stays enabled on the repo settings but stops updating; disable it in repo Settings → Pages after Task 4 verifies (manual UI step).