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
mkdirSync(join(STAGE, 'apps', 'api'), { recursive: true })
mkdirSync(join(STAGE, 'shared'), { recursive: true })

const bunExe = findBunExe()
cpSync(bunExe, join(STAGE, 'bun.exe'))

// Copy schema, migrations, and shared blocklist
cpSync(join(ROOT, 'apps', 'api', 'schema.sql'), join(STAGE, 'apps', 'api', 'schema.sql'))
if (existsSync(join(ROOT, 'apps', 'api', 'migrations'))) {
  cpSync(join(ROOT, 'apps', 'api', 'migrations'), join(STAGE, 'apps', 'api', 'migrations'), { recursive: true })
}
cpSync(join(ROOT, 'shared', 'blocklist.json'), join(STAGE, 'shared', 'blocklist.json'))

// Minimal package.json so Bun treats apps/api as an ES module project
writeFileSync(
  join(STAGE, 'apps', 'api', 'package.json'),
  JSON.stringify({ name: '@orbit/api', type: 'module' }, null, 2) + '\n'
)

console.log('[stage-api] bundling standalone API server (zero node_modules)...')
// Bundle the entire API server and all @orbit / @noble dependencies into one
// self-contained serve.js file. This eliminates node_modules, circular symlinks,
// and NSIS 7zip path errors completely.
const serveJs = join(STAGE, 'apps', 'api', 'serve.js')
try {
  execFileSync(bunExe, ['build', join(ROOT, 'apps', 'api', 'src', 'serve.ts'), '--target=bun', '--outfile', serveJs], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 120_000,
  })
} catch (err) {
  console.error('[stage-api] failed to bundle API server:', err)
  process.exit(1)
}

if (!existsSync(serveJs)) {
  console.error('[stage-api] bundled serve.js missing')
  process.exit(1)
}

console.log('[stage-api] done →', STAGE)
