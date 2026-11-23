'use strict'
// Routing contract: one mediaq provider serves both categories (capability
// metadata, not duplication). firstAnswer starts ONE attempt and widens only on
// empty/slow, so a fast local mirror wins WITHOUT querying mediaq (no wasted
// request); mediaq is queried only when the local mirrors come up empty.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFetchBooru, FAST_PHASE } = require('./booruSources.cjs')
const { createMediaqProvider } = require('./providers/mediaq.cjs')

const ok = (id, tags) => ({ id, url: `http://x/${id}.jpg`, tags, rating: 'e' })
const mqItem = (over = {}) => ({ site: 'pornhub', kind: 'video', id: 'p1', page_url: 'https://pornhub.com/view/p1', thumb_url: 'https://thumb/p1.jpg', tags: [], ...over })

function mqProvider(bodies, items) {
  return createMediaqProvider({
    baseUrl: 'http://x',
    postJson: async (u, b) => { bodies.push(b); return { items } },
  })
}

test('mediaq is a fast-phase provider (a single POST, races with local mirrors)', () => {
  assert.equal(FAST_PHASE.has('mediaq'), true)
})

test('a fast local mirror wins WITHOUT querying mediaq (no wasted request)', async () => {
  const bodies = []
  const mq = mqProvider(bodies, [])
  const local = { id: 'tbib', kind: 'dapi', category: 'hentai', fetch: async () => [ok('g1', ['alpha'])] }
  const fetchBooru = createFetchBooru({ sources: [local, mq], httpGet: async () => '' })

  const r = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: true, allowHentai: true })
  assert.equal(r.source, 'tbib')
  assert.equal(r.ok, true)
  assert.equal(bodies.length, 0, 'mediaq must not be queried when a local mirror answers first')
})

test('when local mirrors are empty, mediaq answers with the hentai sites only', async () => {
  const bodies = []
  const mq = mqProvider(bodies, [mqItem({ site: 'rule34', tags: ['alpha'], thumb_url: 'https://img/r34.jpg' })])
  const local = { id: 'tbib', kind: 'dapi', category: 'hentai', fetch: async () => [] } // empty
  const fetchBooru = createFetchBooru({ sources: [local, mq], httpGet: async () => '' })

  const r = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: false, allowHentai: true })
  assert.equal(r.ok, true)
  assert.equal(r.source, 'mediaq')
  assert.ok(bodies.length >= 1)
  assert.ok(bodies[0].sites.includes('nhentai'))
  assert.ok(!bodies[0].sites.includes('pornhub'))
})

test('mediaq alone serves a real query when hentai is disabled', async () => {
  const bodies = []
  const mq = mqProvider(bodies, [mqItem()])
  const local = { id: 'tbib', kind: 'dapi', category: 'hentai', fetch: async () => [ok('g1', ['alpha'])] }
  const fetchBooru = createFetchBooru({ sources: [local, mq], httpGet: async () => '' })
  const r = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: true, allowHentai: false })
  assert.equal(r.ok, true)
  assert.equal(r.source, 'mediaq')
  assert.ok(bodies[0].sites.includes('pornhub'))
  assert.ok(!bodies[0].sites.includes('nhentai'))
})

test('a legacy source with a singular `category` still routes (backward compat)', async () => {
  const local = { id: 'tbib', kind: 'dapi', category: 'hentai', fetch: async () => [ok('g1', ['alpha'])] }
  const fetchBooru = createFetchBooru({ sources: [local], httpGet: async () => '' })
  const r = await fetchBooru({ tags: 'alpha', limit: 10, allowReal: false, allowHentai: true })
  assert.equal(r.source, 'tbib')
})

test('the mechanism records metrics when a sink is provided', async () => {
  const events = []
  const metrics = {
    attempt: (id, _ms, status) => events.push(['attempt', id, status]),
    round: (info) => events.push(['round', info.resultCount]),
  }
  const local = { id: 'tbib', kind: 'dapi', category: 'hentai', fetch: async () => [ok('g1', ['alpha'])] }
  const fetchBooru = createFetchBooru({ sources: [local], httpGet: async () => '', metrics })
  await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.ok(events.some((e) => e[0] === 'attempt' && e[2] === 'ok'))
  assert.ok(events.some((e) => e[0] === 'round'))
})