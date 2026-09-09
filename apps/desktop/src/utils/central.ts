/**
 * Central node base URL (docs/ADR-002-servers.md): the directory lives there;
 * each client points at it to LIST/REGISTER servers. Empty = no central
 * configured (Servers tab explains instead of crashing). Vite env:
 * VITE_CENTRAL_URL (build-time), overridable at runtime via
 * localStorage['gmatch.central.url'] for packaged builds.
 */
export function getCentralApiUrl(): string {
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.central.url') : null
    if (manual?.trim()) return manual.trim().replace(/\/+$/, '')
  } catch { /* private mode */ }
  const fromEnv = (import.meta.env.VITE_CENTRAL_URL as string | undefined) || ''
  return fromEnv.replace(/\/+$/, '')
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
