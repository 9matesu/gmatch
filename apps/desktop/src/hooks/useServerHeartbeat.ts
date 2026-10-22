import { useEffect } from 'react'
import { getCentralApiUrl } from '../utils/central'
import { getApiBaseUrl, orbitFetch } from '../utils/api'

// Host heartbeat (plan T3.5, docs/ADR-002-servers.md). While this install
// HOSTS a server that was registered from it, keep its directory row fresh.
// The directory prunes rows silent for 24h; a 15min cadence is plenty.
// Only the HOST replays the registration (a joiner POSTing the same body
// would create a different entry under their own pubkey), and browser/dev
// builds without the bridge no-op.
const REG_KEY = 'gmatch.server.register'

export function useServerHeartbeat(identity: Parameters<typeof orbitFetch>[2] | null): void {
  useEffect(() => {
    if (!identity) return
    let alive = true
    const tick = async () => {
      const st = await window.gmatch?.serverState?.().catch(() => null)
      if (!alive || st?.mode !== 'host') return
      // No hub configured? Register in our OWN node's directory: the node
      // lists itself, and the entry gossips to the nodes that know us. A hub
      // is an extra publisher, never a requirement.
      const central = getCentralApiUrl() || getApiBaseUrl()
      if (!central) return
      let raw: string | null = null
      try { raw = localStorage.getItem(REG_KEY) } catch { /* session-only */ }
      let body: Record<string, unknown>
      if (!raw) {
        // Host mode without an in-game Create (switched via Settings): the
        // node still belongs on the directory. Claim it with its own name
        // and a LAN address; the normal replay takes over from here on.
        try {
          const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
          if (!n.ok) return
          const nj = (await n.json()) as { name?: string; description?: string }
          const hint = String(st.lanUrls?.[0] || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
          if (!hint) return // nothing shareable yet; next tick retries
          body = {
            name: (nj.name || 'gmatch').slice(0, 60),
            description: (nj.description || '').slice(0, 200),
            endpoint_hint: hint,
            password_required: false,
          }
          localStorage.setItem(REG_KEY, JSON.stringify(body))
        } catch { return }
      } else {
        try { body = JSON.parse(raw) } catch { return }
      }
      // Game-browser metadata: report our own node's counts (dashboard route
      // answers locally on the host node). Failure = register without counts.
      try {
        const d = await orbitFetch('/api/servers/dashboard', { method: 'GET' }, identity)
        if (d.ok) {
          const dj = await d.json()
          if (typeof dj?.active_24h_count === 'number') body.user_count = dj.active_24h_count
          else if (typeof dj?.members_total === 'number') body.user_count = dj.members_total
          if (typeof dj?.online_count === 'number') body.online_count = dj.online_count
          else if (Array.isArray(dj?.users)) body.online_count = dj.users.filter((u: { online?: boolean }) => u?.online).length
        }
      } catch { /* counts optional */ }
      try {
        const dn = localStorage.getItem('orbit_display_name')
        if (dn?.trim()) body.owner_name = dn.trim().slice(0, 40)
      } catch { /* session-only */ }
      try {
        await orbitFetch(central + '/api/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, identity)
      } catch { /* offline; retried next tick */ }
    }
    void tick()
    const timer = setInterval(() => void tick(), 15 * 60 * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [identity])
}
