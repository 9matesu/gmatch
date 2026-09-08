// Stages a SELF-CONTAINED API server for packaging (1.0: no central server —
// every copy ships the server; friends connect to one chosen host).
// Output: I:/goongrid/api-stage/
//   apps/api/          source + package.json (deps rewritten to file: links)
//   packages/crypto/   + packages/shared/ (vendored @orbit/* sources)
//   bun.exe            the runtime (copied from the local bun install)
// Then `npm install --omit=dev` inside apps/api makes it run with zero repo.
//
// Run: node scripts/stage-api.cjs (from apps/desktop)
const { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = join(__dirname, '..', '..', '..')
const STAGE = join(ROOT, 'api-stage')

function findBunExe() {
  const candidates = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  console.error('[stage-api] bun.exe not found in standard locations.')
  console.error('[stage-api] Install it first:  npm i -g --allow-scripts=bun bun   (or: powershell -c "irm bun.sh/install/npm | irsh")')
  process.exit(1)
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(join(STAGE, 'apps'), { recursive: true })
mkdirSync(join(STAGE, 'packages'), { recursive: true })

cpSync(join(ROOT, 'packages', 'crypto'), join(STAGE, 'packages', 'crypto'), { recursive: true, filter: (s) => !s.includes('node_modules') })
cpSync(join(ROOT, 'packages', 'shared'), join(STAGE, 'packages', 'shared'), { recursive: true, filter: (s) => !s.includes('node_modules') })
cpSync(join(ROOT, 'apps', 'api'), join(STAGE, 'apps', 'api'), {
  recursive: true,
  filter: (s) => !s.includes('node_modules') && !s.includes('test-blobs-') && !s.includes('coverage') && !s.endsWith('.sqlite') && !s.endsWith('.sqlite.tmp'),
})

// Deps -> file: links (bun resolves these without a workspace root).
const apiPkgPath = join(STAGE, 'apps', 'api', 'package.json')
const apiPkg = JSON.parse(readFileSync(apiPkgPath, 'utf8'))
for (const name of Object.keys(apiPkg.dependencies || {})) {
  if (name.startsWith('@orbit/')) {
    apiPkg.dependencies[name] = `file:../../packages/${name.split('/')[1]}`
  }
}
writeFileSync(apiPkgPath, JSON.stringify(apiPkg, null, 2) + '\n')

cpSync(findBunExe(), join(STAGE, 'bun.exe'))

console.log('[stage-api] installing production deps (this can take a minute)...')
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false'], {
  cwd: join(STAGE, 'apps', 'api'),
  stdio: 'inherit',
  shell: true, // npm is a .cmd shim on Windows
  env: { ...process.env, NODE_ENV: 'development' },
})

console.log('[stage-api] done →', STAGE)
