// Standalone test for the packaged sidecar launcher
// (run: node electron/apiSidecar.test.cjs from apps/desktop).
//
// Regression it exists for: commit df1facd meant to inject the generated
// ADMIN_PIN only in packaged builds, but referenced a variable it never
// defined (`injectingPin`). That threw a ReferenceError BEFORE spawn, so every
// packaged host-mode launch — the default topology since 2026-10-21 — opened a
// window with no node behind it: empty feed, empty everything, while the local
// database sat there intact. No unit test ran this path, and `npm run lint`
// does not resolve identifiers here, so it shipped.
//
// Also pins the :8790 startup races: a healthy sidecar left by this install is
// adopted (never re-spawned into EADDRINUSE), a foreign node is never adopted,
// an occupied port is waited on instead of raced, and only one launch holds
// the exclusive lease.
const assert = require('assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const Module = require('node:module')
const { createApiLease } = require('./apiSidecarLease.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-sidecar-'))
const STORAGE_KEY = 'a'.repeat(64)
const INSTANCE_ID = crypto.createHash('sha256').update(STORAGE_KEY).digest('hex')
fs.writeFileSync(path.join(dir, 'storage.key'), STORAGE_KEY)

const originalLoad = Module._load
const originalFetch = globalThis.fetch
const originalResourcesPath = process.resourcesPath
const originalPort = process.env.GMATCH_API_PORT
const originalAdoptWait = process.env.GMATCH_ADOPT_WAIT_MS

