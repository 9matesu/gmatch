'use strict'
// Sidecar supervisor: debounced health probes, reset on success, and stopping
// the old process before a restart (no EADDRINUSE).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  createSidecarSupervisor,
  SIDECAR_BACKOFF_MS,
  SIDECAR_MAX_RESTARTS,
  FAILS_BEFORE_RESTART,
} = require('./sidecarSupervision.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function harness(pingImpl, { running = false } = {}) {
  const calls = { starts: 0, stops: 0, pings: 0 }
  const order = []
  const apiSidecar = {
    ping: async (ms) => {
      calls.pings += 1
      return pingImpl(ms)
    },
    isRunning: () => running,
    stopApi: () => {
      calls.stops += 1
      order.push('stop')
    },
    startApi: async () => {
      calls.starts += 1
      order.push('start')
      return true
    },
  }
  const logs = []
  const sup = createSidecarSupervisor({ apiSidecar, log: (l) => logs.push(l), onError: () => {} })
  sup.markHealthy()
  return { sup, calls, order, logs }
}

test('backoff is bounded and starts small', () => {
  assert.ok(SIDECAR_MAX_RESTARTS >= 1)
  assert.ok(SIDECAR_BACKOFF_MS.length >= 3)
  assert.ok(SIDECAR_BACKOFF_MS[0] <= 2000)
  for (let i = 1; i < SIDECAR_BACKOFF_MS.length; i++) {
    assert.ok(SIDECAR_BACKOFF_MS[i] >= SIDECAR_BACKOFF_MS[i - 1])
  }
  assert.ok(FAILS_BEFORE_RESTART >= 2, 'a single slow probe must not restart')
})

test('two failed probes then a success -> no restart (debounce)', async () => {
  let healthy = false
  const { sup, calls } = harness(() => Promise.resolve(healthy))
  await sup._probe() // fail 1
  healthy = true
  await sup._probe() // success clears the streak
  await sup._probe() // fail 1 again
  await sup._probe() // fail 2 again
  await sleep(SIDECAR_BACKOFF_MS[0] + 150)
  assert.strictEqual(calls.starts, 0, 'never restarted without N consecutive fails')
})

test('N consecutive failed probes -> one restart, old process stopped first', async () => {
  const { sup, calls, order } = harness(() => Promise.resolve(false), { running: true })
  for (let i = 0; i < FAILS_BEFORE_RESTART; i++) await sup._probe()
  await sleep(SIDECAR_BACKOFF_MS[0] + 200)
  assert.strictEqual(calls.starts, 1)
  assert.strictEqual(calls.stops, 1, 'stop the hung child before starting a new one')
  assert.deepStrictEqual(order, ['stop', 'start'], 'no second sidecar against :8790')
})

test('a crash restarts immediately (no debounce)', async () => {
  const { sup, calls } = harness(() => Promise.resolve(true))
  sup.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 200)
  assert.strictEqual(calls.starts, 1)
})