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

  // parsed big video: >25MB (the IMAGE cap) pins under the VIDEO cap, and
  // serveVault answers Range with 206 + Content-Range (seekable mp4).
  const big = Buffer.alloc(26 * 1024 * 1024, 7)
  vault._test.setFetcher(async (url) => {
    // Mirror the real fetcher: http/https only. A non-http scheme throws
    // 'bad protocol' there, which is exactly what kept idle-file:// keeps
    // from ever reaching disk.
    const u = new URL(String(url))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol')
    return { buf: big, mime: 'video/mp4' }
  })
  const bigLocal = await vault.pin('https://x/big.mp4')
  assert.ok(bigLocal, '26MB video must pin under the video cap')
  const hit = await vault.serveVault(new Request(bigLocal, { headers: { Range: 'bytes=0-99' } }))
  assert.strictEqual(hit.status, 206, 'Range serves 206')
  assert.strictEqual(hit.headers.get('content-range'), `bytes 0-99/${big.length}`)
  assert.strictEqual((await hit.arrayBuffer()).byteLength, 100)
  const full = await vault.serveVault(new Request(bigLocal))
  assert.strictEqual(full.headers.get('accept-ranges'), 'bytes')
  assert.strictEqual(full.status, 200)

  // idle-file:// sources (player-owned idle folders) pin by reading the
  // granted path directly: the byte fetcher only speaks http/https, so
  // routing them through it threw 'bad protocol' and kepts never persisted.
  const customFolders = require('./customFolders.cjs')
  const picsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-pics-'))
  fs.writeFileSync(path.join(picsDir, 'local.jpg'), Buffer.from('LOCALBYTES', 'utf8'))
  customFolders.__test.setGrants([{ id: 'g1', path: picsDir }])
  const idleUrl = 'idle-file://g1/local.jpg'

  assert.strictEqual(vault.get(idleUrl), null, 'idle-file miss before pin')
  const idleLocal = await vault.pin(idleUrl)
  assert.ok(idleLocal && idleLocal.startsWith('vault://f/'), `idle-file pins, got ${idleLocal}`)
  assert.strictEqual(vault.get(idleUrl), idleLocal, 'idle-file lookup hit after pin')
  const idleServed = await vault.serveVault(new Request(idleLocal))
  assert.strictEqual(idleServed.status, 200)
  assert.strictEqual(await idleServed.text(), 'LOCALBYTES', 'granted bytes persisted')

  // traversal out of the grant must never pin
  assert.strictEqual(await vault.pin('idle-file://g1/..%2Fsecret.jpg'), null, 'traversal rejected')
  // unknown grant id pins nothing
  assert.strictEqual(await vault.pin('idle-file://nope/local.jpg'), null, 'unknown grant rejected')
  fs.rmSync(picsDir, { recursive: true, force: true })

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
