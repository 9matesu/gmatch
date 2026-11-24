'use strict'
// Sidecar supervisor: a crash schedules a restart (capped backoff), and the
// backoff starts small. Uses the first (1s) backoff so the test stays quick.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSidecarSupervisor, SIDECAR_BACKOFF_MS, SIDECAR_MAX_RESTARTS } = require('./sidecarSupervision.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('backoff is bounded and starts small', () => {
  assert.ok(SIDECAR_MAX_RESTARTS >= 1)
  assert.ok(SIDECAR_BACKOFF_MS.length >= 3)
  assert.ok(SIDECAR_BACKOFF_MS[0] <= 2000)
  // monotonic non-decreasing
  for (let i = 1; i < SIDECAR_BACKOFF_MS.length; i++) {
    assert.ok(SIDECAR_BACKOFF_MS[i] >= SIDECAR_BACKOFF_MS[i - 1])
  }
})

test('a crash schedules exactly one restart after the first backoff', async () => {
  let starts = 0
  const apiSidecar = {
    startApi: async () => {
      starts += 1
      return true
    },
    ping: async () => true,
  }
  const supervisor = createSidecarSupervisor({ apiSidecar, log: () => {}, onError: () => {} })
  supervisor.crashed(1)
  // Two crashes in a row must not schedule two restarts (one in flight).
  supervisor.crashed(1)
  await sleep(SIDECAR_BACKOFF_MS[0] + 250)
  assert.strictEqual(starts, 1, 'one restart for two crashes inside the backoff window')
})