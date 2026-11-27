// End-to-end verification of the update swap on THIS machine
// (run: node electron/updater-swap.e2e.cjs).
//
// Windows: A/B prove why cmd.exe must be spawned WITHOUT `detached` (a
// detached cmd has no console, so its console-exe children allocate their own
// visible window). C runs the real updater against a local feed with a locked
// target and checks the swap log and bytes. The relaunch target is a harmless
// console tool (where.exe) instead of a 96 MB app.
//
// Linux/macOS: the POSIX script is executed by /bin/sh and must replace the
// portable AppImage with verified bytes, then signal its (neutralized)
// relaunch. No console/window concept exists there.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { spawn, execSync } = require('child_process')

/** No hardcoded drive letter: derive the Windows root from SystemRoot/windir
 *  or from the drive Electron itself is running on. */
const whereExe = () => path.join(
  process.env.SystemRoot || process.env.windir || path.join(path.parse(process.execPath).root, 'Windows'),
  'System32', 'where.exe',
)

/** New console processes with a VISIBLE window (non-zero MainWindowHandle). */
const PS_VISIBLE = path.join(os.tmpdir(), 'gmatch-visible-consoles.ps1')
const PS_ALL = path.join(os.tmpdir(), 'gmatch-console-ids.ps1')
fs.writeFileSync(PS_VISIBLE, [
  "Get-Process cmd,ping -ErrorAction SilentlyContinue |",
  "  Where-Object { $_.MainWindowHandle -ne 0 } |",
  "  ForEach-Object { \"$($_.Id):$($_.ProcessName)\" }",
].join("\r\n"))
fs.writeFileSync(PS_ALL, [
  "Get-Process cmd,ping -ErrorAction SilentlyContinue |",
  "  ForEach-Object { $_.Id }",
].join("\r\n"))

