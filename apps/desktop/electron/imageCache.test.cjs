// node imageCache.test.cjs — exits 1 on failure (plain-node CJS style, same
// as imageCacheMemory.test.cjs). Covers the feed-query memo budget: the cache
// must prune to FEED_MAX_QUERIES (oldest-first) so RAM stays selective.
const assert = require('assert')
const cache = require('./imageCache.cjs')

cache.clearCache()

// Seed 41 distinct queries with a minimal post each.
for (let i = 0; i < 41; i++) {
  cache.setFeedCache(`tag${i}`, [{ id: `p${i}`, url: `http://x/${i}.jpg`, tags: `tag${i}` }])
}

// The first queries must already be evicted: budget is 40 (was 100).
assert.strictEqual(
  cache.getFeedCache('tag0'), null,
  `tag0 should be evicted at 41 queries (found ${JSON.stringify(cache.getFeedCache('tag0'))})`,
)
// The newest must survive.
const newest = cache.getFeedCache('tag40')
assert.ok(Array.isArray(newest) && newest.length === 1, 'newest query survives')

// TTL staleness prunes too: rewrite tag40, read immediately (fresh) — sanity.
assert.ok(cache.getFeedCache('tag40'), 'fresh hit')

console.log('imageCache feed-memo tests OK')
