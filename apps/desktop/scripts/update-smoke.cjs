// End-to-end smoke of the portable updater WITHOUT electron: local http
// server acts as the release feed, fake "user exe" + fake app/webContents
// stubs drive createUpdater; then the generated .cmd actually swaps files.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomBytes, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-update-smoke-'))
const userExe = path.join(dir, 'gMatch-1.1.4-portable.exe')
fs.writeFileSync(userExe, 'OLD-EXE-CONTENT-PAD'.repeat(64))
const fakeNew = Buffer.concat([Buffer.from('NEW-EXE-v1.1.5!'), randomBytes(2 << 20)])
const sha = createHash('sha256').update(fakeNew).digest('hex')

const server = http.createServer((req, res) => {
  if (req.url === '/release.json') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ file: 'gMatch-1.1.5-portable.exe', version: '1.1.5', sha256: sha, downloadUrl: `http://127.0.0.1:${port}/releases/gMatch-1.1.5-portable.exe` }))
    return
  }
  if (req.url.startsWith('/releases/')) {
    res.setHeader('content-length', String(fakeNew.length))
    res.end(fakeNew)
    return
  }
  res.statusCode = 404; res.end()
})
let port
const states = []
server.listen(0, '127.0.0.1', async () => {
  port = server.address().port
  process.env.GMATCH_RELEASE_URL = `http://127.0.0.1:${port}/release.json`
  process.env.PORTABLE_EXECUTABLE_FILE = userExe
  const { createUpdater } = require(path.join(process.cwd(), 'electron', 'updater.cjs'))
  const app = {
    getVersion: () => '1.1.4',
    getPath: (k) => (k === 'temp' ? dir : dir),
    quit: () => { console.log('[smoke] app.quit() called by install()') },
  }
  const u = createUpdater({ app, webContents: () => [{ send: (_ch, s) => states.push(s.phase) }], log: (l) => console.log('[log]', l) })
  await u.check(true)
  for (let i = 0; i < 200 && u.getState().phase !== 'ready'; i++) await new Promise((r) => setTimeout(r, 50))
  const s = u.getState()
  console.log('[smoke] phases:', [...new Set(states)].join('->'))
  console.log('[smoke] ready state:', { phase: s.phase, version: s.version, verified: s.verified, destPath: s.destPath && path.basename(s.destPath) })
  if (s.phase !== 'ready' || s.verified !== true) { console.error('SMOKE FAIL: never reached verified-ready'); process.exit(1) }
  if (path.dirname(s.destPath) !== dir) { console.error('SMOKE FAIL: dest not next to user exe:', s.destPath); process.exit(1) }
  const res = u.install()
  if (!res.ok) { console.error('SMOKE FAIL: install() refused:', res.error); process.exit(1) }
  // Run the handed-off script directly against the fake files (app already
  // "quit" in this simulation): it must replace userExe and relaunch it.
  const cmdPath = path.join(dir, 'gmatch-update.cmd')
  const marker = path.join(dir, 'relaunched.txt')
  // Neutralize the relaunch: 'start "" exe' on a text file fails harmlessly.
  let script = fs.readFileSync(cmdPath, 'utf8')
  console.log('[smoke] script:\n' + script)
  script = script.replace(`start "" "${userExe}"`, `echo swapped > "${marker}"`)
  fs.writeFileSync(cmdPath, script)
  try {
    execFileSync('cmd.exe', ['/c', cmdPath], { stdio: 'inherit', timeout: 60000 })
  } catch (err) {
    console.log('[smoke] cmd exit status:', err.status)
  }
  const now = fs.readFileSync(userExe)
  const swapped = now.equals(fakeNew) && fs.existsSync(marker) && !fs.existsSync(s.destPath)
  console.log('[smoke] exe swapped:', swapped ? 'OK' : 'FAIL', `(${now.length} bytes, marker=${fs.existsSync(marker)})`)
  // status 1 from cmd is EXPECTED: del "%~f0" removes the running .cmd under
  // itself while our synchronous execFileSync still holds the handle. The
  // real handoff is detached after app.quit(), so the swap itself is the
  // assertion (userExe bytes + marker + source consumed).
  server.close()
  process.exit(swapped ? 0 : 1)
})
