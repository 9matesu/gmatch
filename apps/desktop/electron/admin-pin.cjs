'use strict'
// Host-mode admin credential (pure node — no electron import).
// The node stores ONLY a scrypt hash: ADMIN_PIN_HASH is injected into the
// sidecar, and userData/admin-pin.hash holds the same hash across launches.
// The plaintext PIN is never written to disk here or crossed into the renderer;
// the developer enters it at the console prompt. ADMIN_PIN_HASH in the
// environment wins (dev/QA), otherwise this install's factory hash is used.
// Same trust boundary as middleware/admin.ts: a disk owner can already rewrite
// orbit.sqlite, so this keeps casual LAN visitors out, not the disk owner.
const fs = require('node:fs')
const path = require('node:path')

// scrypt$<salt>$<digest> — salt + digest only, 16-byte salt / 32-byte dkLen.
const INSTALL_PIN_HASH = 'scrypt$3775fefe392ff35b72ab08d7ab245afb$1c1f2b735c11be1afd06e20627cdda3fb0e9e133581d3c340ee92d5da4f4d9f2'
const SCRYPT_HASH = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/i

function isPinHash(value) {
  return SCRYPT_HASH.test(String(value || '').trim())
}

function adminPinHash(userDataDir) {
  const fromEnv = (process.env.ADMIN_PIN_HASH || '').trim()
  if (fromEnv) return fromEnv
  const hashPath = path.join(userDataDir, 'admin-pin.hash')
  try {
    const saved = fs.readFileSync(hashPath, 'utf8').trim()
    if (isPinHash(saved)) return saved
  } catch { /* first run: write the factory hash below */ }
  try {
    fs.writeFileSync(hashPath, INSTALL_PIN_HASH)
  } catch (e) {
    console.warn('[api] could not persist admin PIN hash:', e.message)
  }
  return INSTALL_PIN_HASH
}

module.exports = { adminPinHash, isPinHash }
