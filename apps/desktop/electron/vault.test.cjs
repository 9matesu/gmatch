// node vault.test.cjs — exits 1 on failure (plain-node style, no runner).
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vault = require('./vault.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
vault.init(tmp)

// stub bytes: each URL maps to a small buffer with a mime
const blobs = {
  'https://x/a.jpg': { buf: Buffer.from('AAA', 'utf8'), mime: 'image/jpeg' },
  'https://x/b.png': { buf: Buffer.from('BBBB', 'utf8'), mime: 'image/png' },
  'https://x/c.mp4': { buf: Buffer.from('CCCCCC', 'utf8'), mime: 'video/mp4' },
}
vault._test.setFetcher(async (url) => {
  const hit = blobs[url]
  if (!hit) throw new Error('HTTP 404')
  return hit
})

async function main() {
  // miss before pin
  assert.strictEqual(vault.get('https://x/a.jpg'), null, 'miss = null')

  // pin stores + serves a vault:// URL
  const local = await vault.pin('https://x/a.jpg')
  assert.ok(local && local.startsWith('vault://f/'), `vault url, got ${local}`)
  assert.strictEqual(vault.get('https://x/a.jpg'), local, 'lookup hit after pin')
  const st = vault.stats()
  assert.strictEqual(st.files, 1)
  assert.strictEqual(st.bytes, 3)
  assert.strictEqual(st.quota, 3 * 1024 * 1024 * 1024)

  // pin again bumps pins, no duplicate file
  await vault.pin('https://x/a.jpg')
  assert.strictEqual(vault.stats().files, 1, 'no duplicate entry')

  // failed fetch returns null, stores nothing
  assert.strictEqual(await vault.pin('https://x/nope.jpg'), null, '404 = null')
  assert.strictEqual(vault.stats().files, 1)

  // unpin decrements but keeps bytes; remove deletes the file
  assert.strictEqual(vault.unpin('https://x/a.jpg'), true)
  assert.ok(vault.get('https://x/a.jpg'), 'bytes survive unpin')
  assert.strictEqual(vault.remove('https://x/a.jpg'), true)
  assert.strictEqual(vault.get('https://x/a.jpg'), null, 'gone after remove')
  assert.ok(!fs.existsSync(path.join(tmp, local.split('/').pop())), 'file deleted')

  // quota: shrink via manifest pressure — pins protect keeps
  await vault.pin('https://x/b.png') // pins=1
  await vault.pin('https://x/c.mp4')
  vault.unpin('https://x/c.mp4') // evictable
  // quota pressure evicts the unpinned entry first, never the pinned keep
  const ok = vault._test.makeRoom(3 * 1024 * 1024 * 1024)
  assert.strictEqual(ok, false, '3GB more cannot fit under a 3GB quota')
  assert.strictEqual(vault.get('https://x/c.mp4'), null, 'unpinned entry evicted under pressure')
  assert.ok(vault.get('https://x/b.png'), 'pinned keep survives pressure')

  // manifest persists across init
  vault.init(tmp)
  assert.ok(vault.get('https://x/b.png'), 'manifest reloaded from disk')

  // clear wipes everything
  vault.clear()
  assert.deepStrictEqual([vault.stats().files, vault.stats().bytes], [0, 0])
  assert.strictEqual(vault.get('https://x/b.png'), null)

  // key shape: sha256 + preserved ext
  assert.match(vault._test.keyFor('https://x/a.jpg'), /^[0-9a-f]{64}\.jpg$/)

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('vault: all assertions passed')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('vault test FAILED:', err)
    process.exit(1)
  },
)
