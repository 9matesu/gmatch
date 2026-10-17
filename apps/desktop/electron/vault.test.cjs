// node vault.test.cjs — exits 1 on failure (plain-node style, no runner).
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vault = require('./vault.cjs')
const aeadFile = require('./aeadFile.cjs')

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
  assert.ok(!fs.existsSync(path.join(tmp, 'media-vault', local.split('/').pop())), 'file deleted')

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

  // content addressing: the file name IS the sha256 of the bytes, the bytes
  // are encrypted at rest, and a caller cannot file content under a foreign
  // hash. localRef (the record's single local identity) is that hash.
  const crypto = require('crypto')
  const aBytes = Buffer.from('AAA', 'utf8')
  const aHash = crypto.createHash('sha256').update(aBytes).digest('hex')
  const rePinned = await vault.pin('https://x/a.jpg')
  assert.strictEqual(rePinned, `vault://f/${aHash}`, 'file name is the content hash')
  assert.strictEqual(vault.get(aHash), `vault://f/${aHash}`, 'resolvable by content ref')
  const rawOnDisk = fs.readFileSync(path.join(tmp, 'media-vault', aHash))
  assert.ok(!rawOnDisk.includes(aBytes), 'bytes are encrypted on disk')
  assert.strictEqual(vault.putBytes('f'.repeat(64), 'image/jpeg', aBytes).ok, false, 'hash mismatch refused')
  assert.strictEqual(vault.putBytes(aHash, 'image/jpeg', aBytes).ok, true, 'verified put accepted')
  assert.strictEqual(vault.get(`local://${aHash}`), `vault://f/${aHash}`, 'anonymous put addressable by ref')
  assert.ok(vault.list().map((o) => o.ref).includes(aHash), 'list exposes the stored object')

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

  // A host serving an MP4 as application/octet-stream must still get the
  // VIDEO cap, not the 25MB image cap: /^video\//i fails on octet-stream, the
  // 40MB buffer then hit the image ceiling, pin() returned null and the clip
  // was never written. Cap by MIME *or* URL extension.
  vault._test.setFetcher(async () => ({ buf: Buffer.alloc(40 * 1024 * 1024, 9), mime: 'application/octet-stream' }))
  const mislabeled = await vault.pin('https://x/mislabeled.mp4')
  assert.ok(mislabeled, '40MB octet-stream mp4 must pin under the video cap')
  assert.strictEqual(vault.get('https://x/mislabeled.mp4'), mislabeled)

  // LEGACY MANIFEST (the shape every pre-content-hash install has on disk):
  // rows are keyed by source url and the file is named sha256(url).<ext>, with
  // no `hash`. A keep's local identity is sha256(BYTES), so `vault://f/<localRef>`
  // resolved nothing even though the bytes were right there, and the keepsake
  // viewer showed "media unavailable locally" over a file it could read.
  // The first hash lookup backfills and persists the content hash.
  const legacyParent = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-'))
  const legacyDir = path.join(legacyParent, 'media-vault')
  fs.mkdirSync(legacyDir, { recursive: true })
  const fileForUrl = (url) => `${vault._test.hashOf(Buffer.from(url))}.jpg`
  const legacyUrl = 'https://legacy.example/api/objects/aaa'
  const legacyBytes = Buffer.from('LEGACY-IMAGE-BYTES', 'utf8')
  const legacyFile = fileForUrl(legacyUrl)
  const legacyRef = vault._test.hashOf(legacyBytes)
  fs.writeFileSync(path.join(legacyDir, legacyFile), legacyBytes)

  const goneUrl = 'https://legacy.example/gone.jpg'
  const goneFile = fileForUrl(goneUrl)

  // Same key the app derives when storage.key is absent: sha256(userDataPath).
  const legacyKey = aeadFile.keyFrom(null, legacyParent)
  const encUrl = 'https://legacy.example/enc.jpg'
  const encFile = fileForUrl(encUrl)
  const encBytes = Buffer.from('ENC-IMAGE-BYTES', 'utf8')
  const encRef = vault._test.hashOf(encBytes)
  fs.writeFileSync(path.join(legacyDir, encFile), aeadFile.encrypt(encBytes, legacyKey))

  const corruptUrl = 'https://legacy.example/corrupt.jpg'
  const corruptFile = fileForUrl(corruptUrl)
  fs.writeFileSync(path.join(legacyDir, corruptFile), Buffer.from('not-an-envelope'))

  fs.writeFileSync(path.join(legacyDir, 'manifest.json'), JSON.stringify({
    [legacyUrl]: { key: legacyFile, mime: 'image/jpeg', bytes: legacyBytes.length, atime: Date.now(), pins: 1 },
    [goneUrl]: { key: goneFile, mime: 'image/jpeg', bytes: 12, atime: Date.now(), pins: 1 },
    [encUrl]: { key: encFile, mime: 'image/jpeg', bytes: encBytes.length, atime: Date.now(), pins: 1, enc: 1 },
    [corruptUrl]: { key: corruptFile, mime: 'image/jpeg', bytes: 4, atime: Date.now(), pins: 1, enc: 1 },
  }))

  vault.init(legacyParent)
  assert.strictEqual(vault.stats().files, 4, 'legacy rows load')
  assert.strictEqual(vault.stats().objects, 0, 'legacy rows carry no content hash')

  // Legacy url lookup worked all along; the CONTENT REF (the keep's own
  // identity) is what was broken.
  assert.strictEqual(vault.get(legacyUrl), `vault://f/${legacyFile}`, 'url lookup still works')
  assert.strictEqual(
    vault.get(`vault://f/${legacyRef}`), `vault://f/${legacyFile}`,
    'content ref now resolves a legacy row (backfilled)',
  )
  assert.strictEqual(
    vault.get(`vault://f/${encRef}`), `vault://f/${encFile}`,
    'backfill decrypts an encrypted legacy row before hashing it',
  )
  assert.strictEqual(vault.stats().objects, 2, 'both readable legacy rows are indexed by content')

  // The backfill is persisted: a later launch must not re-read the files.
  const persisted = JSON.parse(fs.readFileSync(path.join(legacyDir, 'manifest.json'), 'utf8'))
  assert.strictEqual(persisted[legacyUrl].hash, legacyRef, 'backfilled hash is written to the manifest')
  assert.strictEqual(persisted[encUrl].hash, encRef, 'backfilled hash of the encrypted row is written too')

  // probe(): honest states. Bytes that are here but unreadable must never be
  // reported as absent, and the record must survive the lookup.
  assert.deepStrictEqual(vault.probe(legacyUrl), { state: 'local', local: `vault://f/${legacyFile}` })
  assert.deepStrictEqual(
    vault.probe(goneUrl), { state: 'unreadable', reason: 'missing-file' },
    'a vanished file is unreadable, not absent',
  )
  assert.deepStrictEqual(
    vault.probe(corruptUrl), { state: 'unreadable', reason: 'decrypt' },
    'a corrupt envelope is a diagnosable decrypt failure',
  )
  assert.ok(vault._test.manifest()[goneUrl], 'an unreadable row is never dropped')
  assert.ok(vault._test.manifest()[corruptUrl], 'a corrupt row is never dropped')
  assert.deepStrictEqual(
    vault.probe(`vault://f/${'d'.repeat(64)}`), { state: 'absent' },
    'an unknown ref is a real miss',
  )
  fs.rmSync(legacyParent, { recursive: true, force: true })

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
