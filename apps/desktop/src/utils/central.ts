/**
 * Directory hub base URL (docs/ADR-002-servers.md): a node where servers
 * register and are listed.
 *
 * gmatch 2.0 default: NONE. Every install runs its own node, and that node is
 * the directory, the mail relay and the swarm rendezvous — a peer is found on
 * the node it is connected to, and a peer on ANOTHER node is reached through
 * the address its signed beacon carries. Nothing hosted is contacted, so no
 * hosted service holds a row, a mailbox or a listing for this install.
 *
 * A shared hub is still possible for people who want one rendezvous point:
 * set it here (Settings -> Servers -> Directory) or with
 * `VITE_CENTRAL_URL` at build time. `none`/`off`/`0` disables it.
 */
export const COURIER_ORIGIN = 'https://gmatch.pages.dev'

const DEFAULT_CENTRAL_URL = ''
const NO_CENTRAL = ['none', 'off', '0']

/**
 * True for the retired hosted rendezvous. Its D1 (mail + directory) was
 * emptied and the function removed in gmatch 2.0, so a pointer to it is dead
 * state — it is dropped rather than dialed, and the own node takes over.
 */
function isRetiredCourier(value: string): boolean {
  try {
    return /(^|\.)gmatch\.pages\.dev$/.test(new URL(value).hostname)
  } catch {
    return false
  }
}

export function getCentralApiUrl(): string {
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.central.url') : null
    if (manual?.trim()) {
      const value = manual.trim()
      if (NO_CENTRAL.includes(value.toLowerCase())) return ''
      if (isRetiredCourier(value)) return ''
      return value.replace(/\/+$/, '')
    }
  } catch { /* private mode */ }
  if (import.meta.env.VITE_CENTRAL_URL) {
    const env = (import.meta.env.VITE_CENTRAL_URL as string).trim()
    if (env && !isRetiredCourier(env)) return env.replace(/\/+$/, '')
  }
  return DEFAULT_CENTRAL_URL
}

export function setCentralApiUrl(url: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    const value = url.trim()
    if (!value) {
      localStorage.removeItem('gmatch.central.url')
      return
    }
    localStorage.setItem('gmatch.central.url', value.replace(/\/+$/, ''))
  } catch { /* private mode */ }
}

export function hasCentral(): boolean {
  return !!getCentralApiUrl()
}

/** The Cloudflare courier origin (mail rendezvous + directory). */
export function getCourierBase(): string {
  return COURIER_ORIGIN
}
