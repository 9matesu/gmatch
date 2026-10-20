// Standalone test for the updater wiring (run: node electron/updater.test.cjs).
// Uses a local http server as the release feed (GMATCH_RELEASE_URL insecure
// override, by design the same hook the smoke test uses) and a stubbed spawnFn
// so no real cmd.exe is ever launched. Covers: happy path + verification,
// missing asset (404), interrupted download, size mismatch, hash mismatch,
// 503 cold start, repeated checks not re-downloading, install single-flight,
// the hidden-window spawn options, and never executing an unverified file.
const assert = require('assert')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { createUpdater } = require('./updater.cjs')

const NEW_EXE = Buffer.alloc(4096, 7)
const NEW_SHA = crypto.createHash('sha256').update(NEW_EXE).digest('hex')
const WRONG_SHA = crypto.createHash('sha256').update(Buffer.alloc(8, 1)).digest('hex')

function makeFeedServer() {
  let server
  const hits = { exe: 0 }
  const port = () => server.address().port
  const json = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    const dl = (file) => `http://127.0.0.1:${port()}/${file}`
    switch (url) {
      case '/ok.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: NEW_SHA, sizeBytes: NEW_EXE.length, downloadUrl: dl('exe') })
      case '/missing.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: NEW_SHA, sizeBytes: NEW_EXE.length, downloadUrl: dl('missing') })
      case '/corrupt.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: WRONG_SHA, sizeBytes: NEW_EXE.length, downloadUrl: dl('exe') })
      case '/cut.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: NEW_SHA, sizeBytes: NEW_EXE.length, downloadUrl: dl('cut') })
      case '/size.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: NEW_SHA, sizeBytes: 999999, downloadUrl: dl('exe') })
      case '/nohash.json':
        return json(res, { file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', downloadUrl: dl('exe') })
      case '/exe':
        hits.exe += 1
        res.writeHead(200, { 'content-length': String(NEW_EXE.length), 'content-type': 'application/octet-stream' })
        return res.end(NEW_EXE)
      case '/missing':
        res.writeHead(404, { 'content-type': 'text/plain' })
        return res.end('gone')
      case '/cut':
        res.writeHead(200, { 'content-length': String(NEW_EXE.length), 'content-type': 'application/octet-stream' })
        res.write(NEW_EXE.subarray(0, 100))
        return setTimeout(() => res.destroy(), 10)
      case '/503.json':
        res.writeHead(503, { 'content-type': 'text/plain' })
        return res.end('asleep')
      default:
        res.writeHead(404)
        return res.end('no route')
    }
  })
  return { server, hits, port }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-updater-test-'))
  const userDir = path.join(tmp, 'user')
  fs.mkdirSync(userDir, { recursive: true })
  const tempDir = path.join(tmp, 'temp')
  fs.mkdirSync(tempDir, { recursive: true })
  process.env.PORTABLE_EXECUTABLE_FILE = path.join(userDir, 'gMatch-1.0.0-portable.exe')

  const { server, hits, port } = makeFeedServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const makeApp = () => {
    const app = {
      version: '1.0.0',
      quits: 0,
      getVersion: () => app.version,
      getPath: (name) => (name === 'temp' ? tempDir : path.join(tmp, 'userData')),
      quit: () => { app.quits += 1 },
    }
    return app
  }
  const makeUpdater = (feedPath, spawnStub) => {
    process.env.GMATCH_RELEASE_URL = `http://127.0.0.1:${port()}${feedPath}`
    const app = makeApp()
    const updater = createUpdater({ app, webContents: () => [], log: () => {}, spawnFn: spawnStub })
    return { updater, app }
  }
  const waitFor = async (updater, predicate, label, timeoutMs = 5000) => {
    const started = Date.now()
    for (;;) {
      const state = updater.getState()
      if (predicate(state)) return state
      if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}; state=${JSON.stringify(state)}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  const leftovers = () => fs.readdirSync(userDir).filter((f) => f.endsWith('.part'))
  const downloadedExists = () => fs.existsSync(path.join(userDir, 'gMatch-9.9.9-portable.exe'))

  try {
    // 1) Happy path: check -> available -> auto-download -> verified ready.
    const exeHitsBefore = hits.exe
    const good = makeUpdater('/ok.json')
    await good.updater.check(true)
    const ready = await waitFor(good.updater, (s) => s.phase === 'ready', 'ready (ok.json)')
    assert.strictEqual(ready.verified, true, 'published hash verified')
    assert.strictEqual(ready.version, '9.9.9')
    assert.ok(fs.readFileSync(ready.destPath).equals(NEW_EXE), 'downloaded bytes are exact')
    assert.strictEqual(hits.exe - exeHitsBefore, 1, 'exe downloaded exactly once')

    // 2) Repeated checks while ready do not re-download the same version.
    await good.updater.check(false)
    await good.updater.check(false)
    const still = await waitFor(good.updater, (s) => s.phase === 'ready', 'still ready after re-checks')
    assert.strictEqual(still.destPath, ready.destPath)
    assert.strictEqual(hits.exe - exeHitsBefore, 1, 'no re-download on repeated checks')

    // 3) Install: hidden-window options, single-flight, quits exactly once.
    const spawns = []
    const stub = (...args) => { spawns.push(args); return { unref() {} } }
    const installer = makeUpdater('/ok.json', stub)
    await installer.updater.check(true)
    await waitFor(installer.updater, (s) => s.phase === 'ready', 'ready for install')
    const first = installer.updater.install()
    assert.strictEqual(first.ok, true)
    const second = installer.updater.install()
    assert.strictEqual(second.ok, false)
    assert.match(second.error, /already installing/)
    assert.strictEqual(spawns.length, 1, 'exactly one cmd.exe handed the swap')
    const [exe, argv, opts] = spawns[0]
    assert.strictEqual(exe, 'cmd.exe')
    assert.strictEqual(argv[0], '/c')
    assert.strictEqual(opts.windowsHide, true, 'hidden console for the batch')
    assert.strictEqual(opts.detached, undefined, 'detached removed: a detached cmd has no console, so its console-exe children flash their own')
    assert.strictEqual(opts.stdio, 'ignore')
    assert.strictEqual(installer.app.quits, 1, 'app asked to quit exactly once')
    const script = fs.readFileSync(path.join(tempDir, 'gmatch-update.cmd'), 'utf8')
    assert.match(script, /if %TRIES% GEQ 30 goto giveup/)
    assert.match(script, /ping -n %WAIT% 127\.0\.0\.1 >nul/)

    // 4) Never execute an unverified artifact (feed publishes no hash).
    const spawnsBefore = spawns.length
    const nohash = makeUpdater('/nohash.json', stub)
    await nohash.updater.check(true)
    const unverified = await waitFor(nohash.updater, (s) => s.phase === 'ready', 'ready without hash')
    assert.strictEqual(unverified.verified, false)
    const refused = nohash.updater.install()
    assert.strictEqual(refused.ok, false)
    assert.match(refused.error, /not verified/)
    assert.strictEqual(spawns.length, spawnsBefore, 'refusal spawns nothing')
    assert.strictEqual(nohash.app.quits, 0, 'refusal never quits the app')

    // 5) Missing asset (404 download): terminal error, nothing left behind.
    const missing = makeUpdater('/missing.json')
    await missing.updater.check(true)
    const missState = await waitFor(missing.updater, (s) => s.phase === 'error', 'error (missing asset)')
    assert.match(missState.error, /404/)
    assert.strictEqual(leftovers().length, 0, 'no .part left')
    assert.strictEqual(downloadedExists(), false, 'no partial install')

    // 6) Hash mismatch: discarded, never ready.
    const corrupt = makeUpdater('/corrupt.json')
    await corrupt.updater.check(true)
    const corruptState = await waitFor(corrupt.updater, (s) => s.phase === 'error', 'error (hash mismatch)')
    assert.match(corruptState.error, /sha256 mismatch/)
    assert.strictEqual(downloadedExists(), false)

    // 7) Interrupted download: connection cut mid-stream -> error + cleanup.
    const cut = makeUpdater('/cut.json')
    await cut.updater.check(true)
    const cutState = await waitFor(cut.updater, (s) => s.phase === 'error', 'error (interrupted download)')
    assert.ok(cutState.error.length > 0)
    assert.strictEqual(leftovers().length, 0, '.part cleaned after interruption')

    // 8) Published size mismatch: discarded before install can happen.
    const size = makeUpdater('/size.json')
    await size.updater.check(true)
    const sizeState = await waitFor(size.updater, (s) => s.phase === 'error', 'error (size mismatch)')
    assert.match(sizeState.error, /size/)
    assert.strictEqual(leftovers().length, 0)

    // 9) 503 feed (cold-start dyno): friendly error, not a dead-link claim.
    const cold = makeUpdater('/503.json')
    await cold.updater.check(true)
    const coldState = await waitFor(cold.updater, (s) => s.phase === 'error', 'error (503 feed)')
    assert.match(coldState.error, /503/)
    assert.match(coldState.error, /waking up/)
  } finally {
    server.close()
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  console.log('updater.test.cjs: all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
