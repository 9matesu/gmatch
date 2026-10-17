// Atomic client-to-client world switching (no reload, no restart).
//
// The old path wrote persistence then relaunched the process because API_BASE
// was import-time. With per-call base resolution, a client→client move only
// needs: validate → probe → commit (marker + override + cookie + serverSet
// WITHOUT relaunch) → invalidate caches → notify subscribers. Host-mode
// transitions still restart (sidecar) and never route through here.
import { normalizeServerUrl } from './serverUrl'
import { isCourierApiUrl, invalidateCache, notifyApiBaseChanged } from './api'
import { rememberJoin } from './server-join'
import { SERVER_MARKER_KEY } from '../firstRun/onboardingState'

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export type SwitchResult = 'switched' | 'stale' | 'cancelled' | 'failed'

// Last-writer-wins across concurrent attempts: only the newest call notifies.
let commitSeq = 0

export function _resetSwitchSeqForTests(): void { commitSeq = 0 }

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

export interface SwitchTarget {
  name: string
  endpointHint?: string | null
  passwordRequired?: boolean
}

/**
 * Probe-then-commit a client→client switch. Returns 'switched' only after the
 * destination proved reachable AND the commit (persistence + subscribers) is
 * complete. Failed probes write nothing; the previous world stays active.
 */
export async function switchClientWorld(
  target: SwitchTarget,
  opts: {
    toast: Toast
    identity?: { orbitId: string } | null
    askPassword?: (name: string) => Promise<string | null>
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
  },
): Promise<SwitchResult> {
  const { toast, identity, askPassword, fetchImpl = globalThis.fetch } = opts
  const my = ++commitSeq
  const stale = () => my !== commitSeq

  const raw = (target.endpointHint || '').trim()
  if (!raw) { toast('This world has no address to join (owner is offline?)', 'warning'); return 'failed' }
  const url = normalizeServerUrl(raw) || normalizeServerUrl('http://' + raw) || raw
  if (isCourierApiUrl(url)) { toast('The courier is a directory, not a world — pick a server.', 'warning'); return 'failed' }

  // 1. Liveness: the node answers health within budget.
  try {
    const t = withTimeout(8000)
    try {
      const res = await fetchImpl(`${url}/api/health`, { signal: t.signal })
      if (!res.ok) { toast(`"${target.name}" is unreachable (HTTP ${res.status}).`, 'error'); return 'failed' }
    } finally {
      t.done()
    }
  } catch {
    if (stale()) return 'stale'
    toast(`"${target.name}" is unreachable. Check the address and try again.`, 'error')
    return 'failed'
  }
  if (stale()) return 'stale'

  // 2. Auth reachability (identity only): a 2xx proves application access; a
  // 401/403 proves a real gmatch node with an auth gate pending (password
  // flow below) — both pass. Anything else is not a usable world.
  if (identity) {
    try {
      const t = withTimeout(8000)
      try {
        const res = await fetchImpl(`${url}/api/servers/dashboard`, { signal: t.signal })
        if (![200, 401, 403].includes(res.status)) {
          toast(`"${target.name}" did not answer as a gmatch world (HTTP ${res.status}).`, 'error')
          return 'failed'
        }
      } finally {
        t.done()
      }
    } catch {
      if (stale()) return 'stale'
      toast(`"${target.name}" stopped responding mid-check. Nothing changed.`, 'error')
      return 'failed'
    }
  }
  if (stale()) return 'stale'

  // 3. Password gate (unchanged semantics): prompt before committing.
  let password: string | undefined
  if (target.passwordRequired) {
    if (!askPassword) { toast('This world needs a password.', 'warning'); return 'failed' }
    const entered = await askPassword(target.name)
    if (stale()) return 'stale'
    if (entered === null) return 'cancelled'
    password = entered
  }

  // 4. Atomic commit: snapshot previous persistence so a failed serverSet
  // restores it instead of leaving a half-written selection.
  const prev = { marker: null as string | null, override: null as string | null }
  try {
    prev.marker = localStorage.getItem(SERVER_MARKER_KEY)
    prev.override = localStorage.getItem('gmatch.api.url')
    localStorage.setItem(SERVER_MARKER_KEY, url)
    localStorage.setItem('gmatch.api.url', url)
    if (typeof document !== 'undefined') {
      document.cookie = `gmatch_server_url=${encodeURIComponent(url)}; path=/; max-age=31536000`
    }
  } catch { /* private mode: reactive base still switches */ }
  if (password !== undefined) rememberJoin({ url, password })

  try {
    if (window.gmatch?.serverSet) {
      const res = await window.gmatch.serverSet({ mode: 'client', url })
      if (!res.ok) throw new Error(res.error || 'Could not switch worlds')
    }
  } catch (err) {
    try {
      if (prev.marker === null) localStorage.removeItem(SERVER_MARKER_KEY)
      else localStorage.setItem(SERVER_MARKER_KEY, prev.marker)
      if (prev.override === null) localStorage.removeItem('gmatch.api.url')
      else localStorage.setItem('gmatch.api.url', prev.override)
    } catch { /* private mode */ }
    if (stale()) return 'stale'
    toast(err instanceof Error ? err.message : 'Could not switch worlds', 'error')
    return 'failed'
  }
  if (stale()) return 'stale'

  invalidateCache()
  notifyApiBaseChanged(url)
  return 'switched'
}
