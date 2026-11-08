// Deploy the release page to Cloudflare Pages (project `gmatch`,
// https://gmatch.pages.dev).
//
// Public files ship from site/: index.html, release.json, img/ (favicon +
// screenshots) and legal/. The 100 MB exe never ships.
//
// gmatch 2.0: this is a STATIC PAGE and nothing else. The blind courier
// function and its D1 binding were removed — no hosted service holds a
// mailbox, a directory row or any other app state for an install. A node is
// where a client lives; peers meet there.
//
// Staging happens INSIDE the repo (.pages-stage) and is removed afterwards.
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

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
try {
  cpSync(join(here, 'index.html'), join(stage, 'index.html'))
  cpSync(join(here, 'release.json'), join(stage, 'release.json'))
  cpSync(join(here, 'img'), join(stage, 'img'), { recursive: true })
  cpSync(join(here, 'legal'), join(stage, 'legal'), { recursive: true })

  writeFileSync(
    join(stage, 'wrangler.toml'),
    [
      'name = "gmatch"',
      'compatibility_date = "2026-10-24"',
      'pages_build_output_dir = "."',
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
