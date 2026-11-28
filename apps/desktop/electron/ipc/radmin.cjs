// Radmin VPN join/status IPC (Batch 1.7.1).
//
// The renderer is sandboxed, so the join must run in the main process. The
// outcome is REAL: `joined` only when RadminVPN.exe exits 0 AND a 26.x adapter
// appears within a bounded wait. No fabricated success.
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')

const RADMIN_RE = /^26\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
// Mirror of utils/ice-hygiene.ts isGlobalIpv6 (CJS cannot import TS).
const GLOBAL_V6_RE = /^[23][0-9a-f]{3}:/i

function exeCandidates() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA || ''
  const dirs = [`${pf}\\Radmin VPN`, `${pfx}\\Radmin VPN`]
  if (local) dirs.push(`${local}\\Programs\\Radmin VPN`)
  // Radmin VPN 2.x ships Radmin.exe, not RadminVPN.exe.
  return dirs.flatMap((dir) => [`${dir}\\RadminVPN.exe`, `${dir}\\Radmin.exe`])
}

function findExe() {
  for (const p of exeCandidates()) {
    try { if (fs.existsSync(p)) return p } catch { /* keep looking */ }
  }
  return null
}

/** The 26/8 range is Radmin's alone; an `internal` flag cannot disqualify it. */
function adapterIp() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (!ni) continue
        const v4 = ni.family === 'IPv4' || ni.family === 4
        if (v4 && RADMIN_RE.test(ni.address)) return ni.address
      }
    }
  } catch { /* no interfaces */ }
  return null
}

/** Global IPv6 (2000::/3) — the other direct path besides Radmin. */
function globalIpv6() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (!ni || ni.internal) continue
        const a = String(ni.address).toLowerCase().split('%')[0]
        if (a === '::1' || a === '::' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) continue
        if (a.includes(':') && GLOBAL_V6_RE.test(a)) return ni.address
      }
    }
  } catch { /* no interfaces */ }
  return null
}

function join(name, password) {
  const exe = findExe()
  if (!exe) return Promise.resolve({ status: 'failed', reason: 'Radmin VPN is not installed' })
  return new Promise((resolve) => {
    let settled = false
    let child = null
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
    const timer = setTimeout(() => { try { child?.kill() } catch { /* gone */ } finish({ status: 'failed', reason: 'Could not run Radmin VPN' }) }, 15_000)
    try {
      child = spawn(exe, ['/joinnetwork', name, password], { windowsHide: true, stdio: 'ignore' })
    } catch {
      finish({ status: 'failed', reason: 'Could not run Radmin VPN' })
      return
    }
    child.on('error', () => finish({ status: 'failed', reason: 'Could not run Radmin VPN' }))
    child.on('exit', (code) => {
      if (code !== 0) { finish({ status: 'failed', reason: `Radmin VPN exited with code ${code}` }); return }
      const deadline = Date.now() + 8000
      const poll = () => {
        const ip = adapterIp()
        if (ip) { finish({ status: 'joined', ip }); return }
        if (Date.now() >= deadline) { finish({ status: 'failed', reason: 'No 26.x Radmin adapter appeared' }); return }
        setTimeout(poll, 500)
      }
      poll()
    })
  })
}

module.exports = function registerRadminHandlers({ ipcMain }) {
  ipcMain.handle('radmin:status', () => ({
    installed: !!findExe(),
    ip: adapterIp(),
    globalIpv6: globalIpv6(),
  }))
  ipcMain.handle('radmin:join', (_event, payload) => join(String(payload?.name || ''), String(payload?.password || '')))
}