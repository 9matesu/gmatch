// End-to-end smoke of the portable updater WITHOUT electron: local http
// server acts as the release feed, fake "user artifact" + fake app/webContents
// stubs drive createUpdater; then the generated swap script actually swaps
// the files. Runs on Windows (cmd.exe batch) and Linux/macOS (/bin/sh).
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomBytes, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const IS_WIN = process.platform === 'win32'
const EXT = IS_WIN ? 'exe' : 'AppImage'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-update-smoke-'))
const userArtifact = path.join(dir, `gMatch-1.1.4-portable.${EXT}`)
fs.writeFileSync(userArtifact, 'OLD-ARTIFACT-CONTENT-PAD'.repeat(64))
const fakeNew = Buffer.concat([Buffer.from(`NEW-v1.1.5!`), randomBytes(2 << 20)])
const sha = createHash('sha256').update(fakeNew).digest('hex')
const newName = `gMatch-1.1.5-portable.${EXT}`

const server = http.createServer((req, res) => {
  if (req.url === '/release.json') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ file: newName, version: '1.1.5', sha256: sha, downloadUrl: `http://127.0.0.1:${port}/releases/${newName}` }))
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
  process.env.PORTABLE_EXECUTABLE_FILE = userArtifact
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
  if (path.dirname(s.destPath) !== dir) { console.error('SMOKE FAIL: dest not next to user artifact:', s.destPath); process.exit(1) }
  const res = u.install()
  if (!res.ok) { console.error('SMOKE FAIL: install() refused:', res.error); process.exit(1) }
  // Run the handed-off script directly against the fake files (app already
  // "quit" in this simulation): it must replace userArtifact and relaunch it.
  const scriptPath = path.join(dir, IS_WIN ? 'gmatch-update.cmd' : 'gmatch-update.sh')
  const marker = path.join(dir, 'relaunched.txt')
  let script = fs.readFileSync(scriptPath, 'utf8')
  console.log('[smoke] script:\n' + script)
  // Neutralize the relaunch: starting a text file fails harmlessly.
  if (IS_WIN) {
    script = script.split(`start "" "${userArtifact}"`).join(`echo swapped > "${marker}"`)
  } else {
    script = script.split(`'${userArtifact}' >/dev/null 2>&1 &`).join(`echo swapped > '${marker}'`)
  }
  fs.writeFileSync(scriptPath, script)
  try {
    if (IS_WIN) execFileSync('cmd.exe', ['/c', scriptPath], { stdio: 'inherit', timeout: 60000 })
    else execFileSync('/bin/sh', [scriptPath], { stdio: 'inherit', timeout: 60000 })
  } catch (err) {
    console.log('[smoke] script exit status:', err.status)
  }
  const now = fs.readFileSync(userArtifact)
  const swapped = now.equals(fakeNew) && fs.existsSync(marker) && !fs.existsSync(s.destPath)
  console.log('[smoke] artifact swapped:', swapped ? 'OK' : 'FAIL', `(${now.length} bytes, marker=${fs.existsSync(marker)})`)
  // A non-zero exit from the script is EXPECTED: it deletes itself while the
  // synchronous caller still holds the handle. The real handoff happens after
  // app.quit(), so the swap itself is the assertion (bytes + marker + source
  // consumed), not the script's status.
  server.close()
  process.exit(swapped ? 0 : 1)
})
