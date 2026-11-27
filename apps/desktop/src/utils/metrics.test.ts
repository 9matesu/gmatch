import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  METRICS_RING_SIZE,
  countMetric,
  installMetricsDebugSurface,
  logMetrics,
  metricsSnapshot,
  resetMetricsForTests,
  timeMetric,
} from './metrics'

beforeEach(() => resetMetricsForTests())
afterEach(() => vi.restoreAllMocks())

describe('media metrics', () => {
  it('counts the named events without dropping totals when the ring wraps', () => {
    for (let i = 0; i < METRICS_RING_SIZE + 40; i += 1) countMetric('media.miss', `obj-${i}`)
    const snap = metricsSnapshot()
    expect(snap.counters['media.miss']).toBe(METRICS_RING_SIZE + 40)
    expect(snap.recent).toHaveLength(METRICS_RING_SIZE)
    expect(snap.recent[0].detail).toBe(`obj-${METRICS_RING_SIZE + 39}`)
    expect(snap.dropped).toBe(40)
    // Untouched counters are present (a closed name set, never a stray key).
    expect(snap.counters['http.404']).toBe(0)
  })

  it('aggregates timings with min/max/avg and clamps junk numbers', () => {
    timeMetric('swarm.ask', 10, 'a')
    timeMetric('swarm.ask', 30, 'b')
    timeMetric('swarm.ask', Number.NaN, 'c')
    const t = metricsSnapshot().timings['swarm.ask']
    expect(t.count).toBe(3)
    expect(t.last).toBe(0)
    expect(t.min).toBe(0)
    expect(t.max).toBe(30)
    expect(t.avg).toBeCloseTo(40 / 3)
  })

  it('exposes a cloneable, bounded snapshot and a reset', () => {
    countMetric('http.404', 'dead-id')
    timeMetric('media.resolve', 7)
    const snap = metricsSnapshot()
    snap.counters['http.404'] = 99
    expect(metricsSnapshot().counters['http.404']).toBe(1)
    expect(snap.recent.length).toBeLessThanOrEqual(METRICS_RING_SIZE)
    resetMetricsForTests()
    expect(metricsSnapshot().counters['http.404']).toBe(0)
  })

  it('installs a single debug surface with snapshot/log/reset', () => {
    const surface = installMetricsDebugSurface()
    expect(installMetricsDebugSurface()).toBe(surface)
    if (typeof window !== 'undefined') expect(window.__gmatchMetrics).toBe(surface)
    expect(typeof surface.snapshot).toBe('function')
    expect(typeof surface.log).toBe('function')
    expect(typeof surface.reset).toBe('function')
  })

  it('log() prints a console group without changing the counters', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    countMetric('media.evict', 'obj-1')
    logMetrics('test group')
    expect(group).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(metricsSnapshot().counters['media.evict']).toBe(1)
  })
})
