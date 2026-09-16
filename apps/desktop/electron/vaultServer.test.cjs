// node vaultServer.test.cjs — exits 1 on failure (plain-node style).
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vault = require('./vault.cjs')
const vaultServer = require('./vaultServer.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-http-'))
vault.init(tmp)
vault._test.setFetcher(async () => ({ buf: Buffer.from('HTTPBODY', 'utf8'), mime: 'image/png' }))

async function main() {
  const local = await vault.pin('https://x/http.png')
  assert.ok(local, 'pin succeeded')

  const { origin } = await vaultServer.start(tmp, { port: 0 })
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, `localhost origin, got ${origin}`)

  const key = local.split('/').pop()
  const res = await fetch(`${origin}/f/${key}`)
  assert.strictEqual(res.status, 200, 'served over http')
  assert.strictEqual(res.headers.get('content-type'), 'image/png')
  assert.strictEqual(await res.text(), 'HTTPBODY')

  const ranged = await fetch(`${origin}/f/${key}`, { headers: { Range: 'bytes=0-3' } })
  assert.strictEqual(ranged.status, 206, 'range served')
  assert.strictEqual(await ranged.text(), 'HTTP')

  const miss = await fetch(`${origin}/f/deadbeef.png`)
  assert.strictEqual(miss.status, 404)

  await vaultServer.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('vaultServer: all assertions passed')
}

main().catch((err) => { console.error('vaultServer test FAILED:', err); process.exit(1) })
