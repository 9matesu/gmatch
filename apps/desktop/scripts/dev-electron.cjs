// Dev inside the REAL Electron shell: boots vite, then an unpackaged Electron
// pointing at it (main.cjs honors VITE_DEV_SERVER_URL). The renderer then runs
// with every bridge the packaged exe has - gmcache://, vault://, booruFetch,
// native dialogs, imageCache IPC - so "works in dev" == "works in the exe".
// Usage: npm run dev:electron (Ctrl+C kills both).
const { spawn } = require('child_process')
const path = require('path')

const PORT = 5274
const url = `http://localhost:${PORT}`

const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(PORT), '--strictPort'],
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
  electron = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron', '.'],
    { stdio: 'inherit', cwd: __dirname + '/..', env: { ...process.env, VITE_DEV_SERVER_URL: url } },
  )
  electron.on('exit', () => { vite.kill(); process.exit(0) })
}, 400)

vite.on('exit', () => { if (electron) electron.kill(); process.exit(0) })
