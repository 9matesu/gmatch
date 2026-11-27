// API sidecar: spawns the vendored Orbit Hono/Bun server as a child process,
// persists to userData, waits for /api/health. (Plan D3.)
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { createHash } = require('node:crypto')
const { adminPin } = require('./admin-pin.cjs')
const { createApiLease } = require('./apiSidecarLease.cjs')

const PORT = Number(process.env.GMATCH_API_PORT || 8790)
const API_BASE = `http://127.0.0.1:${PORT}`
// Bounds for "someone else is already bringing the node up". Two launches
// racing to bind :8790 must resolve by waiting for the winner's health, never
// by spawning a second Bun (EADDRINUSE kills the loser and can kill the winner).
const ADOPT_WAIT_MS = Number(process.env.GMATCH_ADOPT_WAIT_MS || 30_000)
const PORT_FREE_WAIT_MS = Number(process.env.GMATCH_PORT_FREE_WAIT_MS || 5_000)

let proc = null
let intentionalStop = false
let lease = null
let currentInstanceId = null
/** Emits 'crashed' (exit code) when the child dies outside a planned stop. */
const sidecarEvents = new EventEmitter()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Identity of THIS install's world, derived from the persisted storage key.
 *  The node echoes it in /api/health, so a packaged host can adopt a sidecar
 *  left by a previous launch of the same install but never a foreign node on
 *  :8790 (adopting that would silently point the app at someone else's data). */
function instanceIdFor(storageKey) {
  return createHash('sha256').update(String(storageKey)).digest('hex')
}

/** One short health read. `db_ready` is required for adoption (the node is
 *  accepting requests), and `instance_id` is the ownership proof above. */
async function probeHealth(timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
    if (!r.ok) return { ready: false, instanceId: null }
    const body = await r.json()
    return {
      ready: Boolean(body && body.db_ready),
      instanceId: body && body.instance_id ? String(body.instance_id) : null,
    }
  } catch {
    return { ready: false, instanceId: null }
  } finally {
    clearTimeout(timer)
  }
}

/** True when 127.0.0.1:PORT is bound. A bind probe is the only authoritative
 *  answer (a fetch can fail while a half-started node still holds the port). */
function portOccupied() {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', (err) => resolve(Boolean(err && (err.code === 'EADDRINUSE' || err.code === 'EACCES'))))
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(PORT, '127.0.0.1')
  })
}

/** Wait until no process holds :8790 (used after killing a hung child). */
async function waitForPortFree({ timeoutMs = PORT_FREE_WAIT_MS, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (await portOccupied()) {
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
  return true
}

async function waitFor(check, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

/** Resolve the real bun executable (npm shims are .cmd wrappers that
 *  child_process.spawn can't exec directly on Windows). */
function bunBin() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* keep looking */
    }
  }
  return 'bun'
}

