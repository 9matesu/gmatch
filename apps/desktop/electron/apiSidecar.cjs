// API sidecar: spawns the vendored Orbit Hono/Bun server as a child process,
// persists to userData, waits for /api/health. (Plan D3.)
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { adminPin } = require('./admin-pin.cjs')

const PORT = Number(process.env.GMATCH_API_PORT || 8790)
const API_BASE = `http://127.0.0.1:${PORT}`

let proc = null
let intentionalStop = false
/** Emits 'crashed' (exit code) when the child dies outside a planned stop. */
const sidecarEvents = new EventEmitter()

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

  const adoptable = !app.isPackaged || !process.env.GMATCH_HOST_MODE
  // Adopt an already-healthy sidecar (e.g. `npm run dev` started one, or a
  // second Electron window) instead of spawning a doomed duplicate. Host-mode
  // packaged instances must own their server — never adopt a foreign one.
  if (adoptable) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      let r
      try {
        r = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (r.ok && (await r.json()).db_ready) {
        console.log(`[api] adopting existing sidecar at ${API_BASE}`)
        return true
      }
    } catch {
      /* nothing listening — spawn below */
    }
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
    (kind === 'out' ? console.log : console.error)(`[api${kind === 'err' ? '!' : ''}]`, line)
    sidecarEvents.emit('stderr', `${kind}:${line}`.slice(0, 500))
  }
  proc.stdout.on('data', childLog('out'))
  proc.stderr.on('data', childLog('err'))
  proc.on('error', (err) => {
    console.error('[api] sidecar spawn failed:', err.message)
    proc = null
  })
  proc.on('exit', (code) => {
    proc = null
    if (!intentionalStop && code !== 0) sidecarEvents.emit('crashed', code)
  })
  for (let i = 0; i < 60; i++) {
    // If the child died or failed to spawn, stop waiting — a stale listener
    // on the port must not masquerade as a healthy sidecar.
    if (!proc) throw new Error('API sidecar process is not running')
    try {
      // Each health poll gets its own timeout: without this, one hung
      // connection (stale 1.2.4 sidecar holding :8790) stalls boot forever
      // and the window never appears (1.2.5 "Task Mgr spin" zombie).
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      let r
      try {
        r = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (r.ok) {
        const j = await r.json()
        if (j.db_ready) return true
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('API sidecar failed to start within 30s')
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
}

process.on('exit', () => stopApi())
process.on('SIGINT', () => { stopApi(); process.exit(0) })
process.on('SIGTERM', () => { stopApi(); process.exit(0) })

module.exports = { startApi, stopApi, API_BASE, PORT, sidecarEvents }