function installStubs({ isPackaged, health, instanceId, onSpawn }) {
  const calls = []
  const child = {
    pid: 4242,
    stdout: { on() {} },
    stderr: { on() {} },
    on() {},
    kill() {},
  }
  const fakeElectron = { app: { isPackaged, getPath: () => dir } }
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron
    if (request === 'node:child_process') {
      return {
        spawn(command, args, options) {
          calls.push({ command, args, options })
          if (onSpawn) onSpawn()
          return child
        },
        execSync() {},
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  process.resourcesPath = path.join(dir, 'resources')
  globalThis.fetch = async () => {
    const h = typeof health === 'function' ? health() : health
    if (!h) return { ok: false, json: async () => ({}) }
    return { ok: true, json: async () => ({ db_ready: true, instance_id: instanceId || null }) }
  }
  return calls
}

function freshModule() {
  delete require.cache[require.resolve('./apiSidecar.cjs')]
  return require('./apiSidecar.cjs')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function main() {
  const port = await freePort()
  process.env.GMATCH_API_PORT = String(port)
  // Keep the "already starting" wait short for the occupied-port case.
  process.env.GMATCH_ADOPT_WAIT_MS = '300'

  // ---- packaged host mode: the bundled node MUST actually be spawned ----
  // main.cjs sets GMATCH_HOST_MODE=1 before calling this, which makes the
  // launch own its server instead of adopting a foreign one on :8790.
  process.env.GMATCH_HOST_MODE = '1'
  let healthy = false
  let calls = installStubs({
    isPackaged: true,
    health: () => healthy,
    instanceId: INSTANCE_ID,
    onSpawn: () => { healthy = true },
  })
  let sidecar = freshModule()
  const started = await sidecar.startApi()
  assert.strictEqual(started, true, 'a packaged launch reaches a healthy node')
  assert.strictEqual(calls.length, 1, 'exactly one spawn (no silent no-op)')
  const env = calls[0].options.env
  assert.match(env.ADMIN_PIN || '', /^[0-9a-f]{8}$/i, 'packaged installs mint and inject a PIN')
  assert.strictEqual(env.SNAPSHOT_PATH, path.join(dir, 'orbit.sqlite'))
  assert.strictEqual(env.BLOB_STORE_DIR, path.join(dir, 'blobs'))
  assert.match(env.STORAGE_ENCRYPTION_KEY || '', /^[0-9a-f]{64}$/i)
  assert.strictEqual(env.PORT, String(port))
  assert.strictEqual(
    env.GMATCH_INSTANCE_ID,
    INSTANCE_ID,
    'the node receives our install identity so a later launch can adopt it',
  )
  sidecar.stopApi()
  assert.strictEqual(
    fs.existsSync(path.join(dir, 'api-lease.json')),
    false,
    'stopping releases the launch lease',
  )
  delete process.env.GMATCH_HOST_MODE

  // ---- packaged host mode adopts THIS install's already-healthy node ----
  // A crash / restart with :8790 already answering used to spawn a duplicate
  // that died with EADDRINUSE and burned the restart budget.
  process.env.GMATCH_HOST_MODE = '1'
  calls = installStubs({ isPackaged: true, health: true, instanceId: INSTANCE_ID })
  sidecar = freshModule()
  assert.strictEqual(await sidecar.startApi(), true)
  assert.strictEqual(calls.length, 0, 'adopt instead of spawning against a bound port')
  delete process.env.GMATCH_HOST_MODE

  // ---- but never adopts a FOREIGN node on :8790 ----
  process.env.GMATCH_HOST_MODE = '1'
  calls = installStubs({ isPackaged: true, health: true, instanceId: 'f'.repeat(64) })
  sidecar = freshModule()
  await assert.rejects(() => sidecar.startApi(), /different node/)
  assert.strictEqual(calls.length, 0, 'a foreign node is never adopted or spawned into')
  delete process.env.GMATCH_HOST_MODE

  // ---- an occupied port with an unhealthy node is waited on, not raced ----
  process.env.GMATCH_HOST_MODE = '1'
  const occupant = net.createServer()
  await new Promise((resolve) => occupant.listen(port, '127.0.0.1', resolve))
  calls = installStubs({ isPackaged: true, health: false })
  sidecar = freshModule()
  await assert.rejects(() => sidecar.startApi(), /occupied/)
  assert.strictEqual(calls.length, 0, 'no second Bun against a bound :8790')
  await new Promise((resolve) => occupant.close(resolve))
  delete process.env.GMATCH_HOST_MODE

  // ---- unpackaged: never shadow apps/api/.env.local with a minted PIN ----
  calls = installStubs({ isPackaged: false, health: false })
  sidecar = freshModule()
  // Dev mode may adopt a healthy sidecar; a dead one forces the spawn path.
  // health=false above means the adopt probe fails; the wait loop would spin,
  // so assert on the spawn call instead of awaiting the full startup.
  const pending = sidecar.startApi()
  pending.catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.strictEqual(calls.length, 1, 'dev mode spawns when no sidecar answers')
  assert.strictEqual(
    calls[0].options.env.ADMIN_PIN,
    undefined,
    'dev mode lets .env.local own ADMIN_PIN',
  )
  sidecar.stopApi()
  pending.catch(() => {})

  // ---- the exclusive launch lease arbitrates two simultaneous callers ----
  const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-lease-'))
  const first = createApiLease({ directory: leaseDir, pid: 1001 })
  const second = createApiLease({ directory: leaseDir, pid: 1002, processImpl: { kill: () => {} } })
  assert.strictEqual(first.acquire('token') && first.read().pid, 1001)
  assert.strictEqual(second.acquire('other-token'), null, 'a second live launch never wins')
  assert.strictEqual(first.release('token'), true)
  assert.strictEqual(second.acquire('other-token') && second.read().pid, 1002, 'stale lease is reclaimed')
  assert.strictEqual(first.release('token'), false, 'a former owner cannot delete our lease')
  fs.rmSync(leaseDir, { recursive: true, force: true })

  // ---- and the module still exports the surface main.cjs expects ----
  const expected = [
    'API_BASE', 'PORT', 'isRunning', 'ping', 'sidecarEvents', 'startApi', 'stopApi',
    'instanceIdFor', 'probeHealth', 'portOccupied', 'waitForPortFree',
  ]
  assert.deepStrictEqual(Object.keys(sidecar).sort(), expected.sort())

  Module._load = originalLoad
  globalThis.fetch = originalFetch
  process.resourcesPath = originalResourcesPath
  if (originalPort === undefined) delete process.env.GMATCH_API_PORT
  else process.env.GMATCH_API_PORT = originalPort
  if (originalAdoptWait === undefined) delete process.env.GMATCH_ADOPT_WAIT_MS
  else process.env.GMATCH_ADOPT_WAIT_MS = originalAdoptWait
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('apiSidecar: all assertions passed')
  process.exit(0)
}

main().catch((err) => {
  Module._load = originalLoad
  globalThis.fetch = originalFetch
  process.resourcesPath = originalResourcesPath
  console.error(err)
  process.exit(1)
})
