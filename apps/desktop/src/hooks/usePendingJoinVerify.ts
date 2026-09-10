import { useEffect, useRef, useState } from 'react'
import { orbitFetch } from '../utils/api'
import { peekPendingJoin, clearPendingJoin } from '../utils/server-join'
import type { OrbitIdentity } from '@orbit/crypto'

// One-shot join-password verifier (plan T5). Runs once after boot in client
// mode: if a pending join with a password exists, POST it (signed) to the
// node's /api/server/verify and wipe on success. Failures leave it for one
// retry path (Servers tab offers re-entry).
export function usePendingJoinVerify(
  identity: OrbitIdentity | null | undefined,
  toast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): { done: boolean; ok: boolean | null } {
  const [state, setState] = useState<{ done: boolean; ok: boolean | null }>({ done: false, ok: null })
  const ran = useRef(false)

  useEffect(() => {
    if (!identity || ran.current) return
    ran.current = true
    const pending = peekPendingJoin()
    if (!pending) { setState({ done: true, ok: null }); return }
    let alive = true
    void (async () => {
      try {
        const body = JSON.stringify({ password: pending.password ?? '' })
        const res = await orbitFetch(pending.url + '/api/server/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }, identity, fetchFn)
        if (!alive) return
        if (res.status === 200) {
          clearPendingJoin()
          toast('Joined the server', 'success')
          setState({ done: true, ok: true })
        } else if (res.status === 403) {
          toast('Server password is wrong — open Servers to re-enter it', 'warning')
          setState({ done: true, ok: false })
        } else {
          setState({ done: true, ok: false })
        }
      } catch {
        if (alive) setState({ done: true, ok: false })
      }
    })()
    return () => { alive = false }
  }, [identity, toast, fetchFn])

  return state
}
