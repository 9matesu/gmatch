'use strict'
// Management surface for the media suite: every install / start / stop / restart
// outcome is reported from what the main process actually did. The installer and
// sidecar are injected, so these tests need no network and no spawned Python.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const registerMediaqHandlers = require('./ipc/mediaq.cjs')

function harness(over = {}) {
  const handlers = new Map()
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) }
  const progress = []
  const event = { sender: { isDestroyed: () => false, send: (_ch, p) => progress.push(p) } }
  const calls = { install: 0, start: 0, stop: 0, ready: 0 }
  let installFail = null
  let startFail = null
  const installer = {
    mediaqStatus: async () => ({ installed: true, hasUv: true, bin: '/bin/mediaq' }),
    installMediaqSuite: async ({ onProgress }) => {
      calls.install += 1
      onProgress?.({ phase: 'download-uv', percent: 30, message: 'Downloading uv…' })
      if (installFail) throw installFail
      return { uv: '/bin/uv', bin: '/bin/mediaq' }
    },
    ...over.installer,
  }
  const sidecar = {
    BASE: 'http://127.0.0.1:8765',
    isHealthy: async () => false,
    startMediaq: async () => { calls.start += 1; if (startFail) throw startFail },
    stopMediaq: async () => { calls.stop += 1; return { stopped: true } },
    ...over.sidecar,
  }
  registerMediaqHandlers({
    ipcMain, installer, sidecar,
    getUserData: () => '/userData',
    mainLog: () => {},
    onReady: () => { calls.ready += 1 },
  })
  const invoke = (name, ...args) => {
    const fn = handlers.get(name)
    assert.ok(fn, `${name} handler is registered`)
    return fn(event, ...args)
  }
  return {
    invoke, progress, calls, sidecar,
    setInstallFail: (e) => { installFail = e },
    setStartFail: (e) => { startFail = e },
  }
}

test('install runs the full suite, starts the server and clears the clicker cooldown', async () => {
  const h = harness()
  const r = await h.invoke('mediaq:install')
  assert.deepEqual(r, { ok: true, bin: '/bin/mediaq', running: true })
  assert.equal(h.calls.install, 1)
  assert.equal(h.calls.start, 1)
  assert.equal(h.calls.ready, 1)
  assert.ok(h.progress.some((p) => p.phase === 'download-uv'))
  assert.equal(h.progress.at(-1).phase, 'done')
  assert.match(h.progress.at(-1).message, /ready/)
})

test('a failed install reports the real error and never claims readiness', async () => {
  const h = harness()
  h.setInstallFail(new Error('uv download HTTP 503'))
  const r = await h.invoke('mediaq:install')
  assert.deepEqual(r, { ok: false, error: 'uv download HTTP 503' })
  assert.equal(h.progress.at(-1).phase, 'error')
  assert.equal(h.progress.at(-1).message, 'uv download HTTP 503')
  assert.equal(h.calls.ready, 0)
})

test('retry after a failed install reports the new, successful outcome', async () => {
  const h = harness()
  h.setInstallFail(new Error('first attempt failed'))
  assert.equal((await h.invoke('mediaq:install')).ok, false)
  h.setInstallFail(null)
  const r = await h.invoke('mediaq:install')
  assert.equal(r.ok, true)
  assert.equal(r.running, true)
  assert.equal(h.calls.install, 2)
  assert.equal(h.calls.ready, 1, 'only the successful attempt re-arms the provider')
  assert.equal(h.progress.at(-1).phase, 'done')
})

test('installed but not launched is reported as such, not as a clean success', async () => {
  const h = harness()
  h.setStartFail(new Error('did not answer /health in time'))
  const r = await h.invoke('mediaq:install')
  assert.equal(r.ok, true)
  assert.equal(r.running, false)
  assert.equal(r.error, 'did not answer /health in time')
  assert.ok(h.progress.some((p) => p.phase === 'warn'))
  assert.match(h.progress.at(-1).message, /not running/)
  assert.equal(h.calls.ready, 0)
})

test('status reports installed, running and hasUv honestly, including probe errors', async () => {
  const h = harness()
  assert.deepEqual(await h.invoke('mediaq:status'), {
    installed: true, running: false, hasUv: true, base: 'http://127.0.0.1:8765',
  })
  const broken = harness({
    installer: { mediaqStatus: async () => { throw new Error('userData unreadable') } },
    sidecar: { isHealthy: async () => true, BASE: 'http://127.0.0.1:8765' },
  })
  const st = await broken.invoke('mediaq:status')
  assert.equal(st.installed, false)
  assert.equal(st.running, true, 'a healthy port is reported even when the installer probe fails')
  assert.equal(st.error, 'userData unreadable')
})

test('start reports missing install, success and failure without guessing', async () => {
  const missing = harness({ installer: { mediaqStatus: async () => ({ installed: false, bin: null }) } })
  assert.deepEqual(await missing.invoke('mediaq:start'), { ok: false, error: 'not-installed' })

  const h = harness()
  assert.deepEqual(await h.invoke('mediaq:start'), { ok: true, base: 'http://127.0.0.1:8765', running: true })
  assert.equal(h.calls.ready, 1)
  h.setStartFail(new Error('spawn ENOENT'))
  assert.deepEqual(await h.invoke('mediaq:start'), { ok: false, error: 'spawn ENOENT' })
})

test('stop verifies the port instead of claiming a stop that did not happen', async () => {
  const h = harness()
  assert.deepEqual(await h.invoke('mediaq:stop'), { ok: true, running: false, stopped: true })
  assert.equal(h.calls.stop, 1)

  const stubborn = harness({ sidecar: { isHealthy: async () => true, stopMediaq: async () => ({ stopped: false }) } })
  assert.deepEqual(await stubborn.invoke('mediaq:stop'), { ok: false, running: true, error: 'still-running' })
})

test('restart stops then starts, reports success and reports a failed relaunch', async () => {
  const h = harness()
  let r = await h.invoke('mediaq:restart')
  assert.equal(r.ok, true)
  assert.equal(r.running, true)
  assert.equal(h.calls.stop, 1, 'restart stops the old server first')
  assert.equal(h.calls.start, 1)
  assert.equal(h.calls.ready, 1)

  h.setStartFail(new Error('port busy'))
  r = await h.invoke('mediaq:restart')
  assert.deepEqual(r, { ok: false, error: 'port busy' })
})

test('cancel aborts an in-flight install and reports cancellation, not an error', async () => {
  const h = harness({ installer: {
    mediaqStatus: async () => ({ installed: false, bin: null }),
    installMediaqSuite: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('SIGKILL')), { once: true })
    }),
  } })
  const pending = h.invoke('mediaq:install')
  assert.deepEqual(await h.invoke('mediaq:cancel'), { ok: true })
  assert.deepEqual(await pending, { ok: false, cancelled: true })
  assert.equal(h.progress.at(-1).phase, 'cancelled')
})
