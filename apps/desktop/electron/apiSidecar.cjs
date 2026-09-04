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
  const apiDir = path.join(__dirname, '..', '..', 'api')
  proc = spawn(bunBin(), ['run', 'src/serve.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(PORT),
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
