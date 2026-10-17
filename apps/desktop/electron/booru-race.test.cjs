'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFetchBooru, RACE_WIDTH, ROUND_DEADLINE_MS } = require('./booruSources.cjs')
const { firstAnswer } = require('./booru-sources-core.cjs')

/**
 * Why this exists.
 *
 * The main-process fetch was a nested sequential walk: every source x every
 * query variant, each awaiting its own timeout. With 14 sources and 3 variants
 * that is minutes of requests — so rounds regularly came back EMPTY, because the
 * 8s deadline expired long before the walk finished. An empty result is a
 * different failure from a slow one: the user is told there is nothing to show.
 *
 * The renderer already raced its variant ladder. This does the same across
 * sources, in bounded lanes.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A source that answers after `ms` with `posts` (or nothing). */
const source = (id, ms, posts) => ({
  id,
  category: 'hentai',
  fetch: async () => {
    await sleep(ms)
    return posts
  },
})

test('a slow early source does not delay a fast later one', async () => {
  // The whole point. Sequentially this took 300ms + 10ms; the 300ms source is
  // ahead of the good one in every ordering, so only racing gets the fast answer.
  // The fixture must ANSWER the query: the round gates every source's posts on
  // the full query (./matchRule.cjs), so a post tagged `a` is filtered out and
  // there would be no winner to race for.
  const good = [{ id: 'p1', url: 'http://x/1.jpg', tags: ['alpha'], rating: 'e' }]
  const sources = [
    source('slow-1', 300, []),
    source('slow-2', 250, []),
    source('fast', 10, good),
  ]
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '' })

  const t0 = Date.now()
  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  const elapsed = Date.now() - t0

  assert.equal(res.ok, true)
  assert.equal(res.source, 'fast')
  assert.equal(res.posts.length, 1)
  assert.ok(elapsed < 250, `should not wait for the sequential walk (took ${elapsed}ms)`)
})

test('an empty answer does not beat a slower good one', async () => {
  // The failure mode of naive racing. A source that answers "nothing here" fast
  // must not win over one that is about to answer with posts.
  const good = [{ id: 'p1', url: 'http://x/1.jpg', tags: ['alpha'], rating: 'e' }]
  const sources = [source('empty-fast', 5, []), source('good-slow', 60, good)]
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '' })

  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(res.source, 'good-slow')
  assert.equal(res.posts.length, 1)
})

test('a throwing source is skipped, not fatal', async () => {
  const good = [{ id: 'p1', url: 'http://x/1.jpg', tags: ['alpha'], rating: 'e' }]
  const sources = [
    { id: 'boom', category: 'hentai', fetch: async () => { throw new Error('HTTP 500') } },
    source('ok', 5, good),
  ]
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '' })
  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(res.source, 'ok')
})

test('a dead source is not the last word', async () => {
  const sources = [source('a', 5, []), source('b', 5, []), source('c', 5, [])]
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '' })
  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(res.ok, false)
  assert.equal(res.posts.length, 0)
})

test('the race is bounded, not one request per source', async () => {
  // 14 simultaneous requests to IP-rate-limited hosts is its own outage, and a
  // stalled source would hold a slot for the whole round.
  let inFlight = 0
  let peak = 0
  const sources = Array.from({ length: 14 }, (_, i) => ({
    id: `s${i}`,
    category: 'hentai',
    fetch: async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await sleep(30)
      inFlight -= 1
      return []
    },
  }))
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '' })
  await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.ok(peak <= RACE_WIDTH, `peak concurrency ${peak} must stay within RACE_WIDTH (${RACE_WIDTH})`)
  assert.ok(peak > 1, 'but it must actually be racing')
})

test('the round deadline stops NEW work, and does not abort in-flight requests', async () => {
  // Racing must not become "ignore the deadline": the renderer stops waiting at
  // the same point, and an abandoned round must stop starting work.
  //
  // Note what this deliberately does NOT do: it does not cancel the requests
  // already running. They own their own timeout, and cancelling would need
  // AbortSignal plumbing that buys nothing here — the results are discarded
  // either way. So the wall-clock of a stalled round is one timeout, not zero.
  let started = 0
  const sources = Array.from({ length: 14 }, (_, i) => ({
    id: `s${i}`,
    category: 'hentai',
    fetch: async () => {
      started += 1
      await sleep(400)
      return []
    },
  }))
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '', deadlineMs: 120 })
  const res = await fetchBooru({ tags: 'alpha', limit: 10 })

  assert.equal(res.ok, false)
  assert.equal(res.timedOut, true, 'a deadline-exhausted round says so')
  // The lanes that were already running finish; none of the other 10 ever start.
  assert.ok(started <= RACE_WIDTH, `expected only in-flight work, ${started} started`)
  assert.ok(started < 14, 'the deadline must actually cut the walk short')
  assert.ok(ROUND_DEADLINE_MS <= 15_000, 'the default deadline stays a sane number')
})

test('firstAnswer matches the renderer contract', async () => {
  // Thunks, not promises: the point of the primitive is that an attempt which
  // has not started has not been paid for.
  assert.equal(await firstAnswer([], 4), null)
  assert.equal(await firstAnswer([async () => [], async () => null], 4), null)
  assert.equal(await firstAnswer([async () => { throw new Error('x') }], 4), null)
  assert.deepEqual(await firstAnswer([async () => [{ id: 'a' }]], 4), [{ id: 'a' }])
  // A rejection must not be mistaken for a settled empty result.
  const mixed = firstAnswer([
    async () => { throw new Error('x') },
    async () => [{ id: 'b' }],
  ], 4)
  assert.deepEqual(await mixed, [{ id: 'b' }])
  // `accept` rejects an answer and the runner moves on: "returned posts" and
  // "answered the round" are different claims.
  const rejected = firstAnswer(
    [async () => 'all-repeats', async () => 'fresh'],
    4,
    (value) => (value === 'fresh' ? value : null),
  )
  assert.equal(await rejected, 'fresh')
})

test('a slow first attempt is hedged, not waited out', async () => {
  // The latency half of the contract: giving the first mirror a grace period
  // must not turn into giving it the whole round. This is the case the old
  // stride loop handled by racing everything at once (and paying for it).
  let peak = 0
  let inFlight = 0
  const attempts = [
    async () => { inFlight += 1; peak = Math.max(peak, inFlight); await sleep(400); inFlight -= 1; return [] },
    async () => { inFlight += 1; peak = Math.max(peak, inFlight); await sleep(400); inFlight -= 1; return [] },
    async () => { inFlight += 1; peak = Math.max(peak, inFlight); await sleep(5); inFlight -= 1; return ['fast'] },
  ]
  const t0 = Date.now()
  const out = await firstAnswer(attempts, 4)
  const elapsed = Date.now() - t0
  assert.deepEqual(out, ['fast'])
  assert.ok(elapsed < 300, `a 400ms first attempt must not hold the round (took ${elapsed}ms)`)
  assert.ok(peak > 1, 'the hedge must actually start a second attempt')
})

test('a fast first answer costs exactly one attempt', async () => {
  // The rate-limit half: the booru.org family shares one per-IP limiter, so a
  // happy path must not pay for lanes it did not use.
  let started = 0
  const attempts = [
    async () => { started += 1; return ['first'] },
    async () => { started += 1; return ['second'] },
    async () => { started += 1; return ['third'] },
  ]
  const out = await firstAnswer(attempts, 4)
  assert.deepEqual(out, ['first'])
  assert.equal(started, 1, 'the second attempt must never have been started')
})
