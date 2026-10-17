// node booruSources.test.cjs — exits 1 on failure (plain-node style).
// A query whose posts are cached must NOT reach a provider a second time.
const assert = require('assert')
const { createFetchBooru } = require('./booruSources.cjs')
const { matchesQuery } = require('./matchRule.cjs')

let providerCalls = 0
const sources = [
  {
    id: 'fake',
    category: 'hentai',
    // Tag must satisfy the query below: createFetchBooru validates results
    // against the variant it sent, so a fixture tagged 'a' queried 'alpha'
    // would (correctly) be discarded and this memo test would prove nothing.
    fetch: async () => { providerCalls += 1; return [{ id: 'p1', url: 'http://x/1.jpg', tags: ['alpha'], rating: 'e' }] },
  },
]

// Minimal in-memory stand-in for imageCache's feed memo (same shape).
const memo = {}
const cache = {
  getFeedCache: (q) => {
    const hit = memo[String(q).trim().toLowerCase()]
    if (!hit) return null
    if (Date.now() - hit.ts >= 10 * 60 * 1000) { delete memo[String(q).trim().toLowerCase()]; return null }
    return hit.posts
  },
  setFeedCache: (q, posts) => {
    if (!Array.isArray(posts) || posts.length === 0) return
    memo[String(q).trim().toLowerCase()] = { posts, ts: Date.now() }
  },
}

async function main() {
  const fetchBooru = createFetchBooru({ sources, httpGet: async () => '', cache, queryVariants: (q) => [q] })

  const first = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.strictEqual(providerCalls, 1, 'first call hits the provider once')
  assert.ok(first.posts.length === 1)
  assert.ok(!first.cached, 'first call is not marked cached')

  const second = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.strictEqual(providerCalls, 1, 'second call must NOT re-hit the provider')
  assert.ok(second.posts.length === 1, 'cached posts returned')
  assert.strictEqual(second.cached, true, 'cached verdict is flagged')

  const thirdFresh = await fetchBooru({ tags: 'alpha', limit: 10, fresh: true })
  assert.strictEqual(providerCalls, 2, 'fresh=true must bypass cache and re-hit provider')
  assert.ok(!thirdFresh.cached, 'fresh call not flagged cached')

  // A fresh (random-page) round must NOT poison the tag slot: the next
  // normal read still serves the original memo without re-hitting.
  const fourth = await fetchBooru({ tags: 'alpha', limit: 10 })
  assert.strictEqual(providerCalls, 2, 'fresh round must not rewrite the memo')
  assert.ok(fourth.posts.length === 1, 'original memo still served')
  assert.strictEqual(fourth.cached, true, 'memo verdict flagged')

  fs_cleanup()
  console.log('booruSources: all assertions passed')
}

/**
 * The query gate main.cjs never had. Before this, the packaged app returned
 * whatever a provider said: a two-tag request could come back full of posts
 * matching one tag. Asserted here because createFetchBooru is pure/injectable,
 * so no Electron boot is needed.
 */
async function queryGate() {
  const mk = (tags, id) => ({ id, url: `http://x/${id}.jpg`, tags, rating: 'e' })
  const loose = [mk(['alpha'], 'only-alpha'), mk(['alpha', 'beta'], 'both')]

  // Strict AND: only the post carrying BOTH tags survives.
  {
    const fetchBooru = createFetchBooru({
      sources: [{ id: 'fake', category: 'hentai', fetch: async () => loose }],
      httpGet: async () => '',
    })
    const res = await fetchBooru({ tags: 'alpha beta', limit: 10 })
    assert.deepStrictEqual(res.posts.map((p) => p.id), ['both'], 'single-tag match is rejected')
  }

  // The ladder over-fetches (it walks down to a ONE-tag request to dodge
  // providers that return 0 for narrow ANDs), but the gate follows the FULL
  // query, never the variant sent. So the widened request may legitimately
  // return the single-tag post as a CANDIDATE and it must be dropped: a
  // two-tag query may never answer with a one-tag post.
  {
    let seen = []
    const fetchBooru = createFetchBooru({
      sources: [
        {
          id: 'fake',
          category: 'hentai',
          fetch: async (variant) => { seen.push(variant); return loose },
        },
      ],
      httpGet: async () => '',
    })
    const res = await fetchBooru({ tags: 'alpha beta', limit: 10 })
    assert.ok(seen.length >= 1, 'at least one variant was requested')
    assert.ok(seen.some((v) => v.startsWith('alpha')), 'the wide first tag was requested')
    assert.deepStrictEqual(
      res.posts.map((p) => p.id),
      ['both'],
      'only the genuine two-tag post survives; the widened one-tag candidate is dropped',
    )
    assert.strictEqual(res.query, 'alpha beta', 'the reported query is the full one, not the widened variant')
    assert.ok(
      (res.posts || []).every((p) => matchesQuery(p.tags, 'alpha beta', { trustUntagged: true })),
      'every returned post satisfies the FULL query',
    )
  }

  // Negatives stay enforced on the main side too.
  {
    const fetchBooru = createFetchBooru({
      sources: [
        { id: 'fake', category: 'hentai', fetch: async () => [mk(['alpha', 'solo'], 'nope')] },
      ],
      httpGet: async () => '',
    })
    const res = await fetchBooru({ tags: 'alpha -solo', limit: 10 })
    assert.strictEqual(res.posts.length, 0, 'negated tag rejects the post')
  }

  console.log('booruSources query gate: all assertions passed')
}

function fs_cleanup() { /* no temp files in this test */ }

main()
  .then(queryGate)
  .then(() => process.exit(0), (err) => { console.error('booruSources test FAILED:', err); process.exit(1) })
