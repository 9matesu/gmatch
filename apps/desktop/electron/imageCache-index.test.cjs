// node imageCache-index.test.cjs — the picture cache SURVIVES a restart.
//
// The cache used to be write-only: the .enc files persisted on disk, but the
// url -> key map lived in RAM, so after a restart every picture was
// re-downloaded and the 500MB on disk was unreachable. The index file closes
// that: the map is persisted next to the encrypted bytes.
//
// It is also what makes the cache VIEWABLE: the viewer lists what the device
// holds, and that list has to survive a relaunch too.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const cache = require('./imageCache.cjs')
const mem = require('./diskImageCache.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-imgcache-index-'))
const KEY_HEX = 'a'.repeat(64)
const URL_A = 'https://x.test/a.jpg'
// The disk cache sanitises the key for the filename, so keep it plain here.
const KEY_A = 'aaaaaaa1jpg'

async function main() {
  // --- boot 1: a picture lands in the cache -------------------------------
  cache.init(dir, 'UA', KEY_HEX)
  assert.strictEqual(mem.put(KEY_A, Buffer.from('hello-bytes')), true, 'the bytes are stored')
  cache._test.setMeta(URL_A, { key: KEY_A, mime: 'image/jpeg', bytes: 11 })
  cache._test.saveIndex()

  const indexFile = path.join(dir, 'imgcache', 'index.json')
  assert.ok(fs.existsSync(indexFile), 'the index file is written')

  // --- boot 2: the same install, a fresh process --------------------------
  cache.init(dir, 'UA', KEY_HEX)

  // The list survives: the viewer can show the cache after a relaunch.
  const items = cache.list()
  assert.strictEqual(items.length, 1, 'the cached picture is listed')
  assert.strictEqual(items[0].url, URL_A, 'the url is listed')
  assert.strictEqual(items[0].mime, 'image/jpeg', 'the mime is listed')
  assert.strictEqual(items[0].local, `gmcache://f/${KEY_A}`, 'the local url is listed')

  // The url resolves from disk WITHOUT downloading: no network in this test,
  // so a download attempt would fail the assertion.
  const resolved = await cache.cacheImage(URL_A)
  assert.strictEqual(resolved, `gmcache://f/${KEY_A}`, 'a cached picture resolves from disk after a restart')

  // --- a dangling entry is pruned -----------------------------------------
  // The LRU evicted the bytes while the app was closed: the index must not
  // keep pointing at a file that is gone (it would serve a 404 forever).
  fs.unlinkSync(path.join(dir, 'imgcache', `${KEY_A}.enc`))
  cache.init(dir, 'UA', KEY_HEX)
  assert.strictEqual(cache.list().length, 0, 'an entry whose bytes are gone is dropped')

  // --- an explicit evict removes the entry from the index too -------------
  cache.init(dir, 'UA', KEY_HEX)
  mem.put(KEY_A, Buffer.from('hello-bytes'))
  cache._test.setMeta(URL_A, { key: KEY_A, mime: 'image/jpeg', bytes: 11 })
  cache._test.saveIndex()
  assert.strictEqual(cache.evict(URL_A), true, 'the picture is evicted')
  cache.init(dir, 'UA', KEY_HEX)
  assert.strictEqual(cache.list().length, 0, 'an evicted picture does not come back after a restart')

  // --- a mid-session LRU drop is pruned from the viewer list --------------
  // The 500MB LRU can drop a file while the app runs; the viewer must never
  // show a tile whose local url 404s.
  cache.init(dir, 'UA', KEY_HEX)
  mem.put(KEY_A, Buffer.from('hello-bytes'))
  cache._test.setMeta(URL_A, { key: KEY_A, mime: 'image/jpeg', bytes: 11 })
  cache._test.saveIndex()
  assert.strictEqual(cache.list().length, 1, 'the picture is listed')
  mem.del(KEY_A) // the LRU dropped the bytes
  assert.strictEqual(cache.list().length, 0, 'a picture whose bytes are gone is not listed')

  console.log('imageCache index tests OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })
