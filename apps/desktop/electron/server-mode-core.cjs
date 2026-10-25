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

/**
 * Stamped into server-mode.json. Bumped whenever the meaning of a stored
 * choice changes; v2 means "this pointer was verified when it was saved".
 */
const CONFIG_VERSION = 2

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function isLoopbackUrl(v) {
  if (typeof v !== 'string' || !v) return false
  try {
    return LOOPBACK_HOSTS.has(new URL(v).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Was this client pointer written by an app that still assumed hosted worlds?
 * An unstamped/older config comes from that era, and its address may well still
 * answer — the old deployment can be alive and still not be the world this
 * install is sitting at. Provenance decides, not reachability: such a pointer
 * is kept as a paused choice instead of being dialed. A v2 config was written
 * by this code and is checked for reachability (it can still go offline).
 */
function isLegacyClientConfig(raw) {
  if (!raw || raw.mode !== 'client' || raw.paused === true) return false
  const v = Number(raw.v)
  return !Number.isFinite(v) || v < CONFIG_VERSION
}

/**
 * Why a saved pointer is paused: 'legacy' (an older app wrote it, never dialed
 * automatically) or 'unreachable' (this app verified it and it went silent).
 * Old paused rows have no reason; they predate this field.
 */
function pauseReasonOf(raw) {
  return raw && raw.pausedReason === 'unreachable' ? 'unreachable' : 'legacy'
}

const HEALTH_TIMEOUT_MS = 2500

/**
 * Does a node answer at this address? `/api/health` is the one route every
 * node serves without auth (and the blind courier serves it too), so it is the
 * honest question: TCP reachable but silent is still not a world. Injectable
 * fetch keeps the decision unit-testable.
 */
async function probeHealth(url, { fetchImpl = globalThis.fetch, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const base = normalizeServerUrl(url)
  if (!base || typeof fetchImpl !== 'function') return false
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined
  try {
    const res = await fetchImpl(`${base}/api/health`, {
      signal,
      headers: { accept: 'application/json' },
    })
    if (!res || !res.ok) return false
    const body = await res.json().catch(() => null)
    return Boolean(body && (body.status === 'ok' || body.ok === true))
  } catch {
    return false
  }
}

module.exports = {
  isServerUrl,
  normalizeServerUrl,
  isMode,
  isDecommissionedUrl,
  resolveServerUrl,
  isLoopbackUrl,
  isLegacyClientConfig,
  pauseReasonOf,
  probeHealth,
  CONFIG_VERSION,
  HEALTH_TIMEOUT_MS,
}
