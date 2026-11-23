'use strict'

/**
 * Feed search metrics — product-level observability for the booru/mediaq search.
 *
 * Separate from technical dev logs on purpose: this is a bounded, read-only ring
 * buffer the app exposes over IPC (`booru:timings`) for diagnostics, and it is
 * never rendered in the main UI. No timers, no sampling, no background work — a
 * round pushes one record; if nobody reads it, it costs one push.
 *
 * Records:
 *   attempt(providerId, ms, status)   status: 'ok' | 'empty' | 'timeout' | 'error'
 *   round({ totalMs, firstResultMs, resultCount, fromCache, fallback, source })
 */

const MAX_ROUNDS = 50

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

function createFeedMetrics() {
  /** @type {Array<any>} */ const rounds = []
  /** @type {Map<string, { attempts: number, oks: number, empties: number, timeouts: number, errors: number, ms: number[] }>} */
  const providers = new Map()

  function bump(id, status, ms) {
    let p = providers.get(id)
    if (!p) {
      p = { attempts: 0, oks: 0, empties: 0, timeouts: 0, errors: 0, ms: [] }
      providers.set(id, p)
    }
    p.attempts += 1
    if (status === 'ok') p.oks += 1
    else if (status === 'empty') p.empties += 1
    else if (status === 'timeout') p.timeouts += 1
    else p.errors += 1
    if (typeof ms === 'number' && Number.isFinite(ms)) {
      p.ms.push(ms)
      if (p.ms.length > 200) p.ms.shift() // bounded per provider
    }
  }

  return {
    /** Record one provider attempt. */
    attempt(id, ms, status) {
      bump(String(id || 'unknown'), status, ms)
    },

    /** Record one completed round. */
    round(info) {
      rounds.push({
        at: Date.now(),
        totalMs: info && info.totalMs,
        firstResultMs: info && info.firstResultMs,
        resultCount: info && info.resultCount,
        fromCache: Boolean(info && info.fromCache),
        fallback: Boolean(info && info.fallback),
        source: info && info.source != null ? String(info.source) : null,
      })
      while (rounds.length > MAX_ROUNDS) rounds.shift()
    },

    /** Recent rounds, newest last (copy). */
    recent() {
      return rounds.slice()
    },

    /** Aggregate view: medians + per-provider + cache/fallback counts. */
    summary() {
      const byProvider = {}
      for (const [id, p] of providers) {
        byProvider[id] = {
          attempts: p.attempts,
          oks: p.oks,
          empties: p.empties,
          timeouts: p.timeouts,
          errors: p.errors,
          medianMs: median(p.ms),
        }
      }
      const cacheHits = rounds.filter((r) => r.fromCache).length
      return {
        rounds: rounds.length,
        totalLatencyMs: median(rounds.map((r) => r.totalMs)),
        firstResultMs: median(rounds.map((r) => r.firstResultMs)),
        resultCount: median(rounds.map((r) => r.resultCount)),
        cacheHitRate: rounds.length ? cacheHits / rounds.length : null,
        fallbacks: rounds.filter((r) => r.fallback).length,
        providers: byProvider,
      }
    },

    /** Drop all recorded data (tests / explicit reset). */
    reset() {
      rounds.length = 0
      providers.clear()
    },

    /** Exposed for tests: the provider map size (bounded by distinct ids). */
    _providerCount() {
      return providers.size
    },
  }
}

module.exports = { createFeedMetrics, median }