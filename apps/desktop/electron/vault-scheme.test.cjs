// node vault-scheme.test.cjs — exits 1 on failure (plain-node style).
// vault:// must be registered as a privileged scheme BEFORE app ready, or a
// sandboxed renderer cannot load it and every stored keep renders blank.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const block = src.slice(src.indexOf('registerSchemesAsPrivileged'), src.indexOf('registerSchemesAsPrivileged') + 900)

assert.ok(
  block.includes('vault.SCHEME') || block.includes("scheme: 'vault'") || block.includes('scheme: "vault"'),
  'vault scheme must be in registerSchemesAsPrivileged',
)
console.log('vault-scheme: assertion passed')
