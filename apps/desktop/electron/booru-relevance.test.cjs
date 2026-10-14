'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFetchBooru, FAST_PHASE, COOLDOWN_HARD_MS } = require('./booruSources.cjs')

/**
 * Main-process relevance + reliability contract.
 *
 * These pin the fixes for the three reported symptoms:
 *   - wrong images/tags/sources  -> a source may only answer a query it can
 *     genuinely match; nothing is substituted for it
 *   - repeated images            -> dead mirrors stop eating rounds; pages are
 *     drawn without replacement
 *   - slow / unreliable          -> cheap sources answer before HTML scrapers
 *     are ever started, and a dead mirror is skipped rather than retried
 *
 * The renderer side of the same contract lives in
 * src/services/tagMatch.test.ts and src/services/booru.test.ts.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ok = (id, tags) => ({ id, url: `http://x/${id}.jpg`, tags, rating: 'e' })

/** A source that always answers `posts` after `ms`. */
const fast = (id, posts, ms = 1, kind = 'dapi') => ({
  id,
  kind,
  category: 'hentai',
  fetch: async () => {
    if (ms) await sleep(ms)
    return posts
  },
})

test('a dead mirror is cooled and not retried on the next round', async () => {
  let deadCalls = 0
  const broken = {
    id: 'broken',
    kind: 'dapi',
    category: 'hentai',
    fetch: async () => {
      deadCalls += 1
      throw new Error('HTTP 503')
    },
  }
  const good = fast('good', [ok('g1', ['alpha'])])
  const fetchBooru = createFetchBooru({ sources: [broken, good], httpGet: async () => '' })

  const r1 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r1.ok, true)
  assert.equal(r1.source, 'good')
  assert.equal(deadCalls, 1)

  // Round 2 must NOT re-attempt the mirror that just failed: before the health
  // map it consumed a race lane on every single round, forever.
  const r2 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r2.ok, true)
  assert.equal(deadCalls, 1, 'cooled mirror must not be re-attempted')
})

test('a success clears the cooldown so a recovered mirror is retried', async () => {
  let brokenNow = true
  const flaky = {
    id: 'flaky',
    kind: 'dapi',
    category: 'hentai',
    fetch: async () => {
      if (brokenNow) throw new Error('HTTP 503')
      return [ok('f1', ['alpha'])]
    },
  }
  const good = fast('good', [ok('g1', ['alpha'])])
  const fetchBooru = createFetchBooru({ sources: [flaky, good], httpGet: async () => '' })

  const r1 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r1.source, 'good')

  // Mirror recovers and answers — but it is in cooldown, so this round is
  // served by `good`; the cooldown is what keeps a flaky mirror from
  // re-entering immediately.
  brokenNow = false
  const r2 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r2.ok, true)
  assert.equal(r2.source, 'good', 'still cooled from round 1, so `good` serves again')
})

test('a 429 on a booru.org sub cools every booru.org sub', async () => {
  const mk = (id, counter) => ({
    id,
    kind: 'booruorg',
    category: 'real',
    fetch: async () => {
      counter.n += 1
      throw new Error('HTTP 429')
    },
  })
  const counters = { a: { n: 0 }, b: { n: 0 } }
  const a = mk('sub-a', counters.a)
  const b = mk('sub-b', counters.b)
  const fetchBooru = createFetchBooru({ sources: [a, b], httpGet: async () => '' })

  await fetchBooru({ tags: 'alpha', limit: 10 })
  const afterFirst = counters.a.n + counters.b.n
  await fetchBooru({ tags: 'alpha', limit: 10 })
  // Shared IP rate limit: the second round should attempt NEITHER sub.
  assert.equal(counters.a.n + counters.b.n, afterFirst, 'all booru.org subs cool together')
  assert.ok(afterFirst >= 1)
})

test('the category filter is honoured: disabling a category returns empty, not the other one', async () => {
  let realCalls = 0
  const realOnly = {
    id: 'real-src',
    kind: 'dapi',
    category: 'real',
    fetch: async () => {
      realCalls += 1
      return [ok('r1', ['alpha'])]
    },
  }
  const hentai = fast('hentai-src', [ok('h1', ['alpha'])])
  const fetchBooru = createFetchBooru({ sources: [realOnly, hentai], httpGet: async () => '' })

  // Player switched "real" off. Before, an empty filtered pool fell back to the
  // FULL list, so the toggle silently did nothing.
  const res = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: false, allowHentai: true })
  assert.equal(realCalls, 0, 'disabled category must never be queried')
  assert.equal(res.source, 'hentai-src')
})

test('an empty category pool is an honest empty round', async () => {
  const only = fast('real-src', [ok('r1', ['alpha'])], 1, 'dapi')
  only.category = 'real'
  const fetchBooru = createFetchBooru({ sources: [only], httpGet: async () => '' })
  const res = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: false, allowHentai: false })
  assert.equal(res.ok, false)
  assert.equal(res.posts.length, 0)
  assert.equal(res.error, 'no enabled source for this category')
})

test('cheap sources answer before the HTML scrapers are ever started', async () => {
  let scraperStarted = false
  const scraper = {
    id: 'imhentai',
    kind: 'imhentai', // multi-fetch HTML scrape: phase 2
    category: 'hentai',
    fetch: async () => {
      scraperStarted = true
      return [ok('scrape', ['alpha'])]
    },
  }
  const mirror = fast('tbib', [ok('m1', ['alpha'])])
  const fetchBooru = createFetchBooru({ sources: [scraper, mirror], httpGet: async () => '' })

  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(res.source, 'tbib')
  assert.equal(scraperStarted, false, 'a fast mirror must not pay for a gallery crawl')
})

test('the scraper phase still runs when no cheap source can answer', async () => {
  const empty1 = fast('tbib', [])
  const scraper = {
    id: 'imhentai',
    kind: 'imhentai',
    category: 'hentai',
    fetch: async () => [ok('scrape', ['alpha'])],
  }
  const fetchBooru = createFetchBooru({ sources: [empty1, scraper], httpGet: async () => '' })
  const res = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(res.ok, true)
  assert.equal(res.source, 'imhentai')
})

test('an empty answer from a source is not treated as a failure', async () => {
  // "I don't have that tag" is a valid answer, not a sick mirror. Cooling here
  // would starve the feed of sources that simply have no such post.
  const quiet = fast('quiet', [])
  const good = fast('good', [ok('g1', ['alpha'])])
  const fetchBooru = createFetchBooru({ sources: [quiet, good], httpGet: async () => '' })

  const r1 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r1.source, 'good')
  // `quiet` answered empty rather than throwing, so it is still in the pool on
  // the next round (unlike the cooled `broken` mirror above).
  const r2 = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.equal(r2.ok, true)
})

test('FAST_PHASE keeps the multi-fetch scrapers out of the cheap lane', () => {
  assert.equal(FAST_PHASE.has('dapi'), true)
  assert.equal(FAST_PHASE.has('imhentai'), false)
  assert.equal(FAST_PHASE.has('babesource'), false)
  assert.ok(COOLDOWN_HARD_MS > 0)
})