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

function harness(pingImpl, { running = false, portFree } = {}) {
  const calls = { starts: 0, stops: 0, pings: 0, portChecks: 0 }
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
    ...(portFree === undefined ? {} : {
      waitForPortFree: async () => {
        calls.portChecks += 1
        order.push('wait-port')
        return portFree
      },
    }),
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

test('a crash with :8790 answering is adopted, not restarted', async () => {
  // The adopted sidecar is not our child: a spawn would die on EADDRINUSE and
  // burn the budget while the app is served fine.
  const { sup, calls } = harness(() => Promise.resolve(true))
  sup.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 200)
  assert.strictEqual(calls.starts, 0, 'no spawn against a healthy :8790')
  assert.strictEqual(calls.stops, 0, 'nothing to stop')
})

test('a crash with nobody answering restarts immediately (no debounce)', async () => {
  const { sup, calls } = harness(() => Promise.resolve(false))
  sup.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 200)
  assert.strictEqual(calls.starts, 1)
})

test('a healthy answer cancels a restart already scheduled in backoff', async () => {
  // Race: three slow probes scheduled a restart; the node recovered during the
  // 1s backoff. The old timer still fired and killed a healthy sidecar.
  let healthy = false
  const { sup, calls, logs } = harness(() => Promise.resolve(healthy), { running: true })
  for (let i = 0; i < FAILS_BEFORE_RESTART; i++) await sup._probe()
  healthy = true
  await sup._probe()
  assert.ok(logs.some((l) => l.includes('pending restart cancelled')), 'cancellation is logged')
  await sleep(SIDECAR_BACKOFF_MS[0] + 250)
  assert.strictEqual(calls.starts, 0, 'no restart after recovery')
  assert.strictEqual(calls.stops, 0, 'a healthy child is never stopped')
})

test('a slow failure from before a recovery cannot seed a new streak', async () => {
  // Probes are serialised and generation-tagged: an in-flight ping that
  // settles after markHealthy() must not be counted as a fresh failure.
  let resolvePing
  let n = 0
  const { sup, calls } = harness(() => {
    n += 1
    if (n === 1) return new Promise((resolve) => { resolvePing = resolve })
    return Promise.resolve(true)
  })
  sup._probe() // slow, still in flight
  sup._probe() // must not start a second ping
  assert.strictEqual(calls.pings, 1, 'parallel probes are suppressed')
  sup.markHealthy() // node recovered by another route
  resolvePing(false)
  await sleep(20)
  for (let i = 0; i < FAILS_BEFORE_RESTART; i++) await sup._probe()
  await sleep(SIDECAR_BACKOFF_MS[0] + 200)
  assert.strictEqual(calls.starts, 0, 'no restart from the stale failure')
})

test('the port must be free before the replacement is spawned', async () => {
  const { sup, calls, order } = harness(() => Promise.resolve(false), { running: true, portFree: true })
  sup.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 250)
  assert.deepStrictEqual(order, ['stop', 'wait-port', 'start'], 'no spawn against a dying child')
  assert.strictEqual(calls.starts, 1)
})

test('a still-bound port retries instead of spawning into EADDRINUSE', async () => {
  const { sup, calls, logs } = harness(() => Promise.resolve(false), { running: true, portFree: false })
  sup.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 250)
  assert.strictEqual(calls.starts, 0, 'no spawn while :8790 is still bound')
  assert.ok(logs.some((l) => l.includes('still bound')))
})

test('a crash during a pending restart does not schedule a second one', async () => {
  const { sup, calls } = harness(() => Promise.resolve(false))
  for (let i = 0; i < FAILS_BEFORE_RESTART; i++) await sup._probe()
  sup.crashed(2)
  await sleep(SIDECAR_BACKOFF_MS[0] + 250)
  assert.strictEqual(calls.starts, 1, 'one restart in flight at a time')
})
