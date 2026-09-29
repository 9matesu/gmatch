import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BooruPost } from '../game/types'
import {
  __resetFeedState,
  fetchPosts,
  firstWithPosts,
  markSeen,
  ROUND_DEADLINE_MS,
  startRoundBudget,
  withRequestTimeout,
} from './booru'
import { __resetCoRules, setCoRules, setFeedIntent } from '../game/tagCooccur'
import { __resetUserExcludes } from '../game/tagFilter'

/**
 * Round-latency guards.
 *
 * The complaint these cover is "the clicker takes forever to show a picture".
 * The feed round used to have no ceiling at all: a sequential walk of every
 * mirror x every query variant, re-run up to twice more on seen-exhaustion,
 * with gallery scrapers fanning out behind each one. These tests pin the three
 * bounds that make that impossible again: the round deadline, the raced
 * variant ladder, and the single deepen pass.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  // restoreAllMocks too: a spy on a global (clearTimeout) that outlives its
  // test silently changes how every later test in this file behaves.
  vi.restoreAllMocks()
  vi.useRealTimers()
  __resetFeedState()
  __resetCoRules()
  setCoRules([])
  setFeedIntent([])
  __resetUserExcludes()
})

/** A DAPI mirror answer that passes the quality gate. */
function dapiPost(n: number) {
  return {
    id: `p${n}`,
    file_url: `https://cdn.test/${n}.jpg`,
    tags: 'creampie rating_explicit 1girl',
    rating: 'e',
    width: 1200,
    height: 1600,
  }
}

/**
 * A fetch that never answers, but honours its AbortSignal — which is what a
 * real `fetch` does. A mock that hangs *ignoring* the signal would model a
 * bug no browser has, and would make the deadline untestable.
 */
function hangingFetch(): { calls: () => number; mock: ReturnType<typeof vi.fn> } {
  let n = 0
  const mock = vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        n += 1
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
      }),
  )
  return { calls: () => n, mock }
}

