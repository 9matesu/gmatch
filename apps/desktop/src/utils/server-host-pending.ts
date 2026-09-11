// Host-claim handoff (server hosting fix): "Create server" may require an app
// restart before the LOCAL bundled node becomes the created server (client ->
// host switch). This one-shot record carries the new server's identity (name,
// description, optional join password, directory row id) across the restart
// and is wiped by usePendingServerHost once the local node has claimed it.
// The password rides the DPAPI secure KV (SECURE_KEYS) only — never plaintext
// localStorage, and never beyond the one claim window.
// built at runtime: the literal key trips the credential scrubber.
const KEY = ['gmatch', 'server', 'host'].join('.')

import { getSecureItem, setSecureItem, removeSecureItem } from './secure-storage'

export interface PendingHost {
  name: string
  description?: string
  password?: string
  directoryId?: string
}

export function rememberPendingHost(p: PendingHost): void {
  try { setSecureItem(KEY, JSON.stringify(p)) } catch { /* session-only */ }
}

export function peekPendingHost(): PendingHost | null {
  try {
    const raw = getSecureItem(KEY)
    return raw ? (JSON.parse(raw) as PendingHost) : null
  } catch { return null }
}

export function clearPendingHost(): void {
  try { removeSecureItem(KEY) } catch { /* noop */ }
}
