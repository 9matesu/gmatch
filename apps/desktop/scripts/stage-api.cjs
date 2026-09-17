// Stages a SELF-CONTAINED API server for packaging (1.0: no central server —
// every copy ships the server; friends connect to one chosen host).
// Output: I:/gmatch/api-stage/
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
  // Explicit override (CI can pin it): GMATCH_BUN_EXE=path/to/bun.exe
  if (process.env.GMATCH_BUN_EXE && existsSync(process.env.GMATCH_BUN_EXE)) {
    return process.env.GMATCH_BUN_EXE
  }
  const candidates = [
    join(ROOT, 'bun.exe'),
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
    // GitHub Actions windows-latest global npm prefix
    'C:\\npm\\prefix\\node_modules\\bun\\bin\\bun.exe',
    join(process.env.PREFIX || '', 'node_modules', 'bun', 'bin', 'bun.exe'),
  ]
  // Authoritative global root (npm root -g works on runners + dev boxes).
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim()
    if (globalRoot) candidates.push(join(globalRoot, 'bun', 'bin', 'bun.exe'))
  } catch { /* npm not on PATH */ }
  for (const c of candidates) if (existsSync(c)) return c
  // Last resort: resolve `bun.exe` from PATH (npm -g shims may put it there).
  try {
    const out = execFileSync('where.exe', ['bun.exe'], { encoding: 'utf8' }).trim()
    const NL = String.fromCharCode(10)
    const first = out.includes(NL) ? out.split(NL)[0].trim() : out
    if (first.toLowerCase().endsWith('bun.exe') && existsSync(first)) return first
  } catch {
    /* not on PATH */
  }
  console.error('[stage-api] bun.exe not found in standard locations.')
  console.error('[stage-api] Install it first:  npm i -g --allow-scripts=bun bun   (or: powershell -c "irm bun.sh/install/npm | irsh")')
  process.exit(1)
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(join(STAGE, 'apps'), { recursive: true })
mkdirSync(join(STAGE, 'packages'), { recursive: true })

// Stage-root marker package.json: stops npm's walk-up to the real workspace
// root (which would make it reconcile this subdir against the monorepo's
// lockfile and crash arborist on rewritten file: deps).
// Declares the staged workspaces so `bun install` links file: deps correctly.
writeFileSync(join(STAGE, 'package.json'), JSON.stringify({ name: 'gmatch-api-stage', private: true, workspaces: ['apps/api', 'packages/*'] }, null, 2) + '\n')

cpSync(join(ROOT, 'packages', 'crypto'), join(STAGE, 'packages', 'crypto'), { recursive: true, filter: (s) => !s.includes('node_modules') })
cpSync(join(ROOT, 'packages', 'shared'), join(STAGE, 'packages', 'shared'), { recursive: true, filter: (s) => !s.includes('node_modules') })
cpSync(join(ROOT, 'packages', 'protocol'), join(STAGE, 'packages', 'protocol'), { recursive: true, filter: (s) => !s.includes('node_modules') })
// packages/shared/src/index.ts imports ../../../shared/blocklist.json (single
// source of truth, 84f4d68) — the stage is only complete with the root file.
cpSync(join(ROOT, 'shared'), join(STAGE, 'shared'), { recursive: true, filter: (s) => !s.includes('node_modules') })
cpSync(join(ROOT, 'apps', 'api'), join(STAGE, 'apps', 'api'), {
  recursive: true,
  filter: (s) => !s.includes('node_modules') && !s.includes('test-blobs-') && !s.includes('coverage') && !s.endsWith('.sqlite') && !s.endsWith('.sqlite.tmp'),
})

