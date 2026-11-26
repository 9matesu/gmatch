// node imageCache-thumb.test.cjs — exits 1 on failure (plain-node CJS style).
//
// The thumbnail route (`gmcache://thumb/<key>`) exists so a dense grid can
// render SMALL copies instead of decoding every picture at full size (a
// screen of full-size boorus was ~1 GB of decoded bitmaps).
//
// Outside Electron there is no `nativeImage`, so the thumbnailer cannot run.
// The route must then serve the ORIGINAL bytes — a tile still renders, it is
// just not smaller. It must never 404: a missing preview is worse than a
// full-size one.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const cache = require('./imageCache.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-thumb-'))
const KEY = 'thumbtest.png'
// A 1x1 PNG (valid bytes, small).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function main() {
  cache.init(tmp, 'ua', 'a'.repeat(64))
  assert.strictEqual(cache._test.putBytes(KEY, PNG), true, 'bytes are stored')

  // The full-size route serves the bytes.
  const full = await cache.serveImage(new Request(`gmcache://f/${KEY}`))
  assert.strictEqual(full.status, 200, 'the original route answers 200')
  const fullBytes = Buffer.from(await full.arrayBuffer())
  assert.strictEqual(fullBytes.length, PNG.length, 'the original bytes come back whole')

  // The thumbnail route answers too — with the original bytes when no
  // thumbnailer is available (this is the plain-node path).
  const thumb = await cache.serveImage(new Request(`gmcache://thumb/${KEY}`))
  assert.strictEqual(thumb.status, 200, 'the thumbnail route answers 200')
  const thumbBytes = Buffer.from(await thumb.arrayBuffer())
  assert.ok(thumbBytes.length > 0, 'the thumbnail route returns bytes')

  // An unknown key is still a miss (404), not a fabricated empty image.
  const miss = await cache.serveImage(new Request('gmcache://thumb/nope.png'))
  assert.strictEqual(miss.status, 404, 'an unknown key is a miss')

  // A path traversal attempt is refused.
  const bad = await cache.serveImage(new Request('gmcache://thumb/../secret.png'))
  assert.ok(bad.status === 400 || bad.status === 404, 'traversal is refused')

  console.log('imageCache thumbnail tests OK')
}

main()
  .then(() => fs.rmSync(tmp, { recursive: true, force: true }))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
