// Server-mode config for packaged builds.
//   host (default): run the bundled server locally; friends connect to us.
//     Every packaged install is self-contained — no hosted dependency for
//     local data, social, or economy.
//   client (opt-in): talk to a friend's node.
// Persisted in userData/server-mode.json so the choice survives restarts.
//
// There is no hosted world any more, so two different things can be wrong with
// a stored client pointer, and they are answered differently:
//   - written by an OLDER app (unstamped/v1): it belongs to the hosted era. It
//     is NOT dialed — an old deployment can still answer and still not be this
//     install's world — but the address is kept (paused) so Settings can offer
//     it back. Provenance decides here, not reachability.
//   - written by THIS app (v2): it answered when it was chosen, so it is probed
//     once per launch against /api/health; silence pauses it too.
// Either way this launch hosts locally (the machine is the node), nothing is
// deleted, and the renderer is told why. No hostname list is involved, so an
// address nobody predicted heals by the same rule.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const PORT = Number(process.env.GMATCH_API_PORT || 8790)
const HOST_URL = `http://127.0.0.1:${PORT}`
/** Persisted client pointers are bare http(s)://host[:port] (no path). */
const CLIENT_URL_RE = /^https?:\/\/[\w.-]+(:\d+)?$/

const {
  normalizeServerUrl,
  isDecommissionedUrl,
  isLegacyClientConfig,
  pauseReasonOf,
  probeHealth,
  HEALTH_TIMEOUT_MS,
  CONFIG_VERSION,
} = require('./server-mode-core.cjs')

function configPath() {
  return path.join(app.getPath('userData'), 'server-mode.json')
}

function readRawConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    /* first run / unreadable */
    return null
  }
}

/** @returns {{mode:'host'|'client', url:string, pausedUrl?:string, pausedReason?:'legacy'|'unreachable'}} */
function readServerMode() {
  // Env override first (QA / power users).
  const envUrl = normalizeServerUrl(process.env.GMATCH_SERVER_URL)
  if (envUrl) return { mode: 'client', url: envUrl }

  const raw = readRawConfig()
  const localHost = { mode: 'host', url: HOST_URL }
  if (!raw || raw.mode !== 'client') return localHost
  if (!CLIENT_URL_RE.test(raw.url || '')) return localHost

  const url = raw.url.replace(/\/+$/, '')
  // The courier is a directory/mail relay, never a world.
  if (isDecommissionedUrl(url)) return localHost
  // Paused: run locally and remember what was chosen (and why).
  if (raw.paused === true) {
    return { ...localHost, pausedUrl: url, pausedReason: pauseReasonOf(raw) }
  }
  return { mode: 'client', url }
}

function writeServerMode(mode, url) {
  if (mode !== 'host' && mode !== 'client') throw new Error('mode must be host|client')
  if (mode === 'client' && !CLIENT_URL_RE.test(url || '')) {
    throw new Error('url must be http(s)://host[:port]')
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify({ mode, url: url || '', v: CONFIG_VERSION }))
}

/**
 * Keep the user's choice on disk but stop dialing it. The reason is part of the
 * record so the UI can be honest: an older app's pointer was never dialed here
 * ('legacy'), while a pointer this app verified and lost is 'unreachable'.
 */
function pauseServerMode(url, reason = 'legacy') {
  if (!CLIENT_URL_RE.test(url || '')) return
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(
    configPath(),
    JSON.stringify({
      mode: 'client',
      url,
      v: CONFIG_VERSION,
      paused: true,
      pausedReason: reason === 'unreachable' ? 'unreachable' : 'legacy',
    }),
  )
}

/**
 * Resolve a stored client pointer before the topology is read. Returns the
 * effective mode when the launch changed, or null when there was nothing to do
 * (no pointer, already paused, courier dropped, or a v2 node that answered).
 */
async function revalidateServerMode({ fetchImpl } = {}) {
  const raw = readRawConfig()
  if (!raw || raw.mode !== 'client' || raw.paused === true) return null
  const url = normalizeServerUrl(raw.url)
  if (!url) return null
  // A courier is a rendezvous, never a world: forget the pointer quietly.
  if (isDecommissionedUrl(url)) {
    writeServerMode('host', '')
    return null
  }
  // An older app's choice is not this app's world. Not dialed, not deleted.
  if (isLegacyClientConfig(raw)) {
    pauseServerMode(url, 'legacy')
    return { mode: 'host', url: HOST_URL, pausedUrl: url, pausedReason: 'legacy' }
  }
  // Hard bound: the signal aborts the request, but a socket stuck in name
  // resolution can outlive it. Boot must never wait on a resolver, so the
  // decision is made by whichever settles first.
  const answered = await Promise.race([
    probeHealth(url, { fetchImpl }),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS + 500)
      if (typeof timer.unref === 'function') timer.unref()
    }),
  ])
  if (answered) {
    writeServerMode('client', url)
    return null
  }
  pauseServerMode(url, 'unreachable')
  return { mode: 'host', url: HOST_URL, pausedUrl: url, pausedReason: 'unreachable' }
}

/** Probe a candidate node (Settings → Reconnect): health, not just TCP. */
async function probeServer(url) {
  const base = normalizeServerUrl(url)
  if (!base) return { ok: false, error: 'not an http(s) address' }
  return { ok: await probeHealth(base) }
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

module.exports = {
  readServerMode,
  writeServerMode,
  pauseServerMode,
  revalidateServerMode,
  probeServer,
  lanUrls,
  isDecommissionedUrl,
  PORT,
}
