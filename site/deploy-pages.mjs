// Deploy the release page AND the blind courier to Cloudflare Pages
// (project `gmatch`, https://gmatch.pages.dev).
//
// Public files ship from site/: index.html, release.json, img/ (favicon +
// screenshots), legal/ and functions/ (the courier: /api/health, /api/identity,
// /api/servers directory, /api/mail relay). The 100 MB exe never ships.
//
// Staging happens INSIDE the repo (.pages-stage) on purpose: wrangler bundles
// functions/api/[[path]].ts with esbuild, and the file imports @noble/* from
// the workspace's node_modules. A temp dir outside the workspace cannot
// resolve those. The stage is removed afterwards.
//
//   node deploy-pages.mjs            # production (branch main)
//   node deploy-pages.mjs --preview  # preview alias, production untouched
//
// Requires `npx wrangler login` once. Manual on purpose: there is no CI deploy
// token, so publishing stays a local, auditable step.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = import.meta.dirname
const stage = join(here, '..', '.pages-stage')
const preview = process.argv.includes('--preview')

// The courier's D1 database (site/schema.sql). Override for a fork.
const D1_ID = process.env.GMATCH_D1_ID || '3773d27c-23cc-4fe4-bcc6-8bf17cb70009'

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
try {
  cpSync(join(here, 'index.html'), join(stage, 'index.html'))
  cpSync(join(here, 'release.json'), join(stage, 'release.json'))
  cpSync(join(here, 'img'), join(stage, 'img'), { recursive: true })
  cpSync(join(here, 'legal'), join(stage, 'legal'), { recursive: true })
  cpSync(join(here, 'functions'), join(stage, 'functions'), { recursive: true })

  writeFileSync(
    join(stage, 'wrangler.toml'),
    [
      'name = "gmatch"',
      'compatibility_date = "2026-10-24"',
      'pages_build_output_dir = "."',
      '',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "gmatch-courier"',
      `database_id = "${D1_ID}"`,
      '',
    ].join('\n'),
  )

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
