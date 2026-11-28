// node cacheVault.test.cjs — exits 1 on failure (plain-node CJS style).
// The picture cache is an evictable LRU; the vault is permanent. Clearing the
// cache must never delete a vault file or its manifest, even when both live
// under the same userData directory.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const cache = require('./imageCache.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-cache-vault-'))
try {
  cache.init(tmp, 'gmatch-test-agent', 'a'.repeat(64))

  // Plant one encrypted cache picture through the real cache write path.
  assert.strictEqual(cache._test.putBytes('cached', Buffer.from('cache bytes')), true)
  cache._test.setMeta('https://cdn.example/cached.jpg', {
    key: 'cached', hash: 'b'.repeat(64), mime: 'image/jpeg', bytes: 11,
  })
  cache._test.saveIndex()
  assert.ok(fs.existsSync(path.join(tmp, 'imgcache', 'cached.enc')), 'cache file planted')

  // Plant a permanent vault keep under the SAME userData root.
  const vaultDir = path.join(tmp, 'media-vault')
  fs.mkdirSync(vaultDir, { recursive: true })
  const hash = 'c'.repeat(64)
  const vaultFile = path.join(vaultDir, hash)
  fs.writeFileSync(vaultFile, 'permanent keepsake bytes')
  const manifestFile = path.join(vaultDir, 'manifest.json')
  fs.writeFileSync(manifestFile, JSON.stringify({
    'https://cdn.example/keep.jpg': { file: hash, hash, mime: 'image/jpeg', bytes: 23, atime: Date.now(), pins: 1, enc: true },
  }))

  const stats = cache.clearCache()
  assert.strictEqual(stats.files, 0, 'the cache was cleared')
  assert.strictEqual(fs.existsSync(path.join(tmp, 'imgcache', 'cached.enc')), false, 'cache bytes are gone')
  assert.strictEqual(fs.existsSync(vaultFile), true, 'the vault file survives cache:clear')
  assert.strictEqual(fs.readFileSync(vaultFile, 'utf8'), 'permanent keepsake bytes', 'vault bytes unchanged')
  assert.strictEqual(fs.existsSync(manifestFile), true, 'the vault manifest survives cache:clear')
  assert.strictEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))[Object.keys(JSON.parse(fs.readFileSync(manifestFile, 'utf8')))[0]].hash, hash)

  // The one-time legacy purge must not reach the vault either.
  const marker = path.join(tmp, '.legacy-cache-purged')
  fs.rmSync(marker, { force: true })
  cache._test.destroyDiskCaches(tmp)
  assert.strictEqual(fs.existsSync(vaultFile), true, 'the vault survives the legacy cache purge')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('cache-vault separation tests OK')
