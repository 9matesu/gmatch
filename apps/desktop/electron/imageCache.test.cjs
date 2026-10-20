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

// evict() drops a single URL entry from mem, false when absent.
assert.strictEqual(cache.evict('http://x/nope.jpg'), false)

// Legacy purge is a ONE-TIME migration, not per-boot work: a pre-1.1 install
// can leave hundreds of MB in image-cache/, and rm-ing it on every launch is
// disk work nobody asked for. The marker is what makes that true.
const os = require('os')
const fs = require('fs')
const path = require('path')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-legacy-cache-'))
try {
  fs.mkdirSync(path.join(tmp, 'image-cache'))
  fs.writeFileSync(path.join(tmp, 'image-cache', 'old.bin'), 'x')
  fs.writeFileSync(path.join(tmp, 'feed-cache.json'), '{}')
  cache._test.destroyDiskCaches(tmp)
  assert.strictEqual(fs.existsSync(path.join(tmp, 'image-cache')), false, 'legacy image-cache is removed')
  assert.strictEqual(fs.existsSync(path.join(tmp, 'feed-cache.json')), false, 'legacy feed cache is removed')

  // A later boot must NOT touch the path again (a downgraded build may have
  // recreated it; deleting it forever on every launch is the bug).
  fs.mkdirSync(path.join(tmp, 'image-cache'))
  fs.writeFileSync(path.join(tmp, 'image-cache', 'keep.bin'), 'y')
  cache._test.destroyDiskCaches(tmp)
  assert.strictEqual(fs.existsSync(path.join(tmp, 'image-cache', 'keep.bin')), true, 'purge did not run twice')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('imageCache feed-memo tests OK')
