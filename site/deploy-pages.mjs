// Deploy the release page + the blind rendezvous to Cloudflare Pages (project
// `gmatch`, https://gmatch.pages.dev).
//
// Two artifacts, one deploy:
//   - static: index.html, release.json, img/, legal/  (the exe never ships)
//   - functions: api/[[path]].ts = sealed mail + directory, KV-backed
//
// The rendezvous is aBlind courier: it holds envelopes it cannot open and
// directory rows (a name + an address). It never holds a profile, a post, a
// presence row or a media byte. See docs/SPEC.md §12b.
//
// Staging happens INSIDE the repo (.pages-stage) and is removed afterwards.
//
//   node deploy-pages.mjs            # production (branch main)
//   node deploy-pages.mjs --preview  # preview alias, production untouched
//
// Requires `npx wrangler login` once, and ONE manual step (KV cannot be created
// by `pages deploy`):
//
//   npx wrangler kv namespace create MAIL
//   # → paste the returned id into KV_ID below, or export GMATCH_KV_ID
//
// Manual on purpose: there is no CI deploy token, so publishing stays a local,
// auditable step.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = import.meta.dirname
const stage = join(here, '..', '.pages-stage')
const preview = process.argv.includes('--preview')

// Fill with the id printed by `wrangler kv namespace create MAIL`.
const KV_ID = process.env.GMATCH_KV_ID || ''

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
try {
  cpSync(join(here, 'index.html'), join(stage, 'index.html'))
  cpSync(join(here, 'release.json'), join(stage, 'release.json'))
  cpSync(join(here, 'img'), join(stage, 'img'), { recursive: true })
  cpSync(join(here, 'legal'), join(stage, 'legal'), { recursive: true })
  cpSync(join(here, 'functions'), join(stage, 'functions'), { recursive: true })

  if (!KV_ID) {
    console.warn(
      '[deploy] GMATCH_KV_ID is empty: the rendezvous will boot with no KV binding and ' +
        'every mail/directory call will fail. Run `npx wrangler kv namespace create MAIL` ' +
        'and re-run with GMATCH_KV_ID=<id>.',
    )
  }

  writeFileSync(
    join(stage, 'wrangler.toml'),
    [
      'name = "gmatch"',
      'compatibility_date = "2026-10-24"',
      'pages_build_output_dir = "."',
      '',
      '# Blind rendezvous storage: sealed envelopes (TTL 120 s) + directory rows.',
      '# No content table exists by design.',
      '[[kv_namespaces]]',
      'binding = "MAIL"',
      `id = "${KV_ID}"`,
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