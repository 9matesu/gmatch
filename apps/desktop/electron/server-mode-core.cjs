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
 * Decide the packaged server URL: env override > persisted client > local host.
 * Pure inputs so it can be tested without electron.
 */
function resolveServerUrl({ envUrl = null, stored = null, hostUrl }) {
  const fromEnv = normalizeServerUrl(envUrl)
  if (fromEnv) return { mode: 'client', url: fromEnv }
  if (stored && stored.mode === 'client') {
    const u = normalizeServerUrl(stored.url)
    if (u) return { mode: 'client', url: u }
  }
  return { mode: 'host', url: hostUrl }
}

module.exports = { isServerUrl, normalizeServerUrl, isMode, resolveServerUrl }
