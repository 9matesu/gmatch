import { useEffect } from 'react'
import { getCentralApiUrl } from '../utils/central'
import { getApiBaseUrl, orbitFetch } from '../utils/api'
import { ownsLocalNode, pickShareableHint } from '../utils/serverAddress'

// Host heartbeat (plan T3.5, docs/ADR-002-servers.md). While this install
// HOSTS a server that was registered from it, keep its directory row fresh.
// The directory prunes rows silent for 24h; a 15min cadence is plenty.
//
// Only the HOST replays the registration (a joiner POSTing the same body
// would create a different entry under their own pubkey).
//
// Two surfaces reach this hook:
//   - the packaged shell, which asks its Electron bridge for the host state;
//   - a browser build, which has no bridge: the NODE answers for itself on
//     GET /api/servers/node (its own `mode` + `lanUrls`).
//
// The browser path REPLAYS ONLY. It never invents a registration: publishing a
// machine to the public directory is an explicit act (Servers -> Add server),
// and a build that quietly claimed one would put every dev machine online.
const REG_KEY = 'gmatch.server.register'

type NodeInfo = { mode?: string; lanUrls?: string[]; name?: string; description?: string }

/** What the node says about itself (works on every surface: no bridge needed). */
async function readNodeInfo(identity: Parameters<typeof orbitFetch>[2]): Promise<NodeInfo | null> {
  try {
    const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
    if (!n.ok) return null
    const j = (await n.json()) as NodeInfo
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

export function useServerHeartbeat(identity: Parameters<typeof orbitFetch>[2] | null): void {
  useEffect(() => {
    if (!identity) return
    let alive = true
    const tick = async () => {
      const st = await window.gmatch?.serverState?.().catch(() => null)
      if (!alive) return

      // The bridge knows the mode AND the LAN addresses. A browser build has no
      // bridge, so the node is asked directly — it binds 0.0.0.0 and owns the
      // port, so it knows how it is reached.
      let mode: string | undefined
      let lanUrls: string[] = []
      let node: NodeInfo | null = null
      if (st) {
        mode = st.mode
        lanUrls = st.lanUrls ?? []
      } else {
        node = await readNodeInfo(identity)
        if (!alive || !node) return
        mode = node.mode
        lanUrls = node.lanUrls ?? []
        // A browser pointed at ANOTHER machine's node is a client there, not a
        // host: it must never publish this machine's address.
        if (!ownsLocalNode(lanUrls)) return
      }
      if (mode !== 'host') return

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
        // Browser builds never bootstrap-claim (see the note at the top).
        if (!st) return
        const nj = node ?? (await readNodeInfo(identity))
        if (!alive || !nj) return
        const hint = pickShareableHint(lanUrls)
        if (!hint) return // nothing shareable yet; next tick retries
        body = {
          name: (nj.name || 'gmatch').slice(0, 60),
          description: (nj.description || '').slice(0, 200),
          endpoint_hint: hint,
          password_required: false,
        }
        try { localStorage.setItem(REG_KEY, JSON.stringify(body)) } catch { /* session-only */ }
      } else {
        try { body = JSON.parse(raw) } catch { return }
        // A registration made before this machine had a shareable address (or
        // by a build that could not see one) gets the node's address now. A
        // hand-written hint is left alone — it may be a port-forwarded name
        // that reaches this machine better than the LAN address does.
        if (!String(body.endpoint_hint || '').trim()) {
          const hint = pickShareableHint(lanUrls)
          if (hint) {
            body.endpoint_hint = hint
            try { localStorage.setItem(REG_KEY, JSON.stringify(body)) } catch { /* session-only */ }
          }
        }
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
