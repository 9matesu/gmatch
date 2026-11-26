/**
 * Directory hub base URL (docs/ADR-002-servers.md): the rendezvous where sealed
 * mail is dropped and servers are listed.
 *
 * THERE IS NO DEFAULT RENDEZVOUS. The node you are connected to IS the
 * directory and the mail relay: a full node stores the world it serves AND
 * gossips the directory to the nodes that know it. A hosted rendezvous would
 * be a third party that has to exist, be paid for, and be trusted with the
 * metadata of every sealed envelope — for a service that adds nothing the
 * local node does not already do.
 *
 * A shared hub is OPT-IN (`gmatch.central.url` / `VITE_CENTRAL_URL`): point
 * it at a node you run to bridge two networks that cannot reach each other.
 * `none`/`off`/`0` switches it off explicitly (the default state).
 *
 * The retired Pages rendezvous (`*.gmatch.pages.dev`) is DROPPED, never
 * dialed: that origin is a static release page — there is no mailbox and no
 * directory behind it — so an old install cannot keep talking to a service
 * that no longer exists.
 */

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
    if (env && !NO_CENTRAL.includes(env.toLowerCase()) && !isRetiredRendezvous(env)) {
      return env.replace(/\/+$/, '')
    }
  }
  return ''
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
