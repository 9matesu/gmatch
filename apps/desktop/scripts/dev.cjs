// Dev runner: boots Vite pointed at the central node (gmatch.fly.dev) by
// default, so `npm run dev` behaves like the real network (other users,
// roster, feed). Set GMATCH_LOCAL_API=1 to opt in to the local Orbit Bun API
// sidecar (port 8790) instead — full offline parity, empty local DB.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const LOCAL_API = /^(1|true|yes)$/i.test(process.env.GMATCH_LOCAL_API || '')
const API_PORT = Number(process.env.GMATCH_API_PORT || 8790)
const API_URL = `http://127.0.0.1:${API_PORT}`

function bunBin() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {}
  }
  return 'bun'
}

async function isApiHealthy() {
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(800) })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  let apiProc = null

  if (!LOCAL_API) {
    console.log('[dev] Using central node (gmatch.fly.dev) — set GMATCH_LOCAL_API=1 for the local sidecar.')
  } else if (await isApiHealthy()) {
    console.log(`[dev] Local API already running at ${API_URL}`)
  } else {
    const apiDir = path.join(__dirname, '..', '..', 'api')
    const bun = bunBin()
    console.log(`[dev] Starting local API server at ${API_URL}...`)
    try {
      apiProc = spawn(bun, ['run', 'src/serve.ts'], {
        cwd: apiDir,
        env: {
          ...process.env,
          PORT: String(API_PORT),
          STORAGE_ENCRYPTION_KEY: process.env.STORAGE_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        stdio: 'inherit',
      })
      apiProc.on('exit', (code) => {
        if (code !== 0 && code !== null) console.error(`[dev] API server exited with code ${code}`)
      })

      const started = Date.now()
      while (Date.now() - started < 15_000) {
        if (await isApiHealthy()) break
        await new Promise((r) => setTimeout(r, 300))
      }
      console.log(`[dev] Local API ready at ${API_URL}`)
    } catch (err) {
      console.warn(`[dev] Could not spawn local API (${err.message}). Using remote fallback.`)
    }
  }

  // Spawn vite directly through node: npm .cmd shims can't be exec'd by
  // child_process.spawn on current Node (EINVAL on win32 without shell).
  const viteBinCandidates = [
    path.join(__dirname, '..', '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  ]
  const viteBin = viteBinCandidates.find((c) => { try { return fs.existsSync(c) } catch { return false } })
  if (!viteBin) throw new Error('vite binary not found (run npm install from the repo root)')
  const vite = spawn(
    process.execPath,
    [viteBin],
    {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...(LOCAL_API ? { VITE_API_URL: API_URL } : {}) },
    }
  )

  const cleanup = () => {
    if (apiProc) {
      console.log('[dev] Stopping local API...')
      try { apiProc.kill() } catch {}
      apiProc = null
    }
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  vite.on('exit', cleanup)
}

main().catch((err) => {
  console.error('[dev] Error starting dev environment:', err)
  process.exit(1)
})
