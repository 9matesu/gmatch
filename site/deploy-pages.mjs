// Deploy the release page to Cloudflare Pages (project `gmatch`).
//
// Only the public files ship — index.html, release.json, img/ (favicon +
// screenshots) and legal/ — staged in a temp dir outside the workspace
// (wrangler refuses to run at a workspace root, and the 100 MB exe must never
// be uploaded). Run from site/:
//
//   node deploy-pages.mjs
//
// Requires `npx wrangler login` once. Manual on purpose: there is no CI deploy
// token, so publishing stays a local, auditable step.
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = import.meta.dirname
const stage = mkdtempSync(join(tmpdir(), 'gmatch-site-'))
try {
  cpSync(join(here, 'index.html'), join(stage, 'index.html'))
  cpSync(join(here, 'release.json'), join(stage, 'release.json'))
  cpSync(join(here, 'img'), join(stage, 'img'), { recursive: true })
  cpSync(join(here, 'legal'), join(stage, 'legal'), { recursive: true })

  const args = [
    '--yes', 'wrangler', 'pages', 'deploy', stage,
    '--project-name', 'gmatch',
    '--branch', 'main',
    '--commit-dirty=true',
  ]
  const out = spawnSync('npx', args, { stdio: 'inherit', shell: true, cwd: stage })
  process.exit(out.status ?? 1)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
