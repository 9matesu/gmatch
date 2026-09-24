// Server-mode config for packaged builds.
//   client (default): talk to the central node (gmatch-wcz1.onrender.com); no local
//     bun sidecar process — leaner RAM/CPU for the portable app.
//   host: run the bundled server locally; friends connect to us.
// Persisted in userData/server-mode.json so the choice survives restarts.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const PORT = Number(process.env.GMATCH_API_PORT || 8790)

function configPath() {
  return path.join(app.getPath('userData'), 'server-mode.json')
}

/** @returns {{mode:'host'|'client', url:string}} */
function readServerMode() {
  // Env override first (QA / power users).
  const envUrl = process.env.GMATCH_SERVER_URL
  if (envUrl && /^https?:\/\//.test(envUrl)) {
    return { mode: 'client', url: envUrl.replace(/\/+$/, '') }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    if (raw && raw.mode === 'host') {
      return { mode: 'host', url: `http://127.0.0.1:${PORT}` }
    }
    if (raw && raw.mode === 'client' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(raw.url || '')) {
      const url = raw.url.replace(/\/+$/, '')
      if (/^https?:\/\/(gmatch|goonmatch)\.fly\.dev$/i.test(url)) {
        const migratedUrl = 'https://gmatch-wcz1.onrender.com'
        try { writeServerMode('client', migratedUrl) } catch { /* ignore */ }
        return { mode: 'client', url: migratedUrl }
      }
      return { mode: 'client', url }
    }
  } catch {
    /* first run / unreadable -> central node (host stays opt-in in Settings) */
  }
  return { mode: 'client', url: 'https://gmatch-wcz1.onrender.com' }
}

function writeServerMode(mode, url) {
  if (mode !== 'host' && mode !== 'client') throw new Error('mode must be host|client')
  if (mode === 'client' && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(url || '')) {
    throw new Error('url must be http(s)://host[:port]')
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify({ mode, url: url || '' }))
}

/** LAN addresses a host-mode server is reachable at (for the "share me" UI). */
function lanUrls() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`)
    }
  }
  return out
}

module.exports = { readServerMode, writeServerMode, lanUrls, PORT }
