// Dev runner: boots the local Orbit Bun API sidecar (port 8790), then boots
// Vite pointing at it (VITE_API_URL=http://127.0.0.1:8790).
// Ensures `npm run dev` has full parity with `npm run electron` and runs
// the exact same local codebase instead of stale remote endpoints.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

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

  if (await isApiHealthy()) {
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

  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite'],
    {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, VITE_API_URL: API_URL },
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
