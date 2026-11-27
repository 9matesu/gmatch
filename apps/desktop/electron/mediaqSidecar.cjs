'use strict'

/**
 * mediaq sidecar: runs the installed mediaq REST server (uv tool) as a child
 * process on 127.0.0.1 and waits for /health. Same lifecycle shape as the Bun
 * apiSidecar: adopt an already-healthy server, otherwise spawn one, and always
 * stop it on quit.
 */

const { spawn } = require('node:child_process')

const PORT = Number(process.env.GMATCH_MEDIAQ_PORT || 8765)
const BASE = `http://127.0.0.1:${PORT}`

let proc = null
let intentionalStop = false

async function isHealthy(timeoutMs = 1500) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const r = await fetch(`${BASE}/health`, { signal: controller.signal })
      return r.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

/**
 * Start the mediaq server. Adopts an already-healthy one (a previous run, or a
 * second window). Returns true when /health answers.
 * @param {{ mediaqBin: string, onLog?: (line: string) => void }} deps
 */
async function startMediaq({ mediaqBin, onLog }) {
  if (!mediaqBin) throw new Error('mediaq is not installed')
  intentionalStop = false
  if (await isHealthy()) return true

  proc = spawn(mediaqBin, ['server', 'start', '--foreground'], {
    env: { ...process.env, MEDIAQ_SERVER__PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pump = (d) => {
    const line = String(d).trim()
    if (line && onLog) onLog(line)
  }
  proc.stdout.on('data', pump)
  proc.stderr.on('data', pump)
  proc.on('error', (err) => {
    if (onLog) onLog(`mediaq spawn error: ${err.message}`)
    proc = null
  })
  proc.on('exit', () => {
    proc = null
    if (!intentionalStop && onLog) onLog('mediaq exited')
  })

  for (let i = 0; i < 60; i++) {
    if (!proc) break
    if (await isHealthy()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('mediaq did not answer /health in time')
}

/** Stop the server WE started. Returns { stopped } so IPC can report the truth:
 *  an adopted server (healthy on boot, no child here) is not ours to kill. */
function stopMediaq() {
  intentionalStop = true
  if (!proc) return { stopped: false }
  const pid = proc.pid
  try {
    if (process.platform === 'win32' && pid) {
      const { execSync } = require('node:child_process')
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
      } catch {
        /* already dead */
      }
    }
  } catch {
    /* best effort */
  }
  try {
    proc.kill('SIGKILL')
  } catch {
    /* already dead */
  }
  proc = null
  return { stopped: true }
}

process.on('exit', () => stopMediaq())
process.on('SIGINT', () => {
  stopMediaq()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopMediaq()
  process.exit(0)
})

module.exports = { startMediaq, stopMediaq, isHealthy, BASE, PORT }