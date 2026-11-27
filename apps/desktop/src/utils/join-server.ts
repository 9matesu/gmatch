// Shared join path (Servers tab): password prompt → probe → atomic commit.
// Client→client switches complete in-app (no relaunch); host transitions
// never route through here. The marker records the chosen node.
import type { DirectoryServer } from '../components/servers/ServersView'
import { switchClientWorld } from './server-switch'

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export async function joinServer(
  s: DirectoryServer,
  toast: Toast,
  askPassword: (name: string) => Promise<string | null>,
  identity?: { orbitId: string } | null,
): Promise<'relaunching' | 'connected' | 'cancelled' | 'failed'> {
  // identity MUST reach switchClientWorld: it gates the auth-reachability probe
  // (GET /api/servers/dashboard). Without it the switch validated only
  // /api/health and committed, so a node that requires a password looked
  // joinable without one.
  const out = await switchClientWorld(
    { name: s.name, endpointHint: s.endpoint_hint, passwordRequired: s.password_required === 1 },
    { toast, askPassword, identity },
  )
  if (out === 'switched') {
    toast(`Connected to ${s.name}.`, 'success')
    return 'connected'
  }
  // 'stale' (a newer switch superseded this one) and 'relaunching' (legacy,
  // never produced) both release the spinner; the newest attempt owns state.
  if (out === 'stale') return 'failed'
  return out
}
