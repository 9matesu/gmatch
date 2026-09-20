const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const vault = require('./vault.cjs')

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
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

testVault().catch((err) => {
  console.error(err)
  process.exit(1)
})
