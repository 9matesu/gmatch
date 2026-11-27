// node admin-pin.test.cjs — the install credential is a scrypt hash only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-pin-'))
delete process.env.ADMIN_PIN_HASH
delete require.cache[require.resolve('./admin-pin.cjs')]
const { adminPinHash, isPinHash } = require('./admin-pin.cjs')

const first = adminPinHash(dir)
assert.ok(isPinHash(first), 'factory credential is a salted scrypt hash')
assert.ok(!/^\d{6}$/.test(fs.readFileSync(path.join(dir, 'admin-pin.hash'), 'utf8').trim()), 'no plaintext PIN on disk')
assert.strictEqual(adminPinHash(dir), first, 'second call reuses the saved hash (stable across launches)')

process.env.ADMIN_PIN_HASH = 'scrypt$' + 'a'.repeat(32) + '$' + 'b'.repeat(64)
assert.strictEqual(adminPinHash(dir), process.env.ADMIN_PIN_HASH, 'env hash overrides the file')
delete process.env.ADMIN_PIN_HASH

fs.writeFileSync(path.join(dir, 'admin-pin.hash'), 'garbage!')
assert.ok(isPinHash(adminPinHash(dir)), 'corrupt hash file regenerates a valid hash')
console.log('admin-pin tests passed')
