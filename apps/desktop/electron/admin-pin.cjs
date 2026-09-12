// Host-mode admin PIN (pure node — no electron import, mirrors updater-core).
// ADMIN_PIN env always wins (dev/QA). Otherwise one 8-hex PIN is minted per
// install and persisted at userData/admin-pin.txt so the developer — and any
// self-hoster — can unlock the admin panel in the packaged .exe without
// setting anything.
//
// Why a plaintext file is honest here: anyone who can read userData can
// already rewrite orbit.sqlite (is_admin is one UPDATE away), and
// apps/api/src/middleware/admin.ts documents that self-host DB-writers own
// the node. The PIN's real job is keeping casual LAN visitors out of the
// console on a host-mode node, not defending against the disk owner.
const fs = require('node:fs')
const path = require('node:path')

function adminPin(userDataDir) {
  const fromEnv = (process.env.ADMIN_PIN || '').trim()
  if (fromEnv) return fromEnv
  const pinPath = path.join(userDataDir, 'admin-pin.txt')
  try {
    const saved = fs.readFileSync(pinPath, 'utf8').trim()
    if (/^[0-9a-f]{8}$/.test(saved)) return saved
  } catch { /* first run: generate below */ }
  const pin = require('node:crypto').randomBytes(4).toString('hex')
  try {
    fs.writeFileSync(pinPath, pin)
  } catch (e) {
    console.warn('[api] could not persist admin PIN:', e.message)
  }
  return pin
}

module.exports = { adminPin }
