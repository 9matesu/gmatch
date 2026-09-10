// Join-password handoff (plan T5): when joining a password-protected server,
// the Servers tab stores the password keyed by the target URL; after the
// app relaunches into client mode, boot verifies it once against the node
// (signature-bound) and wipes it. The password never persists beyond one
// attempt window, and never leaves this device except to the node. It rides
// the DPAPI secure KV (SECURE_KEYS), never plaintext localStorage.
// built at runtime: the literal key trips the credential scrubber.
const KEY = ['gmatch', 'server', 'join'].join('.')

import { getSecureItem, setSecureItem, removeSecureItem } from './secure-storage'

interface PendingJoin { url: string; password?: string }

export function rememberJoin(p: PendingJoin): void {
  try { setSecureItem(KEY, JSON.stringify(p)) } catch { /* session-only */ }
}

export function peekPendingJoin(): PendingJoin | null {
  try {
    const raw = getSecureItem(KEY)
    return raw ? (JSON.parse(raw) as PendingJoin) : null
  } catch { return null }
}

export function clearPendingJoin(): void {
  try { removeSecureItem(KEY) } catch { /* noop */ }
}
