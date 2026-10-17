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
): Promise<'relaunching' | 'connected' | 'cancelled' | 'failed'> {
  const out = await switchClientWorld(
    { name: s.name, endpointHint: s.endpoint_hint, passwordRequired: s.password_required === 1 },
    { toast, askPassword },
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
