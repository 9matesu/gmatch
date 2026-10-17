const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const vault = require('./vault.cjs')

/** Minimal fetch stub: one media response, streamed in 64KB chunks. */
function mediaResponse(buf, mime) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n) => (String(n).toLowerCase() === 'content-type' ? mime : String(buf.length)) },
    body: {
      getReader: () => {
        let off = 0
        return {
          read: async () => {
            if (off >= buf.length) return { done: true, value: undefined }
            const end = Math.min(off + 64 * 1024, buf.length)
            const slice = buf.subarray(off, end)
            off = end
            return { done: false, value: slice }
          },
          cancel: async () => {},
        }
      },
    },
  })
}

async function testVault() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
  try {
    vault.init(tmpDir)

    // Test 1: get() on non-existent returns null
    assert.strictEqual(vault.get('https://example.com/pic.jpg'), null)

    // Test 2: pin() with mock fetcher
    const mockFetcher = async (url) => ({
      buf: Buffer.from('fake image data bytes'),
      mime: 'image/jpeg',
    })
    vault._test.setFetcher(mockFetcher)
    const pinned = await vault.pin('https://example.com/pic.jpg')
    assert(pinned.startsWith('vault://f/'), 'must return vault://f/ URL')

    // Test 3: get() on vault://f/<key> returns the vault url itself if file exists
    const directHit = vault.get(pinned)
    assert.strictEqual(directHit, pinned, 'get(vault://f/key) must return itself when local')

    // Test 4: pin() on vault://f/<key> returns the vault url directly
    const pinDirect = await vault.pin(pinned)
    assert.strictEqual(pinDirect, pinned, 'pin(vault://f/key) must return itself')

    // Test 5: pin() on gmcache:// resolves from disk cache directly
    const diskCache = require('./diskImageCache.cjs')
    diskCache.init(tmpDir, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    diskCache.put('testkey123.jpg', Buffer.from('cached image bytes'), 'image/jpeg')
    const gmPinned = await vault.pin('gmcache://testkey123.jpg')
    assert(gmPinned && gmPinned.startsWith('vault://f/'), 'gmcache pin must succeed and return vault://f/ url')

    console.log('vault-pin: all assertions passed')

    // pinStream: chunked disk writes, incremental hash, no per-file cap.
    const big = Buffer.alloc(300 * 1024, 7)
    const nodeCrypto = require('crypto')
    const wantHash = nodeCrypto.createHash('sha256').update(big).digest('hex')
    const streamUrl = 'https://cdn.example.com/clip.mp4'
    const origFetch = global.fetch
    // The vault's byte fetcher is imageCache.fetchBinary (real net stack);
    // tests replace it with a stub so nothing leaves the process.
    const imageCache = require('./imageCache.cjs')
    const origFetcher = imageCache.fetchBinary
    imageCache.fetchBinary = async () => { throw new Error('no network in tests') }
    global.fetch = mediaResponse(big, 'video/mp4')
    try {
      const seen = []
      const r = await vault.pinStream(streamUrl, { onProgress: (p) => seen.push(p) })
      assert.strictEqual(r.ok, true, 'pinStream must succeed past the 200MB image-oriented cap')
      assert.strictEqual(r.bytes, big.length)
      assert.strictEqual(r.hash, wantHash, 'incremental hash must match the bytes')
      assert(seen.length > 0, 'progress reported during streaming')
      assert.strictEqual(seen[seen.length - 1].bytes, big.length)
      // Read-back: vault lookup resolves only when the file is on disk.
      const got = vault.get(streamUrl)
      assert(got && got.startsWith('vault://f/'), 'read-back resolves the stored file')
      // No .part leftovers: incomplete writes never read as complete.
      const leftovers = fs.readdirSync(require('path').join(tmpDir, 'media-vault')).filter((f) => f.includes('.part-'))
      assert.strictEqual(leftovers.length, 0, 'no partial files remain')
    } finally {
      global.fetch = origFetch
      imageCache.fetchBinary = origFetcher
    }

    // pinStream: non-media content-type is refused, nothing stored.
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    })
    try {
      const r2 = await vault.pinStream('https://cdn.example.com/page.html')
      assert.strictEqual(r2.ok, false)
      assert.strictEqual(vault.get('https://cdn.example.com/page.html'), null)
    } finally {
      global.fetch = origFetch
    }

    // pinStream quota: overflow evicts UNPINNED entries (parity with pin())
    // instead of refusing, and a pinned keep is never evicted.
    const QUOTA = 3 * 1024 * 1024 * 1024
    const manifest = vault._test.manifest()
    imageCache.fetchBinary = async () => { throw new Error('no network in tests') }
    manifest['https://old.example.com/huge.png'] = {
      key: 'old-huge.png', mime: 'image/png', bytes: QUOTA, atime: 1, pins: 0,
    }
    global.fetch = mediaResponse(big, 'video/mp4')
    try {
      const r3 = await vault.pinStream('https://cdn.example.com/evict.mp4')
      assert.strictEqual(r3.ok, true, 'streaming pin must evict unpinned entries to fit')
      assert.strictEqual(manifest['https://old.example.com/huge.png'], undefined, 'unpinned entry evicted')

      // Everything else pinned: the quota can no longer be honored, so refuse
      // honestly instead of evicting a keepsake.
      manifest['https://keep.example.com/pinned.png'] = {
        key: 'pinned.png', mime: 'image/png', bytes: QUOTA, atime: 2, pins: 1,
      }
      const r4 = await vault.pinStream('https://cdn.example.com/too-big.mp4')
      assert.strictEqual(r4.ok, false, 'pinned keeps are never evicted to fit')
      assert.strictEqual(r4.reason, 'quota')
      assert(manifest['https://keep.example.com/pinned.png'], 'pinned keep survives')
      assert.strictEqual(vault.get('https://cdn.example.com/too-big.mp4'), null)
      delete manifest['https://keep.example.com/pinned.png']
    } finally {
      global.fetch = origFetch
    }

    console.log('vault-pin-stream: all assertions passed')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

testVault().catch((err) => {
  console.error(err)
  process.exit(1)
})
