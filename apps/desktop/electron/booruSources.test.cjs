// node booruSources.test.cjs — exits 1 on failure (plain-node style).
// A query whose posts are cached must NOT reach a provider a second time.
const assert = require('assert')
const { createFetchBooru } = require('./booruSources.cjs')

let providerCalls = 0
const sources = [
  {
    id: 'fake',
    category: 'hentai',
    fetch: async () => { providerCalls += 1; return [{ id: 'p1', url: 'http://x/1.jpg', tags: ['a'], rating: 'e' }] },
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

  fs_cleanup()
  console.log('booruSources: all assertions passed')
}

function fs_cleanup() { /* no temp files in this test */ }

main().then(() => process.exit(0), (err) => { console.error('booruSources test FAILED:', err); process.exit(1) })
