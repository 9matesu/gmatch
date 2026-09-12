// Shared join path (Servers tab + onboarding picker): password prompt →
// one-shot handoff → mode switch → marker → relaunch. The marker tells the
// post-restart OnboardingFlow it already chose this node (profile step).
import { normalizeServerUrl } from './serverUrl'
import { rememberJoin } from './server-join'
import { SERVER_MARKER_KEY } from '../firstRun/onboardingState'
import type { DirectoryServer } from '../components/servers/ServersView'

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export async function joinServer(
  s: DirectoryServer,
  toast: Toast,
  askPassword: (name: string) => Promise<string | null>,
): Promise<'relaunching' | 'connected' | 'cancelled' | 'failed'> {
  const url = s.endpoint_hint
  if (!url) { toast('This server has no address to join (owner is offline?)', 'warning'); return 'failed' }
  let password: string | undefined
  if (s.password_required) {
    // Electron has no window.prompt; the caller renders a PromptDialog.
    const entered = await askPassword(s.name)
    if (entered === null) return 'cancelled'
    password = entered
  }
  const target = normalizeServerUrl(url) || normalizeServerUrl('http://' + url) || url
  if (password !== undefined) rememberJoin({ url: target, password })
  try {
    localStorage.setItem(SERVER_MARKER_KEY, target)
    localStorage.setItem('gmatch.api.url', target)
  } catch { /* private mode */ }

  if (!window.gmatch?.serverSet) { toast('Joining servers works in the desktop app', 'warning'); return 'failed' }

  const res = await window.gmatch.serverSet({ mode: 'client', url: target })
  if (!res.ok) { toast(res.error || 'Could not switch servers', 'error'); return 'failed' }
  toast(`Switching to ${s.name}. The app restarts.`, 'success')
  window.gmatch.serverRelaunch?.()
  return 'relaunching'
}
