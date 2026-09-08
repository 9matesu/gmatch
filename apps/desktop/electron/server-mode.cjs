// Server-mode config for packaged builds (1.0: NO central server).
// Each copy of the app bundles its own API server (bun.exe + api-stage).
//   host   (default): run the bundled server locally; friends connect to us.
//   client: skip the local server; point the renderer at a friend's URL.
// Persisted in userData/server-mode.json so the choice survives restarts.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const PORT = Number(process.env.GOONGRID_API_PORT || 8790)

function configPath() {
  return path.join(app.getPath('userData'), 'server-mode.json')
}

/** @returns {{mode:'host'|'client', url:string}} */
function readServerMode() {
  // Env override first (QA / power users).
  const envUrl = process.env.GOONGRID_SERVER_URL
  if (envUrl && /^https?:\/\//.test(envUrl)) {
    return { mode: 'client', url: envUrl.replace(/\/+$/, '') }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    if (raw && raw.mode === 'client' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(raw.url || '')) {
      return { mode: 'client', url: raw.url.replace(/\/+$/, '') }
    }
  } catch {
    /* first run / unreadable -> host */
  }
  return { mode: 'host', url: `http://127.0.0.1:${PORT}` }
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