describe('round budget', () => {
  it('aborts at the deadline and reports expired', () => {
    vi.useFakeTimers()
    const budget = startRoundBudget(1_000)
    expect(budget.expired()).toBe(false)
    expect(budget.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1_001)
    expect(budget.expired()).toBe(true)
    expect(budget.signal.aborted).toBe(true)
    budget.dispose()
  })

  it('dispose stops the timer so a fast round holds nothing open', () => {
    vi.useFakeTimers()
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const budget = startRoundBudget(5_000)
    budget.dispose()
    expect(clear).toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(budget.expired()).toBe(false) // never fired
  })

  it('withRequestTimeout merges the request timeout with the round budget', () => {
    vi.useFakeTimers()
    const budget = startRoundBudget(1_000)
    const merged = withRequestTimeout(60_000, budget)
    // The request timeout is long, the round is short: the round must win.
    expect(merged.timedOut()).toBe(false)
    vi.advanceTimersByTime(1_001)
    expect(budget.expired()).toBe(true)
    expect(merged.signal.aborted).toBe(true)
    // The REQUEST was not what timed out — that distinction is what stops a
    // slow round from cooling healthy mirrors.
    expect(merged.timedOut()).toBe(false)
    budget.dispose()
  })

  it('withRequestTimeout works with no budget at all', () => {
    const merged = withRequestTimeout(1_000, undefined)
    expect(merged.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('firstWithPosts', () => {
  // Minimal BooruPost: the helper only cares about "did this yield posts".
  const post = (id: string) => ({ id, url: `https://cdn.test/${id}.jpg`, tags: ['creampie'] })

  it('takes the first attempt that yields posts', async () => {
    const slow = new Promise<BooruPost[]>((r) => setTimeout(() => r([post('slow')]), 20))
    const out = await firstWithPosts([slow, Promise.resolve([post('fast')])])
    expect(out?.map((p) => p.id)).toEqual(['fast'])
  })

  it('waits for a slow POST rather than settling on a fast EMPTY answer', async () => {
    // The point of racing: a variant that answers "nothing here" quickly must
    // not beat a sibling that is about to deliver.
    const slow = new Promise<BooruPost[]>((r) => setTimeout(() => r([post('slow')]), 20))
    const out = await firstWithPosts([slow, Promise.resolve([])])
    expect(out?.map((p) => p.id)).toEqual(['slow'])
  })

  it('resolves null when every attempt is empty', async () => {
    expect(await firstWithPosts([Promise.resolve([]), Promise.resolve(null)])).toBeNull()
  })

  it('resolves null when every attempt rejects', async () => {
    const boom = () => Promise.reject(new Error('nope'))
    expect(await firstWithPosts([boom(), boom()])).toBeNull()
  })

  it('resolves null for an empty attempt list', async () => {
    expect(await firstWithPosts([])).toBeNull()
  })

  it('handles a single attempt', async () => {
    const out = await firstWithPosts([Promise.resolve([post('solo')])])
    expect(out?.map((p) => p.id)).toEqual(['solo'])
  })
})

describe('fetchPosts round deadline', () => {
  // A LITERAL, not the exported constant. Advancing by the constant would make
  // the test pass for any deadline at all — it would just move the goalposts
  // along with the code. 15s is the user-facing promise: "a round never takes
  // meaningfully longer than this", with headroom over ROUND_DEADLINE_MS.
  const CEILING_MS = 15_000

  it('gives up on hanging mirrors instead of walking the whole pool', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const { calls, mock } = hangingFetch()
    vi.stubGlobal('fetch', mock)

    const pending = fetchPosts({ tags: 'creampie', limit: 5 })
    await vi.advanceTimersByTimeAsync(CEILING_MS)
    const res = await pending

    expect(res.ok).toBe(false)
    expect(res.offline).toBe(true)
    // Bounded by the deadline, not by "every source x every variant" (12
    // sources x 3 variants is 36 requests before any timeout logic).
    expect(calls()).toBeGreaterThan(0)
    expect(calls()).toBeLessThan(36)
  })

  it('does not cool down a mirror that merely ran out of round time', async () => {
    // A deadline abort is the player's impatience, not a sick mirror. Cooling
    // healthy mirrors because a round was slow would shrink the pool until the
    // feed looked broken — a self-inflicted outage.
    //
    // Both rounds are driven to completion under fake timers: leaving one in
    // flight would bleed into the next test's stubbed fetch.
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const { calls, mock } = hangingFetch()
    vi.stubGlobal('fetch', mock)

    const first = fetchPosts({ tags: 'creampie', limit: 5 })
    await vi.advanceTimersByTimeAsync(CEILING_MS)
    expect((await first).offline).toBe(true)
    const afterFirst = calls()

    // A fresh round must still TRY the mirrors rather than skipping straight to
    // the offline verdict with zero requests — that is what "not cooled down"
    // means in practice.
    const second = fetchPosts({ tags: 'creampie', limit: 5 })
    await vi.advanceTimersByTimeAsync(CEILING_MS)
    expect((await second).offline).toBe(true)
    expect(calls()).toBeGreaterThan(afterFirst)
  })

  it('the deadline itself is a sane, bounded number', () => {
    // Guards the constant against being raised to hide a regression: past
    // ~15s the feed stops feeling responsive no matter what else is fixed.
    expect(ROUND_DEADLINE_MS).toBeGreaterThan(0)
    expect(ROUND_DEADLINE_MS).toBeLessThanOrEqual(CEILING_MS)
  })
})

describe('variant ladder racing', () => {
  it('fires the whole ladder at once so a slow wide query cannot gate it', async () => {
    vi.stubGlobal('window', {})
    const seen: string[] = []
    // Three unblocked tags, so queryVariants yields the full ladder (query,
    // top-two, leading). NOTE: do not use a word the blocklist substring-matches
    // here — a blocked token refuses the whole query before any request is
    // made, which is a different code path entirely.
    const FULL = 'creampie%20ahegao%20pregnant%20rating%3Aexplicit'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
        const u = String(url)
        seen.push(u)
        if (!u.startsWith('/booru/tbib/')) return { ok: false }
        // Only the FULL combo query is slow; the narrower variants answer.
        if (u.includes(FULL)) {
          return new Promise<never>((_r, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        return { ok: true, json: async () => [dapiPost(1), dapiPost(2)] }
      }),
    )

    const res = await fetchPosts({ tags: 'creampie ahegao pregnant', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.posts.length).toBeGreaterThan(0)
    // All three variants were in flight together, so the answer came from the
    // same mirror the sequential walk would have reached only after the wide
    // query burned a full timeout.
    const tbib = seen.filter((u) => u.startsWith('/booru/tbib/'))
    expect(tbib).toHaveLength(3)
  })
})

describe('deepen passes', () => {
  it('deepens at most once', async () => {
    vi.stubGlobal('window', {})
    // Pre-seen, so every pass is all-repeats: that is the only state in which
    // the deepen loop runs at all.
    markSeen(dapiPost(1).id, dapiPost(1).file_url)
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.startsWith('/booru/tbib/')) {
          n += 1
          return { ok: true, json: async () => [dapiPost(1)] }
        }
        return { ok: false }
      }),
    )

    const res = await fetchPosts({ tags: 'creampie', limit: 5, fresh: true })
    expect(res.emptyFresh).toBe(true)
    // The initial pass plus exactly ONE deepen. Previously this was up to
    // three full sweeps of every mirror for a pool that is simply exhausted.
    expect(n).toBeLessThanOrEqual(2)
  })
})
