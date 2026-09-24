/**
 * Central node base URL (docs/ADR-002-servers.md): the directory lives there;
 * each client points at it to LIST/REGISTER servers. Empty = no central
 * configured (Servers tab explains instead of crashing). Vite env:
 * VITE_CENTRAL_URL (build-time), overridable at runtime via
 * localStorage['gmatch.central.url'] for packaged builds.
 */
const DEFAULT_CENTRAL_URL = 'https://gmatch-wcz1.onrender.com'
const NO_CENTRAL = ['none', 'off', '0']

export function getCentralApiUrl(): string {
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.central.url') : null
    if (manual?.trim()) {
      const value = manual.trim()
      if (NO_CENTRAL.includes(value.toLowerCase())) return ''
      const normalized = value.replace(/\/+$/, '')
      if (/^https?:\/\/(gmatch|goonmatch)\.fly\.dev$/i.test(normalized)) {
        localStorage.removeItem('gmatch.central.url')
      } else {
        return normalized
      }
    }
  } catch { /* private mode */ }
  if (import.meta.env.VITE_CENTRAL_URL) {
    const envUrl = (import.meta.env.VITE_CENTRAL_URL as string).replace(/\/+$/, '')
    if (/^https?:\/\/(gmatch|goonmatch)\.fly\.dev$/i.test(envUrl)) {
      return DEFAULT_CENTRAL_URL
    }
    return envUrl
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
