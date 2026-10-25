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
const assert = require('assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-sidecar-'))
const originalLoad = Module._load
const originalFetch = globalThis.fetch
const originalResourcesPath = process.resourcesPath

function installStubs({ isPackaged, health }) {
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
          return child
        },
        execSync() {},
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  process.resourcesPath = path.join(dir, 'resources')
  globalThis.fetch = async () =>
    health
      ? { ok: true, json: async () => ({ db_ready: true }) }
      : { ok: false, json: async () => ({}) }
  return calls
}

function freshModule() {
  delete require.cache[require.resolve('./apiSidecar.cjs')]
  return require('./apiSidecar.cjs')
}

async function main() {
  // ---- packaged host mode: the bundled node MUST actually be spawned ----
  // main.cjs sets GMATCH_HOST_MODE=1 before calling this, which makes the
  // launch own its server instead of adopting a foreign one on :8790.
  process.env.GMATCH_HOST_MODE = '1'
  let calls = installStubs({ isPackaged: true, health: true })
  let sidecar = freshModule()
  const started = await sidecar.startApi()
  assert.strictEqual(started, true, 'a packaged launch reaches a healthy node')
  assert.strictEqual(calls.length, 1, 'exactly one spawn (no silent no-op)')
  const env = calls[0].options.env
  assert.match(env.ADMIN_PIN || '', /^[0-9a-f]{8}$/i, 'packaged installs mint and inject a PIN')
  assert.strictEqual(env.SNAPSHOT_PATH, path.join(dir, 'orbit.sqlite'))
  assert.strictEqual(env.BLOB_STORE_DIR, path.join(dir, 'blobs'))
  assert.match(env.STORAGE_ENCRYPTION_KEY || '', /^[0-9a-f]{64}$/i)
  assert.strictEqual(env.PORT, '8790')
  sidecar.stopApi()
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
  delete process.env.GMATCH_HOST_MODE

  // ---- and the module still exports the surface main.cjs expects ----
  assert.deepStrictEqual(Object.keys(sidecar).sort(), ['API_BASE', 'PORT', 'sidecarEvents', 'startApi', 'stopApi'].sort())

  Module._load = originalLoad
  globalThis.fetch = originalFetch
  process.resourcesPath = originalResourcesPath
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
