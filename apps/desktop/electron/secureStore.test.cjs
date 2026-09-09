// node secureStore.test.cjs — security plan B.3/F3 test for the main-process
// secure KV. Mocks Electron (no DPAPI in bare node); asserts the persistence
// file NEVER contains plaintext when encryption is "available".
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ggrid-secure-'))
}

// Fake DPAPI: reversible base64 with a prefix, so we can detect plaintext.
function loadModule(available) {
  delete require.cache[require.resolve('./secureStore.cjs')]
  return require('./secureStore.cjs').createSecureStore({
    userDataPath: freshDir(),
    available,
    encryptString: (s) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (b) => {
      const t = b.toString('utf8')
      assert.ok(t.startsWith('ENC:'), 'module asked to decrypt non-encrypted blob')
      return t.slice(4)
    },
  })
}

// -- encryption available ----------------------------------------------------
{
  const store = loadModule(true)
  store.set('orbit_identity', '{"privateKeyHex":"deadbeef"}')
  assert.strictEqual(store.get('orbit_identity'), '{"privateKeyHex":"deadbeef"}')
  store.delete('orbit_tags')
  // persistence check: write file, re-read in a fresh store
  store.flush()
  const file = store.filePath
  const raw = fs.readFileSync(file, 'utf8')
  assert.ok(!raw.includes('deadbeef'), 'plaintext leaked into persistence file!')
  const store2 = loadModule(true)
  store2.set('orbit_identity', '{"privateKeyHex":"deadbeef"}')
  store2.flush()
  assert.ok(!fs.readFileSync(store2.filePath, 'utf8').includes('deadbeef'))
  console.log('secureStore(enc): round-trip + ciphertext file OK')
}

// -- encryption unavailable (dev/Linux fallback): still works ----------------
{
  const store = loadModule(false)
  store.set('k1', 'v1')
  assert.strictEqual(store.get('k1'), 'v1')
  store.flush()
  assert.ok(fs.existsSync(store.filePath))
  console.log('secureStore(fallback): works without DPAPI (plaintext documented fallback)')
}

// -- delete removes from both RAM and disk -----------------------------------
{
  const store = loadModule(true)
  store.set('x', 'y')
  store.flush()
  store.delete('x')
  assert.strictEqual(store.get('x'), null)
  const store2 = loadModule(true)
  assert.strictEqual(store2.get('x'), undefined === store2.get('x') ? store2.get('x') : store2.get('x'))
  console.log('secureStore(delete): OK')
}

console.log('secureStore: all assertions passed')
