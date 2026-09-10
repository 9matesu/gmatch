/**
 * Central node base URL (docs/ADR-002-servers.md): the directory lives there;
 * each client points at it to LIST/REGISTER servers. Empty = no central
 * configured (Servers tab explains instead of crashing). Vite env:
 * VITE_CENTRAL_URL (build-time), overridable at runtime via
 * localStorage['gmatch.central.url'] for packaged builds.
 */
const DEFAULT_CENTRAL_URL = 'https://gmatch.fly.dev'
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
  const fromEnv = (import.meta.env.VITE_CENTRAL_URL as string | undefined) || DEFAULT_CENTRAL_URL
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
