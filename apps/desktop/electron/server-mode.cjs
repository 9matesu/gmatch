// Server-mode config for packaged builds.
//   host (default): run the bundled server locally; friends connect to us.
//     Every packaged install is self-contained — no hosted dependency for
//     local data, social, or economy.
//   client (opt-in): talk to a friend's node.
// Persisted in userData/server-mode.json so the choice survives restarts.
//
// The central deployments (Render, Fly) are DECOMMISSIONED (2026-10-21): the
// accounts cannot be paid for. A stored client mode that still points at one
// is migrated to host mode on the next launch — dialing a dead address is
// worse than starting the node that is right there.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const PORT = Number(process.env.GMATCH_API_PORT || 8790)

/**
 * Hosts that are decommissioned: they cannot be paid for any more, so they
 * are never a destination. Kept in one place so the renderer and the main
 * process agree on what "dead" means.
 */
const { isDecommissionedUrl } = require('./server-mode-core.cjs')

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
      // A stored pointer to a decommissioned deployment: fall back to OUR node
      // instead of a host that cannot answer any more.
      if (isDecommissionedUrl(url)) return { mode: 'host', url: `http://127.0.0.1:${PORT}` }
      return { mode: 'client', url }
    }
  } catch {
    /* first run / unreadable -> host mode (bundled server, no Render required) */
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

module.exports = { readServerMode, writeServerMode, lanUrls, isDecommissionedUrl, PORT }
