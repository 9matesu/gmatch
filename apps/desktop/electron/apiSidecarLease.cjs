'use strict'

// One launch owns the local API sidecar. `startApi()` is called from more than
// one place (boot, watchdog, an orphaned previous launch that still answers on
// :8790), so "probe, then spawn" is a TOCTOU: two callers can both see a free
// port and both spawn a Bun against it, and the loser dies with EADDRINUSE.
//
// The lease is an exclusive-create file in userData. It is a LAUNCH lease, not
// a security boundary: the pid identifies the Electron process that is allowed
// to spawn, and the token identifies this install's world (derived from the
// storage key, see apiSidecar.cjs). A caller that loses the race waits for the
// winner's healthy node instead of starting a second one.
const fs = require('node:fs')
const path = require('node:path')

const LEASE_FILE = 'api-lease.json'

function pidAlive(pid, impl) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    impl.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return Boolean(err && err.code === 'EPERM')
  }
}

/**
 * @param {{ directory: string, pid?: number, now?: () => number,
 *           fsImpl?: object, processImpl?: object }} opts
 */
function createApiLease({
  directory,
  pid = process.pid,
  now = () => Date.now(),
  fsImpl = fs,
  processImpl = process,
}) {
  const file = path.join(directory, LEASE_FILE)

  function read() {
    try {
      const raw = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
      return raw && typeof raw === 'object' ? raw : null
    } catch {
      return null
    }
  }

  function isAlive(lease) {
    return Boolean(lease && pidAlive(lease.pid, processImpl))
  }

  /** Claim the launch. Returns the lease that won, or null when another live
   *  launch owns it. A stale lease (dead pid) is reclaimed exactly once. */
  function acquire(token) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fsImpl.openSync(file, 'wx')
        try {
          fsImpl.writeSync(fd, JSON.stringify({ token, pid, at: now() }))
        } finally {
          fsImpl.closeSync(fd)
        }
        return read()
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err
        const existing = read()
        if (isAlive(existing)) return null
        // Nobody owns it any more. Only the caller that wins the next wx
        // actually owns the lease; the other losers re-read and back off.
        try { fsImpl.unlinkSync(file) } catch { /* already reclaimed */ }
      }
    }
    // Never claim a lease after two lost races: wait for the winner instead.
    return null
  }

  /** Release only OUR lease — never one another live launch just acquired. */
  function release(token) {
    const existing = read()
    if (!existing || existing.pid !== pid) return false
    if (token && existing.token !== token) return false
    try {
      fsImpl.unlinkSync(file)
      return true
    } catch {
      return false
    }
  }

  return { file, read, isAlive, acquire, release }
}

module.exports = { createApiLease, LEASE_FILE }
