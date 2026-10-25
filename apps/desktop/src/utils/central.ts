/**
 * Directory hub base URL (docs/ADR-002-servers.md): a node where servers
 * register and are listed.
 *
 * Default since 2026-10-24: the Cloudflare courier at the release-page origin
 * (`site/functions/api/[[path]].ts`). It is a BLIND directory — it keeps
 * public metadata rows and sealed mailboxes, never posts, media, profiles or
 * presence. Self-hosters can point this at their own hub, or disable it with
 * `none`/`off`/`0`.
 *
 * Vite env: VITE_CENTRAL_URL (build-time), overridable at runtime via
 * localStorage['gmatch.central.url'] for packaged builds.
 */
export const COURIER_ORIGIN = 'https://gmatch.pages.dev'

const DEFAULT_CENTRAL_URL = COURIER_ORIGIN
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
