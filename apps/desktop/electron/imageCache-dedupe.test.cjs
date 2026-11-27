// node imageCache-dedupe.test.cjs — the cache holds one file per PICTURE,
// not one per URL. Two mirrors serving identical bytes must share the same
// encrypted .enc and the viewer must show one tile, newest-first.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const cache = require('./imageCache.cjs')
const mem = require('./diskImageCache.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-imgcache-dedupe-'))
const KEY_HEX = 'a'.repeat(64)
const URL_A = 'https://mirror-a.test/1.jpg'
const URL_B = 'https://mirror-b.test/2.jpg'

async function main() {
  cache.init(dir, 'UA', KEY_HEX)

  // Same plaintext under two "urls" => one file, second write is a no-op.
  const first = mem.putContent(Buffer.from('identical-picture'), 'jpg')
  const again = mem.putContent(Buffer.from('identical-picture'), 'jpg')
  assert.ok(first && again, 'both content puts succeed')
  assert.strictEqual(first.hash, again.hash, 'content hash is stable')
  assert.strictEqual(again.reused, true, 'a repeat of the bytes is not rewritten')
  assert.strictEqual(mem.size(), 1, 'identical bytes occupy one file')
  // The same bytes served with a PNG MIME must not occupy a second file: the
  // disk key is the content hash alone; the label stays in the url index.
  const png = mem.putContent(Buffer.from('identical-picture'), 'png')
  assert.ok(png && png.reused, 'a MIME variant reuses the existing file')
  assert.strictEqual(png.key, first.key, 'jpeg and png share one content key')
  assert.strictEqual(mem.size(), 1, 'two MIME variants still occupy one file')
  mem.putContent(Buffer.from('a different picture'), 'jpg')
  assert.strictEqual(mem.size(), 2, 'different bytes still occupy their own file')

  // Two urls pointing at that one file produce ONE viewer row (the newest).
  cache._test.setMeta(URL_A, { key: first.key, hash: first.hash, mime: 'image/jpeg', bytes: 16, ts: 1000 })
  cache._test.setMeta(URL_B, { key: first.key, hash: first.hash, mime: 'image/jpeg', bytes: 16, ts: 2000 })
  cache._test.saveIndex()
  const items = cache.list()
  assert.strictEqual(items.length, 1, 'the viewer dedupes by content hash')
  assert.strictEqual(items[0].url, URL_B, 'the newest sighting wins')
  assert.strictEqual(items[0].hash, first.hash, 'the row carries its content hash')

  // Both urls still resolve from disk — no network in this test, so a fetch
  // attempt would answer null and fail this assertion.
  assert.strictEqual(await cache.cacheImage(URL_A), `gmcache://f/${first.key}`)
  assert.strictEqual(await cache.cacheImage(URL_B), `gmcache://f/${first.key}`)

  // The deduped index survives a restart.
  cache.init(dir, 'UA', KEY_HEX)
  assert.strictEqual(cache.list().length, 1, 'the deduped row survives a restart')
  assert.strictEqual(await cache.cacheImage(URL_B), `gmcache://f/${first.key}`)

  // Pruning still works: when the LRU drops the shared file, every alias goes.
  const encFile = `${first.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.enc`
  fs.unlinkSync(path.join(dir, 'imgcache', encFile))
  cache.init(dir, 'UA', KEY_HEX)
  assert.strictEqual(cache.list().length, 0, 'a dropped content file prunes all aliases')

  console.log('imageCache content-dedupe tests OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })
