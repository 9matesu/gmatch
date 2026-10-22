/**
 * Directory hub base URL (docs/ADR-002-servers.md): a node where servers
 * register and are listed. EMPTY by default since 2026-10-21 — the built-in
 * central deployments (Render, Fly) were decommissioned and cannot be paid
 * for. The directory is per node now: the node you are on lists the servers
 * it knows, and a hub is only needed when you want one node to publish for
 * many. Empty = no hub configured (the Servers tab explains instead of
 * crashing). Vite env: VITE_CENTRAL_URL (build-time), overridable at runtime
 * via localStorage['gmatch.central.url'] for packaged builds.
 */
const DEFAULT_CENTRAL_URL = ''
const NO_CENTRAL = ['none', 'off', '0']

export function getCentralApiUrl(): string {
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.central.url') : null
    if (manual?.trim()) {
      const value = manual.trim()
      if (NO_CENTRAL.includes(value.toLowerCase())) return ''
      return value.replace(/\/+$/, '')
    }
  } catch { /* private mode */ }
  if (import.meta.env.VITE_CENTRAL_URL) {
    return (import.meta.env.VITE_CENTRAL_URL as string).replace(/\/+$/, '')
  }
  return DEFAULT_CENTRAL_URL
}

export function setCentralApiUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem('gmatch.central.url', url.trim())
    else localStorage.removeItem('gmatch.central.url')
  } catch { /* session-only */ }
}

export function hasCentral(): boolean {
  return !!getCentralApiUrl()
}
