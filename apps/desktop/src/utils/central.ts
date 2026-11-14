/**
 * Directory hub base URL (docs/ADR-002-servers.md): the rendezvous where sealed
 * mail is dropped and servers are listed.
 *
 * gmatch 2.1 default: the project's own Cloudflare rendezvous
 * (`https://gmatch.pages.dev`). It is a BLIND courier — it stores envelopes it
 * cannot open and directory rows (a name + an address). It holds no profile, no
 * post, no presence row and no media byte, so pointing every install at it
 * costs a few hundred bytes per peer and nothing else.
 *
 * That is what makes "everyone signed in can see each other" true without a
 * world server: the rendezvous is a meeting point, the connection is direct.
 * It can be replaced (Settings -> Server -> Directory) or switched off
 * (`none`/`off`/`0`), and the app keeps working from the node you are on.
 */

const DEFAULT_CENTRAL_URL = 'https://gmatch.pages.dev'
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
    const env = (import.meta.env.VITE_CENTRAL_URL as string).trim()
    if (env && !NO_CENTRAL.includes(env.toLowerCase())) return env.replace(/\/+$/, '')
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