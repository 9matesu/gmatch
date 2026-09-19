// Dev inside the REAL Electron shell: boots vite, then an unpackaged Electron
// pointing at it (main.cjs honors VITE_DEV_SERVER_URL). The renderer then runs
// with every bridge the packaged exe has - gmcache://, vault://, booruFetch,
// native dialogs, imageCache IPC - so "works in dev" == "works in the exe".
// Usage: npm run dev:electron (Ctrl+C kills both).
const { spawn } = require('child_process')
const path = require('node:path')
const fs = require('node:fs')

const PORT = 5274
const url = `http://localhost:${PORT}`

// Spawn binaries directly through node/exe paths: npm .cmd shims can't be
// exec'd by child_process.spawn on current Node (EINVAL on win32 w/o shell).
function viteBin() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  ]
  const hit = candidates.find((c) => { try { return fs.existsSync(c) } catch { return false } })
  if (!hit) throw new Error('vite binary not found (run npm install from the repo root)')
  return hit
}

const vite = spawn(
  process.execPath,
  [viteBin(), '--port', String(PORT), '--strictPort'],
  { stdio: 'inherit', cwd: __dirname + '/..' },
)

let electron = null
const started = Date.now()
const poll = setInterval(async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
  } catch {
    if (Date.now() - started > 30_000) { clearInterval(poll); console.error('vite did not come up'); vite.kill(); process.exit(1) }
    return
  }
  clearInterval(poll)
  // require('electron') resolves to the real electron.exe path — no shim.
  let electronPath = null
  try { electronPath = require('electron') } catch { electronPath = null }
  if (typeof electronPath !== 'string' || !electronPath) {
    console.error('electron binary not found (run npm install from the repo root)')
    vite.kill()
    process.exit(1)
  }
  electron = spawn(
    electronPath,
    ['.'],
    { stdio: 'inherit', cwd: __dirname + '/..', env: { ...process.env, VITE_DEV_SERVER_URL: url } },
  )
  electron.on('exit', () => { vite.kill(); process.exit(0) })
}, 400)

vite.on('exit', () => { if (electron) electron.kill(); process.exit(0) })