function visibleConsoles() {
  try {
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_VISIBLE}"`, { encoding: 'utf8' })
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function processIds() {
  try {
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_ALL}"`, { encoding: 'utf8' })
    return new Set(out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function spawnBatch(detached) {
  const before = processIds()
  const child = spawn('cmd.exe', ['/c', 'ping -n 4 127.0.0.1 >nul'], {
    stdio: 'ignore',
    windowsHide: true,
    ...(detached ? { detached: true } : {}),
  })
  child.unref()
  const seen = new Set()
  for (let i = 0; i < 12; i += 1) {
    await sleep(250)
    for (const entry of visibleConsoles()) {
      const pid = entry.split(':')[0]
      if (!before.has(pid)) seen.add(entry)
    }
  }
  return [...seen]
}

async function phaseA() {
  const visible = await spawnBatch(false)
  console.log(`[A] windowsHide WITHOUT detached -> visible consoles: ${visible.length} ${JSON.stringify(visible)}`)
  assert.strictEqual(visible.length, 0, 'a hidden (non-detached) cmd must not show any console window')
}

async function phaseB() {
  const visible = await spawnBatch(true)
  console.log(`[B] detached + windowsHide -> visible consoles: ${visible.length} ${JSON.stringify(visible)}`)
  assert.ok(visible.length > 0, 'a DETACHED cmd has no console: its console children must show one (the old bug)')
}

async function phaseC() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-swap-'))
  const payload = path.join(tmp, 'gMatch-9.9.9-portable.exe')
  fs.copyFileSync(whereExe(), payload)
  const bytes = fs.readFileSync(payload)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')

  const target = path.join(tmp, 'gMatch-1.6.0-portable.exe')
  fs.copyFileSync(whereExe(), target) // the "installed" app

  let server
  const base = () => `http://127.0.0.1:${server.address().port}`
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/gMatch-')) {
      res.writeHead(200, { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' })
      return res.end(bytes)
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      file: 'gMatch-9.9.9-portable.exe',
      version: '9.9.9',
      sha256,
      sizeBytes: bytes.length,
      downloadUrl: `${base()}/gMatch-9.9.9-portable.exe`,
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  process.env.GMATCH_RELEASE_URL = `http://127.0.0.1:${server.address().port}/release.json`
  process.env.PORTABLE_EXECUTABLE_FILE = target

  const { createUpdater } = require('./updater.cjs')
  const app = {
    getVersion: () => '1.6.0',
    getPath: (name) => (name === 'temp' ? path.join(tmp, 'temp') : path.join(tmp, 'userData')),
    quit: () => { app.quitCalled = true },
  }
  fs.mkdirSync(path.join(tmp, 'temp'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'userData'), { recursive: true })

  const updater = createUpdater({ app, webContents: () => [], log: (line) => console.log(`    ${line}`) })
  await updater.check(true)
  let state = updater.getState()
  for (let i = 0; i < 100 && state.phase !== 'ready'; i += 1) {
    await sleep(50)
    state = updater.getState()
  }
  assert.strictEqual(state.phase, 'ready', `download failed: ${state.error || state.phase}`)
  console.log(`[C] downloaded + verified: ${state.verified === true} (${state.bytes} bytes)`)

  // Emulate the antivirus scan: hold the target file open so `move` cannot
  // replace it, then release it a few seconds later. The retry loop must
  // survive that instead of giving up.
  const lock = fs.openSync(target, 'r+')
  const before = processIds()
  const visibleSeen = new Set()
  const result = updater.install()
  assert.strictEqual(result.ok, true, `install refused: ${result.error || ''}`)

  const logPath = path.join(tmp, 'userData', 'main.log')
  const readLog = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '')
  const started = Date.now()
  const releaseAt = started + 10000
  let released = false
  let finished = false
  let lastConsoleCheck = 0
  // The batch owns the timeline (up to 30 tries with backoff): wait for IT to
  // report "finished", not for our own guess.
  while (Date.now() - started < 240000) {
    if (!released && Date.now() >= releaseAt) {
      fs.closeSync(lock)
      released = true
    }
    if (Date.now() - lastConsoleCheck > 2000) {
      lastConsoleCheck = Date.now()
      for (const entry of visibleConsoles()) {
        const pid = entry.split(':')[0]
        if (!before.has(pid)) visibleSeen.add(entry)
      }
    }
    if (/finished Tries=/.test(readLog())) { finished = true; break }
    await sleep(500)
  }
  if (!released) { fs.closeSync(lock); released = true }

  const log = readLog()
  const replaced = fs.existsSync(target) && fs.readFileSync(target).equals(bytes)
  console.log(`[C] visible consoles during swap: ${visibleSeen.size} ${JSON.stringify([...visibleSeen])}`)
  console.log(`[C] swap log:\n${log.split(/\r?\n/).filter(Boolean).map((l) => `      ${l}`).join('\n')}`)
  assert.strictEqual(visibleSeen.size, 0, 'the swap must not show a console window')
  assert.ok(finished, `the batch never finished:\n${log}`)
  assert.ok(replaced, 'the target file was never replaced (retry/backoff failed)')
  const tries = Number(/finished Tries=(\d+)/.exec(log)[1])
  assert.ok(tries >= 2, `the locked target should have forced a retry (tries=${tries})`)
  console.log(`[C] replaced after ${tries} attempt(s); visible consoles: ${visibleSeen.size}`)

  const logPath2 = path.join(tmp, 'userData', 'main.log')
  void logPath2
  server.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
}

async function phaseLinux() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-swap-linux-'))
  const { buildUpdaterScript } = require('./updater-core.cjs')
  const target = path.join(tmp, 'gMatch-1.6.0-portable.AppImage')
  const source = path.join(tmp, 'gMatch-9.9.9-portable.AppImage')
  const bytes = Buffer.from('PORTABLE-APPIMAGE-PAYLOAD-'.repeat(64))
  fs.writeFileSync(target, 'OLD-APPIMAGE')
  fs.writeFileSync(source, bytes)
  const logPath = path.join(tmp, 'main.log')
  const scriptPath = path.join(tmp, 'gmatch-update.sh')
  const marker = path.join(tmp, 'relaunched.txt')
  const script = buildUpdaterScript({ source, target, logPath, platform: 'linux' })
  // Neutralize the relaunch (we do not want to exec a fake AppImage).
  fs.writeFileSync(scriptPath, script.split(`'${target}' >/dev/null 2>&1 &`).join(`echo swapped > '${marker}'`))
  const child = spawn('/bin/sh', [scriptPath], { stdio: 'ignore' })
  child.unref()
  const started = Date.now()
  while (!fs.existsSync(marker) && Date.now() - started < 30000) await sleep(100)
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
  console.log(`[linux] swap log:\n${log.split('\n').filter(Boolean).map((l) => `      ${l}`).join('\n')}`)
  assert.ok(fs.existsSync(marker), 'the POSIX script relaunched (neutralized marker)')
  assert.ok(fs.readFileSync(target).equals(bytes), 'the target portable file was replaced with verified bytes')
  assert.ok(!fs.existsSync(source), 'the downloaded artifact was consumed by the move')
  assert.match(log, /finished Tries=/)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
}

async function main() {
  if (process.platform === 'win32') {
    await phaseA()
    await phaseB()
    await phaseC()
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    await phaseLinux()
  } else {
    console.log('updater-swap.e2e.cjs: unsupported platform, skipping')
    return
  }
  console.log('updater-swap.e2e.cjs: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
