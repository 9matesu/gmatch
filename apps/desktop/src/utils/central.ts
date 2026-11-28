/**
 * Directory hub base URL (docs/ADR-002-servers.md): the rendezvous where sealed
 * mail is dropped and servers are listed.
 *
 * The DEFAULT is a free, always-on, zero-knowledge Worker (`worker/`). It holds
 * ONLY sealed ciphertext envelopes and signed/self-declared directory metadata
 * — never message bodies, media, profiles or world rows. This fixes the case
 * where no peer's node is reachable: mail and discovery still have a meeting
 * point. The hosted WORLD is still forbidden; every install keeps its own node.
 * It is reachability, not NAT traversal — TURN / the node relay remain the
 * transport fallback (docs/ARCHITECTURE-P2P.md §1).
 *
 * `gmatch.central.url` (Settings → Servers) and `VITE_CENTRAL_URL` override the
 * default with a node you run. `none`/`off`/`0` switches it off explicitly.
 *
 * The retired Pages rendezvous (`*.gmatch.pages.dev`) is DROPPED, never
 * dialed: that origin is a static release page — there is no mailbox and no
 * directory behind it — so an old install cannot keep talking to a service
 * that no longer exists.
 */

/** Free blind rendezvous deployed from `worker/` (only HTTP; mail polls at 20s). */
export const DEFAULT_CENTRAL_URL = 'https://gmatch-rendezvous.mcos-mateus.workers.dev'

const NO_CENTRAL = ['none', 'off', '0']

/**
 * Origins that used to run the blind rendezvous and no longer do.
 *
 * The Pages origin served a Cloudflare-KV-backed mailbox + directory; both
 * were removed. What is left there is the static release page, so a pointer
 * to it cannot answer a mail drop — it is dropped instead of dialed, and the
 * app falls back to the node it is on.
 */
const RETIRED_RENDEZVOUS = /(^|\.)gmatch\.pages\.dev$/i

/** True for a rendezvous origin that no longer exists. */
export function isRetiredRendezvous(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  try {
    const host = new URL(url.trim().includes('://') ? url.trim() : `https://${url.trim()}`).hostname
    return RETIRED_RENDEZVOUS.test(host)
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
      if (isRetiredRendezvous(value)) return ''
      return value.replace(/\/+$/, '')
    }
  } catch { /* private mode */ }
  if (import.meta.env.VITE_CENTRAL_URL) {
    const env = (import.meta.env.VITE_CENTRAL_URL as string).trim()
    if (NO_CENTRAL.includes(env.toLowerCase()) || isRetiredRendezvous(env)) return ''
    if (env) return env.replace(/\/+$/, '')
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
