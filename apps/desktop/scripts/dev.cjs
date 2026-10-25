// Dev runner: spawns Vite, which owns the API too.
//
// `npm run dev` talks to the local Bun sidecar (port 8790) that vite.config.ts
// boots and adopts — the same full node a packaged install runs, with an empty
// local database. Nothing hosted is required: no central, no courier.
// `GMATCH_DEV_API=remote` points /api at the hosted full node instead.
//
// The port is STRICT (5173). Local storage, IndexedDB and the identity live on
// the origin, so silently landing on 5174 makes a returning user look wiped
// ("where did my posts go?"). A busy port is an error, not a new world.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const PORT = 5173
const REMOTE = (process.env.GMATCH_DEV_API || '').toLowerCase() === 'remote'
const API_PORT = Number(process.env.GMATCH_API_PORT || 8790)

async function main() {
  console.log(
    REMOTE
      ? '[dev] API: hosted full node (GMATCH_DEV_API=remote)'
      : `[dev] API: local sidecar http://127.0.0.1:${API_PORT} — no hosted node required`,
  )

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
    [viteBin, '--port', String(PORT), '--strictPort'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
  )

  vite.on('exit', (code) => process.exit(code ?? 0))
}

main().catch((err) => {
  console.error('[dev] Error starting dev environment:', err)
  process.exit(1)
})