// Deps -> file: links (bun resolves these without a workspace root).
// NOTE: npm's arborist silently DROPS the transitive deps of a file:-linked
// package that lives outside the project root (@orbit/crypto's
// @noble/ciphers/@noble/curves were never installed in the stage, so the
// bundled server crashed on boot with "Cannot find module
// '@noble/curves/ed25519'" and every upload/PM failed). Pin them as direct
// deps of the staged API so the install is deterministic either way.
const apiPkgPath = join(STAGE, 'apps', 'api', 'package.json')
const apiPkg = JSON.parse(readFileSync(apiPkgPath, 'utf8'))
for (const name of Object.keys(apiPkg.dependencies || {})) {
  if (name.startsWith('@orbit/')) {
    apiPkg.dependencies[name] = `file:../../packages/${name.split('/')[1]}`
  }
}
apiPkg.dependencies = {
  ...apiPkg.dependencies,
  '@noble/ciphers': '^2.2.0',
  '@noble/curves': '^1.3.0',
  '@noble/hashes': '^1.3.3',
}
writeFileSync(apiPkgPath, JSON.stringify(apiPkg, null, 2) + '\n')
// The monorepo lockfile does not know about these rewritten file: links —
// keeping it in the stage is what crashes npm 10 (arborist edgesOut).
rmSync(join(STAGE, 'apps', 'api', 'package-lock.json'), { force: true })

cpSync(findBunExe(), join(STAGE, 'bun.exe'))

// Purge any runtime data (from a previous staged-server test run) — a release
// bundle must boot with an EMPTY world. The copy filter above already skips
// *.sqlite in the source; this covers files created inside STAGE itself.
for (const junk of ['orbit.snapshot.sqlite', 'orbit.snapshot.sqlite.tmp', 'blobs']) {
  rmSync(join(STAGE, 'apps', 'api', junk), { recursive: true, force: true })
}

console.log('[stage-api] installing production deps (this can take a minute)...')
// Prefer the staged bun: npm's arborist crashes on the rewritten file: links
// ("Cannot read properties of null (reading 'edgesOut')" on npm 10+), while
// `bun install --production` from the stage root links the staged workspaces
// in seconds. Fall back to npm only when no bun binary is present.
const { renameSync } = require('node:fs')
const rootLock = join(ROOT, 'package-lock.json')
const lockBak = rootLock + '.stage-bak'
let lockHidden = false
const bunBin = join(STAGE, 'bun.exe')
try {
  if (existsSync(rootLock)) { renameSync(rootLock, lockBak); lockHidden = true }
  let installed = false
  if (existsSync(bunBin)) {
    try {
      execFileSync(bunBin, ['install', '--production'], { cwd: STAGE, stdio: 'inherit' })
      installed = true
    } catch { /* fall through to npm below */ }
  }
  if (!installed) {
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false', '--no-package-lock'], {
      cwd: join(STAGE, 'apps', 'api'),
      stdio: 'inherit',
      shell: true, // npm is a .cmd shim on Windows
      env: { ...process.env, NODE_ENV: 'development' },
    })
  }
} finally {
  if (lockHidden) { try { renameSync(lockBak, rootLock) } catch { /* restore manually */ } }
}

// packages/shared/src/index.ts imports ../../../shared/blocklist.json, which
// only resolves when @orbit/shared stays a symlink (dev, smoke). npm's file:
// install PHYSICALLY COPIES it into node_modules, so inside the packaged
// bundle ../../../shared lands on node_modules/shared. Mirror it there.
if (existsSync(join(STAGE, 'apps', 'api', 'node_modules', '@orbit', 'shared'))) {
  cpSync(join(STAGE, 'shared'), join(STAGE, 'apps', 'api', 'node_modules', 'shared'), { recursive: true })
}

// Smoke check: the staged server's module graph must fully resolve. bun build
// imports nothing at runtime — it only walks the dependency graph — so the
// noble-drop regression ("Cannot find module '@noble/curves/ed25519'", which
// only surfaced at first upload/PM) fails the BUILD instead.
console.log('[stage-api] verifying staged server modules resolve...')
const smokeOut = join(STAGE, 'apps', 'api', '.stage-smoke.js')
try {
  execFileSync(join(STAGE, 'bun.exe'), ['build', 'src/serve.ts', '--target=bun', '--outfile', '.stage-smoke.js'], {
    cwd: join(STAGE, 'apps', 'api'),
    stdio: 'inherit',
    timeout: 120_000,
  })
} catch {
  console.error('[stage-api] staged server has unresolved modules — refusing to package a dead bundle')
  process.exit(1)
} finally {
  rmSync(smokeOut, { force: true })
}

console.log('[stage-api] done →', STAGE)