async function startApi() {
  intentionalStop = false
  // At-rest encryption key for blobs/PMs (apps/api/src/crypto.ts hard-requires
  // a 64-hex key). Generate once per install and persist in userData so a raw
  // DB dump never yields plaintext — and so packaged host mode can take
  // uploads without the user installing anything.
  let storageKey = process.env.STORAGE_ENCRYPTION_KEY
  if (!storageKey) {
    const keyPath = path.join(app.getPath('userData'), 'storage.key')
    try {
      storageKey = fs.readFileSync(keyPath, 'utf8').trim()
    } catch {
      /* generate below */
    }
    if (!/^[0-9a-f]{64}$/i.test(storageKey || '')) {
      storageKey = require('node:crypto').randomBytes(32).toString('hex')
      try { fs.writeFileSync(keyPath, storageKey) } catch (e) { console.warn('[api] could not persist storage key:', e.message) }
    }
  }
  // Host mode: the app IS the server. Spawn the
  // BUNDLED api-stage (bun.exe + self-contained server) so nothing needs to
  // be installed on the machine. Dev keeps the repo-local sidecar path.
  const resourcesApi = app.isPackaged
    ? path.join(process.resourcesPath, 'api', 'apps', 'api')
    : null
  const bundledBun = app.isPackaged
    ? path.join(process.resourcesPath, 'api', 'bun.exe')
    : null

  const instanceId = instanceIdFor(storageKey)
  currentInstanceId = instanceId
  const hostOwned = app.isPackaged && Boolean(process.env.GMATCH_HOST_MODE)
  // Packaged host mode may only adopt THIS install's node; an unrelated node
  // that happens to sit on :8790 is never allowed to become our world.
  const ours = (health) => health.ready && (!hostOwned || health.instanceId === instanceId)
  const adopt = (reason) => {
    console.log(`[api] adopting existing sidecar at ${API_BASE} (${reason})`)
    return true
  }

  const first = await probeHealth(2500)
  if (first.ready) {
    if (ours(first)) return adopt('healthy')
    throw new Error(`port ${PORT} is served by a different node; refusing to spawn`)
  }

  // A bound port with no health answer means a launch is mid-boot (or a hung
  // node is still holding it). Spawning now is the classic EADDRINUSE race —
  // wait for the winner's node and adopt it instead.
  if (await portOccupied()) {
    if (await waitFor(async () => ours(await probeHealth(1000)), ADOPT_WAIT_MS)) {
      return adopt('port held by starting node')
    }
    throw new Error(`port ${PORT} is occupied by a node that never became healthy; refusing to spawn`)
  }

  // Exclusive launch lease: two callers that both saw a free port must not
  // both spawn. The loser waits for the winner's healthy node.
  const launchLease = createApiLease({ directory: app.getPath('userData') })
  if (!launchLease.acquire(instanceId)) {
    if (await waitFor(async () => ours(await probeHealth(1000)), ADOPT_WAIT_MS)) {
      return adopt('another launch owns the lease')
    }
    throw new Error('another launch is starting the local node; refusing to spawn against it')
  }
  lease = launchLease
  // Close the bind-check -> spawn window: a dying predecessor can release the
  // port a moment after we checked it.
  if (!(await waitForPortFree())) {
    const becameHealthy = await waitFor(async () => ours(await probeHealth(1000)), ADOPT_WAIT_MS)
    launchLease.release(instanceId)
    lease = null
    if (becameHealthy) return adopt('port claimed by our own starting node')
    throw new Error(`port ${PORT} did not become free before spawn`)
  }
  const apiDir = resourcesApi || path.join(__dirname, '..', '..', 'api')
  const bunPath = bundledBun || bunBin()
  try {
    const { app: electronApp } = require('electron')
    console.log(`[api] spawning ${bunPath} in ${apiDir} (packaged=${electronApp.isPackaged})`)
  } catch { /* logging only */ }

  // ADMIN_PIN, and why it is or is not injected.
  //
  // In a PACKAGED install there is no repo, so a self-hoster has nowhere to
  // configure one: the generated per-install 8-hex PIN is minted, persisted to
  // userData/admin-pin.txt, and shown in Settings -> Server. That is the whole
  // point of it.
  //
  // Unpackaged (running from the repo) we deliberately do NOT inject it. A real
  // process env var beats a `.env` file in Bun, so injecting here SHADOWED
  // apps/api/.env.local — the developer set ADMIN_PIN in .env.local, the
  // sidecar overrode it with a random 8-hex, and their passcode silently did
  // not work with nothing in the UI to explain why. In dev, .env.local is the
  // single source of truth and the launcher stops fighting it.
  const injected = app.isPackaged ? adminPin(app.getPath('userData')) : null
  if (!injected) {
    console.log(
      '[api] no ADMIN_PIN injected — the node reads ADMIN_PIN/ADMIN_PIN_HASH ' +
        'from apps/api/.env.local or the ambient environment',
    )
  }
  const entry = fs.existsSync(path.join(apiDir, 'serve.js')) ? 'serve.js' : 'src/serve.ts'
  proc = spawn(bunPath, ['run', entry], {
    cwd: apiDir,
    env: {
      ...process.env,
      ...(injected ? { ADMIN_PIN: injected } : {}),
      PORT: String(PORT),
      // The node echoes this in /api/health so a later launch can prove the
      // process on :8790 is THIS install's node before adopting it.
      GMATCH_INSTANCE_ID: instanceId,
      STORAGE_ENCRYPTION_KEY: storageKey,
      SNAPSHOT_PATH: path.join(app.getPath('userData'), 'orbit.sqlite'),
      BLOB_STORE_DIR: path.join(app.getPath('userData'), 'blobs'),
      // The release feed this node offers its peers (empty by default: a node
      // serves a portable build only if its operator put one there).
      RELEASES_DIR: path.join(app.getPath('userData'), 'releases'),
      BLOCKLIST_PATH: (() => {
        const userPath = path.join(app.getPath('userData'), 'blocklist.json')
        if (require('node:fs').existsSync(userPath)) return userPath
        return app.isPackaged
          ? path.join(process.resourcesPath, 'shared', 'blocklist.json')
          : path.join(__dirname, '..', '..', '..', 'shared', 'blocklist.json')
      })(),
      // Gossip pull (plan G1): packaged hosts replicate public posts from an
      // upstream relay. Opt-in only — set GMATCH_GOSSIP_UPSTREAM to a full node
      // URL, or 'off' to disable. No hosted upstream by default.
      ...(process.env.GMATCH_GOSSIP_UPSTREAM && process.env.GMATCH_GOSSIP_UPSTREAM !== 'off'
        ? { GOSSIP_UPSTREAM: process.env.GMATCH_GOSSIP_UPSTREAM }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const childLog = (kind) => (d) => {
    const line = String(d).trim()
    if (!line) return
    // A closed log pipe makes console.* raise EPIPE. That arrives as an async
    // 'error' EVENT on the stream, so this try/catch cannot catch it — the
    // real guard is stdio-guard.cjs (installed in main.cjs). The try/catch
    // still covers a synchronous throw, and the guard keeps the app alive.
    try {
      (kind === 'out' ? console.log : console.error)(`[api${kind === 'err' ? '!' : ''}]`, line)
    } catch {
      /* log sink closed: drop the line */
    }
    sidecarEvents.emit('stderr', `${kind}:${line}`.slice(0, 500))
  }
  // Swallow stream errors on the log pipes: EPIPE/ECONNRESET here is normal
  // when the parent closes the read end, not a crash.
  proc.stdout.on('error', () => {})
  proc.stderr.on('error', () => {})
  proc.stdout.on('data', childLog('out'))
  proc.stderr.on('data', childLog('err'))
  const releaseLease = () => {
    if (!lease) return
    try { lease.release(instanceId) } catch { /* best effort */ }
    lease = null
  }
  proc.on('error', (err) => {
    console.error('[api] sidecar spawn failed:', err.message)
    proc = null
    releaseLease()
  })
  proc.on('exit', (code) => {
    proc = null
    // A crashed child frees the launch slot; the supervisor must be able to
    // restart it without waiting on a lease that no process owns.
    releaseLease()
    if (!intentionalStop && code !== 0) sidecarEvents.emit('crashed', code)
  })
  try {
    for (let i = 0; i < 60; i++) {
      // If the child died or failed to spawn, stop waiting — a stale listener
      // on the port must not masquerade as a healthy sidecar.
      if (!proc) throw new Error('API sidecar process is not running')
      // Each poll has its own timeout: one hung connection (a stale sidecar
      // holding :8790) must not stall boot forever (1.2.5 "Task Mgr spin").
      const health = await probeHealth(5000)
      if (health.ready) {
        if (ours(health)) return true
        throw new Error(`port ${PORT} is served by a different node; refusing to adopt it`)
      }
      await sleep(500)
    }
    throw new Error('API sidecar failed to start within 30s')
  } catch (err) {
    releaseLease()
    throw err
  }
}

function stopApi() {
  intentionalStop = true
  if (proc) {
    const pid = proc.pid
    try {
      if (process.platform === 'win32' && pid) {
        const { execSync } = require('node:child_process')
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }) } catch { /* already dead */ }
      }
    } catch { /* best effort */ }
    try {
      proc.kill('SIGKILL')
    } catch { /* already dead */ }
    proc = null
  }
  if (lease) {
    try { lease.release(currentInstanceId) } catch { /* best effort */ }
    lease = null
  }
}

process.on('exit', () => stopApi())
process.on('SIGINT', () => { stopApi(); process.exit(0) })
process.on('SIGTERM', () => { stopApi(); process.exit(0) })

/** One-shot health probe: true when a ready sidecar answers on API_BASE.
 *  Used by the main-process watchdog to detect a hung (not cleanly-exited) server. */
async function ping(timeoutMs = 3000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
    // HTTP 200 proves the process answers. `db_ready` was required here before
    // and produced false negatives when the Bun/SQLite event loop was busy: a
    // healthy-but-slow sidecar looked dead and the watchdog needlessly killed
    // it (which then caused EADDRINUSE / the real death it was trying to avoid).
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** True while a spawned sidecar child is alive. The supervisor uses it to
 *  stop a hung process before restarting, instead of spawning a second one
 *  against the same port (EADDRINUSE). */
function isRunning() {
  return proc !== null
}

module.exports = {
  startApi,
  stopApi,
  ping,
  isRunning,
  instanceIdFor,
  probeHealth,
  portOccupied,
  waitForPortFree,
  API_BASE,
  PORT,
  sidecarEvents,
}
