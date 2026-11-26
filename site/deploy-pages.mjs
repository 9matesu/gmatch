// Deploy the static release page to Cloudflare Pages (project `gmatch`,
// https://gmatch.pages.dev).
//
// ONE artifact: index.html, release.json, img/, legal/. The exe never ships.
//
// There is NO function and NO KV binding. The Pages origin used to also run a
// blind rendezvous (site/functions/, a Cloudflare-KV-backed mailbox +
// directory); it was removed. The directory and the mail relay are the node
// each client is connected to (docs/SPEC.md §12b, docs/ARCHITECTURE-P2P.md).
// Keeping the page static is what makes it free, cacheable and unable to hold
// app state for anyone.
//
// Staging happens INSIDE the repo (.pages-stage) and is removed afterwards.
//
//   node deploy-pages.mjs            # production (branch main)
//   node deploy-pages.mjs --preview  # preview alias, production untouched
//
// Requires `npx wrangler login` once. Manual on purpose: there is no CI deploy
// token, so publishing stays a local, auditable step.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = import.meta.dirname
const stage = join(here, '..', '.pages-stage')
const preview = process.argv.includes('--preview')

// The release page is STATIC. A functions/ directory anywhere in the stage
// would turn it into a Function deploy (and silently reintroduce the retired
// courier), so refuse to publish instead of shipping one.
if (existsSync(join(here, 'functions'))) {
  console.error('[deploy] site/functions/ exists: the release page must stay static. Delete it.')
  process.exit(1)
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
try {
  cpSync(join(here, 'index.html'), join(stage, 'index.html'))
  cpSync(join(here, 'release.json'), join(stage, 'release.json'))
  cpSync(join(here, 'img'), join(stage, 'img'), { recursive: true })
  cpSync(join(here, 'legal'), join(stage, 'legal'), { recursive: true })

  const args = [
    '--yes', 'wrangler', 'pages', 'deploy', stage,
    '--project-name', 'gmatch',
    '--branch', preview ? 'preview' : 'main',
    '--commit-dirty=true',
  ]
  const out = spawnSync('npx', args, { stdio: 'inherit', shell: true, cwd: stage })
  process.exit(out.status ?? 1)
} finally {
  rmSync(stage, { recursive: true, force: true })
}