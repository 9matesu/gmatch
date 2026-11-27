/**
 * Bounded, deterministic diagnostics for the media paths.
 *
 * The media ladder used to be unobservable: a tile that sat on "Loading
 * media…" forever, an image that reloaded after a re-render, or a swarm ask
 * that never answered all looked identical from the outside. This module is
 * the single, tiny sink for those events. It is deliberately additive — every
 * caller keeps its existing behaviour whether or not anyone is reading the
 * numbers.
 *
 * Two shapes, both bounded:
 *  - counters: one number per (closed) metric name, so a long session never
 *    loses the total when the sample ring wraps;
 *  - timings: running min/max/avg plus a ring of the most recent samples, so
 *    the last N resolutions can be inspected without an unbounded log.
 *
 * Debug surface (browser only): `window.__gmatchMetrics.snapshot()` returns a
 * plain, cloneable object; `.log()` prints a collapsed console group; `.reset()`
 * clears the session. Safe to install more than once.
 */

export const COUNTER_NAMES = [
  'media.hit',
  'media.miss',
  'media.evict',
  'media.reload',
  'swarm.ask',
  'http.404',
] as const
export type CounterName = (typeof COUNTER_NAMES)[number]

export const TIMING_NAMES = ['media.resolve', 'media.network', 'swarm.ask'] as const
export type TimingName = (typeof TIMING_NAMES)[number]

export interface TimingStat {
  count: number
  last: number
  min: number
  max: number
  total: number
  avg: number
}

export interface MetricsEvent {
  at: number
  kind: 'count' | 'time'
  name: string
  value: number
  detail?: string
}

export interface MetricsSnapshot {
  /** Session start (epoch ms), so a counter can be read as a rate. */
  since: number
  counters: Record<CounterName, number>
  timings: Record<TimingName, TimingStat>
  /** Newest first, capped at RING_SIZE. */
  recent: MetricsEvent[]
  /** Events dropped because the ring was full (counters are unaffected). */
  dropped: number
}

export interface GmatchMetricsDebug {
  snapshot(): MetricsSnapshot
  log(label?: string): MetricsSnapshot
  reset(): void
}

/** Sample window. Small enough to be cheap, large enough to explain a hiccup. */
export const METRICS_RING_SIZE = 256

function zeroCounters(): Record<CounterName, number> {
  const out = {} as Record<CounterName, number>
  for (const name of COUNTER_NAMES) out[name] = 0
  return out
}

function zeroTimings(): Record<TimingName, TimingStat> {
  const out = {} as Record<TimingName, TimingStat>
  for (const name of TIMING_NAMES) {
    out[name] = { count: 0, last: 0, min: 0, max: 0, total: 0, avg: 0 }
  }
  return out
}

let counters = zeroCounters()
let timings = zeroTimings()
const ring: MetricsEvent[] = []
let cursor = 0
let dropped = 0
let since = Date.now()

function push(event: MetricsEvent): void {
  if (ring.length < METRICS_RING_SIZE) {
    ring.push(event)
    return
  }
  ring[cursor] = event
  cursor = (cursor + 1) % METRICS_RING_SIZE
  dropped += 1
}

/** Increment one counter. `detail` is an id or short reason, never media bytes. */
export function countMetric(name: CounterName, detail?: string): void {
  counters[name] += 1
  push({ at: Date.now(), kind: 'count', name, value: counters[name], detail })
}

/** Record one duration in ms (negative values are clamped to zero). */
export function timeMetric(name: TimingName, ms: number, detail?: string): void {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const stat = timings[name]
  stat.count += 1
  stat.last = value
  stat.min = stat.count === 1 ? value : Math.min(stat.min, value)
  stat.max = Math.max(stat.max, value)
  stat.total += value
  stat.avg = stat.total / stat.count
  push({ at: Date.now(), kind: 'time', name, value, detail })
}

/** Plain, cloneable copy — safe to hand to a devtools console or a test. */
export function metricsSnapshot(): MetricsSnapshot {
  const ordered = [...ring.slice(cursor), ...ring.slice(0, cursor)]
  const recent = ordered.reverse().map((event) => ({ ...event }))
  return {
    since,
    counters: { ...counters },
    timings: Object.fromEntries(
      TIMING_NAMES.map((name) => [name, { ...timings[name] }]),
    ) as Record<TimingName, TimingStat>,
    recent,
    dropped,
  }
}

/** Reset session diagnostics (test seam and the debug surface's `.reset()`). */
export function resetMetricsForTests(): void {
  counters = zeroCounters()
  timings = zeroTimings()
  ring.length = 0
  cursor = 0
  dropped = 0
  since = Date.now()
}

/** Collapsed console group with the whole session at a glance. */
export function logMetrics(label = 'gmatch media metrics'): MetricsSnapshot {
  const snapshot = metricsSnapshot()
  if (typeof console !== 'undefined') {
    const group = console.groupCollapsed ?? console.group
    group.call(console, `${label} · ${Math.round(Date.now() - snapshot.since)}ms · ${snapshot.recent.length} samples`)
    if (console.table) console.table(snapshot.counters)
    if (console.table) console.table(snapshot.timings)
    if (console.table) console.table(snapshot.recent)
    console.groupEnd?.()
  }
  return snapshot
}

declare global {
  interface Window {
    /** Optional debug surface; installed on module load in a browser. */
    __gmatchMetrics?: GmatchMetricsDebug
  }
}

/** The no-window (tests/SSR) surface: one stable object, like the browser one. */
const standaloneSurface: GmatchMetricsDebug = {
  snapshot: metricsSnapshot,
  log: logMetrics,
  reset: resetMetricsForTests,
}

/** Idempotent install: never replaces a surface another caller installed. */
export function installMetricsDebugSurface(): GmatchMetricsDebug {
  if (typeof window === 'undefined') return standaloneSurface
  if (!window.__gmatchMetrics) {
    window.__gmatchMetrics = standaloneSurface
  }
  return window.__gmatchMetrics
}

installMetricsDebugSurface()
