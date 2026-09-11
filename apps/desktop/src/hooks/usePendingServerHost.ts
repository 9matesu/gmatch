import { useEffect, useRef } from 'react'
import { orbitFetch } from '../utils/api'
import { peekPendingHost, clearPendingHost } from '../utils/server-host-pending'

// Host-claim (server hosting fix): after "Create server" switches this
// install into host mode (or immediately, when this machine already hosts
// an unclaimed node), rename the LOCAL bundled node to the created server
// and apply the chosen join password. The creator is auto-admin on a fresh
// node: orbitAuth provisions the first authenticated user (api middleware)
// and isNodeAdmin treats a <=1-user node as owner-run. Retries with a light
// backoff because post-restart boot races the bundled sidecar's startup.

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void
type Ident = Parameters<typeof orbitFetch>[2]

export type ClaimOutcome = 'none' | 'retry' | 'taken' | 'ok'

const RETRY_MS = 3000

export async function claimPendingHost(
  identity: Ident,
  toast: Toast,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<ClaimOutcome> {
  const pending = peekPendingHost()
  if (!pending) return 'none'
  let node: { isAdmin?: boolean } | null = null
  try {
    // cache-bust: this is a liveness probe — orbitFetch dedups/caches GETs,
    // and a stale cached answer must never decide whether we may claim.
    const probe = await orbitFetch(`/api/servers/node?_t=${Date.now()}`, { method: 'GET' }, identity, fetchImpl)
    if (!probe.ok) return 'retry'
    node = (await probe.json().catch(() => null)) as { isAdmin?: boolean } | null
  } catch {
    return 'retry' // sidecar still booting
  }
  if (!node?.isAdmin) {
    // Someone else already owns this node — never overwrite their server.
    clearPendingHost()
    toast('This computer already runs a server. Create canceled.', 'error')
    return 'taken'
  }
  try {
    const res = await orbitFetch('/api/servers/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: pending.name,
        description: pending.description ?? '',
        ...(pending.directoryId ? { directory_id: pending.directoryId } : {}),
      }),
    }, identity, fetchImpl)
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string }
      toast(e.error || 'Could not claim your server — retrying', 'warning')
      return 'retry'
    }
  } catch {
    return 'retry'
  }
  if (pending.password) {
    try {
      await orbitFetch('/api/server/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pending.password }),
      }, identity, fetchImpl)
      // A failed password POST stays recoverable in Settings → Server.
    } catch { /* offline — password can be set manually */ }
  }
  clearPendingHost()
  toast(`You are now hosting "${pending.name}" . You are its admin.`, 'success')
  return 'ok'
}

export function usePendingServerHost(
  identity: Ident | null,
  toast: Toast,
  fetchImpl?: typeof globalThis.fetch,
): void {
  const running = useRef(false)
  useEffect(() => {
    if (!identity || running.current || !peekPendingHost()) return
    running.current = true
    let alive = true
    let timer: number | undefined
    const attempt = async () => {
      const out = await claimPendingHost(identity, (m, t) => { if (alive) toast(m, t) }, fetchImpl)
      if (!alive || out === 'ok' || out === 'none' || out === 'taken') return
      timer = window.setTimeout(() => void attempt(), RETRY_MS)
    }
    void attempt()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
      running.current = false
    }
  }, [identity, toast, fetchImpl])
}
