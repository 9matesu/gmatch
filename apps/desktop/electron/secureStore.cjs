// Main-process secure KV (security plan B.3 / F3): renderer "localStorage"
// for designated sensitive keys is backed by Electron safeStorage (DPAPI on
// Windows — encrypted under the user's logon) instead of Leveldb plaintext.
// Values are per-key encrypted; the persistence file never contains
// plaintext when encryption is available. When it is NOT (dev mode on
// Linux/mac without keyring), it degrades to plaintext and the renderer
// keeps working — the identity modal shows the warning (isAvailable false).
//
// Factory pattern: createSecureStore({ userDataPath, available,
// encryptString, decryptString }) so the core is testable without Electron.
const fs = require('fs')
const path = require('path')

const MAGIC = 'gsk1' // file format tag

function hexBuf(hex) {
  return Buffer.from(hex, 'hex')
}
function bufHex(buf) {
  return Buffer.from(buf).toString('hex')
}

function createSecureStore({ userDataPath, available, encryptString, decryptString, debounceMs = 1500 }) {
  const file = path.join(userDataPath, 'secure-kv.bin')
  /** key -> { ivHex, ctHex } (already-encrypted envelope) */
  let entries = {}
  let dirty = false
  let timer = null

  // Load existing (best-effort; a corrupt file starts empty, never crashes).
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.magic === MAGIC && parsed.entries) entries = parsed.entries
  } catch {
    /* first run or corrupt — empty */
  }

  function encryptValue(plain) {
    if (!available) return { plain: bufHex(Buffer.from(String(plain), 'utf8')) }
    const iv = require('crypto').randomBytes(12)
    const ct = encryptString(String(plain), iv)
    return { iv: bufHex(iv), ct: bufHex(ct) }
  }

  function decryptValue(env) {
    if (!env) return null
    if (env.plain !== undefined) return hexBuf(env.plain).toString('utf8')
    try {
      return decryptString(hexBuf(env.ct), hexBuf(env.iv))
    } catch {
      return null // wrong machine/user: behave like first run
    }
  }

  function flush() {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ magic: MAGIC, entries }), 'utf8')
    dirty = false
  }

  function scheduleFlush() {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (dirty) flush()
    }, debounceMs)
  }

  return {
    filePath: file,
    get(key) {
      const env = entries[key]
      return env ? decryptValue(env) : null
    },
    set(key, value) {
      entries[key] = encryptValue(value)
      scheduleFlush()
    },
    delete(key) {
      delete entries[key]
      scheduleFlush()
    },
    keys() {
      return Object.keys(entries)
    },
    has(key) {
      return !!entries[key]
    },
    flush,
  }
}

module.exports = { createSecureStore, MAGIC }
