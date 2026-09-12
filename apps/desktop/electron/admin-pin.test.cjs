// node admin-pin.cjs test — plain asserts, mirrors customFolders.test.cjs.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adminpin-'))
delete process.env.ADMIN_PIN
const { adminPin } = require('./admin-pin.cjs')

const first = adminPin(dir)
assert.match(first, /^[0-9a-f]{8}$/, 'generated PIN is 8 hex chars')
assert.strictEqual(fs.readFileSync(path.join(dir, 'admin-pin.txt'), 'utf8').trim(), first, 'PIN persisted to userData')
assert.strictEqual(adminPin(dir), first, 'second call reuses the saved PIN (stable across launches)')

process.env.ADMIN_PIN = 'env-pin'
assert.strictEqual(adminPin(dir), 'env-pin', 'env overrides the file')
delete process.env.ADMIN_PIN

fs.writeFileSync(path.join(dir, 'admin-pin.txt'), 'garbage!')
assert.match(adminPin(dir), /^[0-9a-f]{8}$/, 'corrupt file regenerates a valid PIN')

console.log('admin-pin tests passed')
