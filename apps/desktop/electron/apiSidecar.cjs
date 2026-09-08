// API sidecar: spawns the vendored Orbit Hono/Bun server as a child process,
// persists to userData, waits for /api/health. (Plan D3.)
const { spawn } = require('node:child_process')
const { app } = require('electron')
const path = require('node:path')

const PORT = Number(process.env.GOONGRID_API_PORT || 8790)
const API_BASE = `http://127.0.0.1:${PORT}`

let proc = null

/** Resolve the real bun executable (npm shims are .cmd wrappers that
 *  child_process.spawn can't exec directly on Windows). */
function bunBin() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  const fs = require('node:fs')
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
  // At-rest encryption key for blobs/PMs (apps/api/src/crypto.ts hard-requires
  // a 64-hex key). Generate once per install and persist in userData so a raw
  // DB dump never yields plaintext — and so packaged host mode can take
  // uploads without the user installing anything.
  let storageKey = process.env.STORAGE_ENCRYPTION_KEY
  if (!storageKey) {
    const fs = require('node:fs')
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
  // Packaged (1.0, no-central-server plan): the app IS the server. Spawn the
  // BUNDLED api-stage (bun.exe + self-contained server) so nothing needs to
  // be installed on the machine. Dev keeps the repo-local sidecar path.
  const resourcesApi = app.isPackaged
    ? path.join(process.resourcesPath, 'api', 'apps', 'api')
    : null
  const bundledBun = app.isPackaged
    ? path.join(process.resourcesPath, 'api', 'bun.exe')
    : null

  const adoptable = !app.isPackaged || !process.env.GOONGRID_HOST_MODE
  // Adopt an already-healthy sidecar (e.g. `npm run dev` started one, or a
  // second Electron window) instead of spawning a doomed duplicate. Host-mode
  // packaged instances must own their server — never adopt a foreign one.
  if (adoptable) {
    try {
      const r = await fetch(`${API_BASE}/api/health`)
      if (r.ok && (await r.json()).db_ready) {
        console.log(`[api] adopting existing sidecar at ${API_BASE}`)
        return true
      }
    } catch {
      /* nothing listening — spawn below */
    }
  }
  const apiDir = resourcesApi || path.join(__dirname, '..', '..', 'api')
  proc = spawn(bundledBun || bunBin(), ['run', 'src/serve.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      STORAGE_ENCRYPTION_KEY: storageKey,
      SNAPSHOT_PATH: path.join(app.getPath('userData'), 'orbit.sqlite'),
      BLOB_STORE_DIR: path.join(app.getPath('userData'), 'blobs'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (d) => console.log('[api]', d.toString().trim()))
  proc.stderr.on('data', (d) => console.error('[api!]', d.toString().trim()))
  proc.on('error', (err) => {
    console.error('[api] sidecar spawn failed:', err.message)
    proc = null
  })
  proc.on('exit', (code) => {
    proc = null
    if (code !== 0 && code !== null) console.error(`[api] sidecar exited code=${code}`)
  })
  for (let i = 0; i < 60; i++) {
    // If the child died or failed to spawn, stop waiting — a stale listener
    // on the port must not masquerade as a healthy sidecar.
    if (!proc) throw new Error('API sidecar process is not running')
    try {
      const r = await fetch(`${API_BASE}/api/health`)
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
  if (proc) {
    proc.kill()
    proc = null
  }
}

module.exports = { startApi, stopApi, API_BASE, PORT }
