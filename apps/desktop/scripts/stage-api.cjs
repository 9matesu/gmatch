// Stages a SELF-CONTAINED API server for packaging (1.0: no central server —
// every copy ships the server; friends connect to one chosen host).
// Output: <repo>/api-stage/
//   apps/api/          source + package.json (deps rewritten to file: links)
//   packages/crypto/   + packages/shared/ (vendored @orbit/* sources)
//   bun / bun.exe      the runtime (copied from the local bun install)
// Then `npm install --omit=dev` inside apps/api makes it run with zero repo.
//
// Run: node scripts/stage-api.cjs (from apps/desktop)
const { existsSync, mkdirSync, cpSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')
const { execFileSync } = require('node:child_process')

const ROOT = join(__dirname, '..', '..', '..')
const STAGE = join(ROOT, 'api-stage')
const IS_WIN = process.platform === 'win32'
const BUN_NAME = IS_WIN ? 'bun.exe' : 'bun'

/** Where a bun install could live. Home is always os.homedir(); Windows-only
 *  env vars are consulted only on Windows and a hardcoded drive letter is
 *  never assumed. */
function bunCandidates() {
  const home = homedir()
  const candidates = [join(ROOT, BUN_NAME), join(home, '.bun', 'bin', BUN_NAME)]
  if (IS_WIN) {
    candidates.push(join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'))
    candidates.push(join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'))
    if (process.env.PREFIX) candidates.push(join(process.env.PREFIX, 'node_modules', 'bun', 'bin', 'bun.exe'))
  } else {
    const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share')
    candidates.push(join(dataHome, 'npm', 'node_modules', 'bun', 'bin', 'bun'))
    candidates.push(join(home, '.npm-global', 'bin', 'bun'))
    if (process.env.PREFIX) candidates.push(join(process.env.PREFIX, 'node_modules', 'bun', 'bin', 'bun'))
  }
  // Authoritative global root (npm root -g works on runners + dev boxes).
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim()
    if (globalRoot) {
      candidates.push(join(globalRoot, 'bun', 'bin', BUN_NAME))
      // Legacy npm installs used bun.exe even on non-Windows hosts.
      if (!IS_WIN) candidates.push(join(globalRoot, 'bun', 'bin', 'bun.exe'))
    }
  } catch { /* npm not on PATH */ }
  return candidates.filter(Boolean)
}

function findBun() {
  // Explicit override (CI can pin it): GMATCH_BUN_EXE=path/to/bun[.exe]
  if (process.env.GMATCH_BUN_EXE && existsSync(process.env.GMATCH_BUN_EXE)) {
    return process.env.GMATCH_BUN_EXE
  }
  for (const c of bunCandidates()) if (existsSync(c)) return c
  // Last resort: resolve bun from PATH (npm -g shims may put it there).
  try {
    const out = execFileSync(IS_WIN ? 'where.exe' : 'which', [BUN_NAME], { encoding: 'utf8' }).trim()
    const first = out.split(/\r?\n/)[0].trim()
    if (first && existsSync(first)) return first
  } catch {
    /* not on PATH */
  }
  console.error(`[stage-api] bun not found in standard locations (looked for ${BUN_NAME}).`)
  console.error('[stage-api] Install it first:  npm i -g --allow-scripts=bun bun')
  process.exit(1)
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(join(STAGE, 'apps', 'api'), { recursive: true })
mkdirSync(join(STAGE, 'shared'), { recursive: true })

const bunExe = findBun()
cpSync(bunExe, join(STAGE, BUN_NAME))
// The packaged sidecar looks for api/bun.exe (electron/apiSidecar.cjs). Keep
// that name on every OS so one staged layout works cross-platform; the bytes
// are the platform's real bun binary regardless of the filename.
if (BUN_NAME !== 'bun.exe') cpSync(bunExe, join(STAGE, 'bun.exe'))

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
