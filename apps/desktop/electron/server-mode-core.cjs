// Pure URL/mode validation for the no-central-server topology (1.0).
// No electron imports — unit-testable in plain node/vitest.
const SERVER_URL_RE = /^https?:\/\/[\w.-]+(?::\d{1,5})?(?:\/.*)?$/

function isServerUrl(v) {
  return typeof v === 'string' && SERVER_URL_RE.test(v)
}

function normalizeServerUrl(v) {
  return isServerUrl(v) ? v.replace(/\/+$/, '') : null
}

function isMode(v) {
  return v === 'host' || v === 'client'
}

/**
 * A courier is infrastructure, never a world: the Cloudflare deployment keeps
 * a directory and moves sealed mail, but 404s every stateful route. A client
 * pointed at it becomes a local HOST instead of a broken client.
 */
const COURIER_HOSTS = /(^|\.)gmatch\.pages\.dev$/

function isDecommissionedUrl(v) {
  if (typeof v !== 'string' || !v) return false
  try {
    return COURIER_HOSTS.test(new URL(v).hostname)
  } catch {
    return false
  }
}

/**
 * Decide the packaged server URL: env override > persisted client > local host.
 * Pure inputs so it can be tested without electron.
 */
function resolveServerUrl({ envUrl = null, stored = null, hostUrl }) {
  const fromEnv = normalizeServerUrl(envUrl)
  if (fromEnv) return { mode: 'client', url: fromEnv }
  if (stored && stored.mode === 'client') {
    const u = normalizeServerUrl(stored.url)
    // A stored pointer to a decommissioned deployment becomes OUR node.
    if (u && !isDecommissionedUrl(u)) return { mode: 'client', url: u }
  }
  return { mode: 'host', url: hostUrl }
}

module.exports = { isServerUrl, normalizeServerUrl, isMode, isDecommissionedUrl, resolveServerUrl }
