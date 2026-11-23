'use strict'
// Feed metrics: medians, per-provider aggregation, cache-hit rate, bounded ring.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFeedMetrics, median } = require('./feedMetrics.cjs')

test('median is null on empty and the middle value otherwise', () => {
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})

test('attempts and rounds aggregate into the summary', () => {
  const m = createFeedMetrics()
  m.attempt('tbib', 100, 'ok')
  m.attempt('tbib', 300, 'ok')
  m.attempt('mediaq', 5000, 'timeout')
  m.round({ totalMs: 120, firstResultMs: 100, resultCount: 8, source: 'tbib' })
  m.round({ totalMs: 60, firstResultMs: 50, resultCount: 4, source: 'cache', fromCache: true })

  const s = m.summary()
  assert.equal(s.rounds, 2)
  assert.equal(s.totalLatencyMs, 90) // median(120, 60)
  assert.equal(s.firstResultMs, 75) // median(100, 50)
  assert.equal(s.cacheHitRate, 0.5)
  assert.equal(s.providers.tbib.medianMs, 200) // median(100, 300)
  assert.equal(s.providers.tbib.oks, 2)
  assert.equal(s.providers.mediaq.timeouts, 1)
})

test('the ring buffer is bounded', () => {
  const m = createFeedMetrics()
  for (let i = 0; i < 100; i++) m.round({ totalMs: i, resultCount: 1 })
  assert.equal(m.recent().length, 50)
  assert.equal(m.summary().rounds, 50)
})

test('reset clears everything', () => {
  const m = createFeedMetrics()
  m.attempt('x', 10, 'ok')
  m.round({ totalMs: 10, resultCount: 1 })
  m.reset()
  assert.equal(m.recent().length, 0)
  assert.equal(m._providerCount(), 0)
})