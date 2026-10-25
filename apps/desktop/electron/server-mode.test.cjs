// Standalone test for the packaged server-mode file layer
// (run: node electron/server-mode.test.cjs). Not part of `npm run test` —
// electron/*.test.cjs have no vitest runner (AGENTS.md).
//
// Covers the bug that made a working install look empty: a stored client
// pointer to a world that is not this install's. Two shapes, two rules:
//   * written by an OLDER app (no version stamp) -> never dialed, kept paused
//     (the old deployment can still answer /api/health and still be wrong);
//   * written by THIS app (v2) -> health-checked, paused when it goes silent.
const assert = require('assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-server-mode-'))
// server-mode.cjs asks electron for userData; only getPath is used.
const fakeElectron = { app: { getPath: () => dir } }
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron
  return originalLoad.call(this, request, parent, isMain)
}
const serverMode = require('./server-mode.cjs')
const configFile = () => path.join(dir, 'server-mode.json')
const write = (value) => fs.writeFileSync(configFile(), JSON.stringify(value))
const read = () => JSON.parse(fs.readFileSync(configFile(), 'utf8'))

const HOST = 'http://127.0.0.1:8790'
const okFetch = async () => ({ ok: true, json: async () => ({ status: 'ok', mode: 'legacy' }) })

async function main() {
  // ---- an older app's pointer is paused WITHOUT being dialed ----
  // This is the exact field case: the old hosted node still answered health,
  // so a probe-based rule left the user in someone else's empty world.
  write({ mode: 'client', url: 'https://old-world.example.test' })
  let dialed = 0
  const counted = async () => {
    dialed++
    return okFetch()
  }
  const legacy = await serverMode.revalidateServerMode({ fetchImpl: counted })
  assert.strictEqual(dialed, 0, 'a legacy pointer is never dialed, even if it would answer')
  assert.deepStrictEqual(legacy, {
    mode: 'host',
    url: HOST,
    pausedUrl: 'https://old-world.example.test',
    pausedReason: 'legacy',
  })
  const paused = read()
  assert.strictEqual(paused.mode, 'client', 'the address is kept on disk')
  assert.strictEqual(paused.url, 'https://old-world.example.test')
  assert.strictEqual(paused.paused, true)
  assert.strictEqual(paused.pausedReason, 'legacy')
  assert.strictEqual(paused.v, 2)
  const effective = serverMode.readServerMode()
  assert.strictEqual(effective.mode, 'host')
  assert.strictEqual(effective.url, HOST)
  assert.strictEqual(effective.pausedUrl, 'https://old-world.example.test')
  assert.strictEqual(effective.pausedReason, 'legacy')

  // ---- a paused pointer is sticky: no probe on later launches ----
  dialed = 0
  assert.strictEqual(await serverMode.revalidateServerMode({ fetchImpl: counted }), null)
  assert.strictEqual(dialed, 0)
  assert.strictEqual(serverMode.readServerMode().mode, 'host')

  // ---- a v2 pointer this app wrote IS health-checked ----
  write({ mode: 'client', url: 'http://friend:8790', v: 2 })
  let checked = 0
  const countedFail = async () => {
    checked++
    throw new Error('EHOSTUNREACH')
  }
  const lost = await serverMode.revalidateServerMode({ fetchImpl: countedFail })
  assert.strictEqual(checked, 1, 'a v2 pointer is probed once per launch')
  assert.deepStrictEqual(lost, {
    mode: 'host',
    url: HOST,
    pausedUrl: 'http://friend:8790',
    pausedReason: 'unreachable',
  })
  assert.strictEqual(read().pausedReason, 'unreachable')
  assert.strictEqual(serverMode.readServerMode().pausedReason, 'unreachable')

  // ---- a live v2 node stays the destination and is restamped ----
  write({ mode: 'client', url: 'http://friend:8790', v: 2 })
  assert.strictEqual(await serverMode.revalidateServerMode({ fetchImpl: okFetch }), null)
  assert.deepStrictEqual(read(), { mode: 'client', url: 'http://friend:8790', v: 2 })
  assert.deepStrictEqual(serverMode.readServerMode(), { mode: 'client', url: 'http://friend:8790' })

  // ---- writing a new choice clears any pause ----
  serverMode.writeServerMode('client', 'http://friend:8790')
  assert.deepStrictEqual(read(), { mode: 'client', url: 'http://friend:8790', v: 2 })
  assert.strictEqual(serverMode.readServerMode().pausedUrl, undefined)
  serverMode.writeServerMode('host', '')
  assert.strictEqual(serverMode.readServerMode().mode, 'host')

  // ---- the courier is infrastructure, never a destination ----
  write({ mode: 'client', url: 'https://gmatch.pages.dev', v: 2 })
  assert.strictEqual(serverMode.readServerMode().mode, 'host')
  assert.strictEqual(serverMode.readServerMode().pausedUrl, undefined)
  // ...and a legacy pointer at a courier is dropped quietly (no banner).
  write({ mode: 'client', url: 'https://gmatch.pages.dev' })
  assert.strictEqual(await serverMode.revalidateServerMode({ fetchImpl: counted }), null)
  assert.deepStrictEqual(read(), { mode: 'host', url: '', v: 2 })
  assert.strictEqual(serverMode.readServerMode().pausedUrl, undefined)

  // ---- Settings -> Reconnect asks health, not TCP ----
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push([url, init && init.headers && init.headers.accept])
    return { ok: true, json: async () => ({ status: 'ok' }) }
  }
  try {
    assert.deepStrictEqual(await serverMode.probeServer('http://friend:8790'), { ok: true })
    assert.strictEqual(seen[0][0], 'http://friend:8790/api/health')
    assert.strictEqual(seen[0][1], 'application/json')
    assert.strictEqual((await serverMode.probeServer('not a url')).ok, false, 'garbage is not probed')
  } finally {
    globalThis.fetch = originalFetch
  }

  Module._load = originalLoad
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('server-mode: all assertions passed')
}

main().catch((err) => {
  Module._load = originalLoad
  console.error(err)
  process.exit(1)
})
