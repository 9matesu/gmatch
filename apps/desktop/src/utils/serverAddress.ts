import { getApiBaseUrl, isLoopbackApiUrl } from './api'

/**
 * Addresses a friend can dial, and whose node they belong to.
 *
 * A node binds 0.0.0.0 and owns its port, so IT is the one that knows the
 * addresses it answers on. The packaged shell reads that list from the
 * Electron bridge (electron/server-mode.cjs#lanUrls); a browser build has no
 * bridge, so the node answers for itself on GET /api/servers/node (`lanUrls`).
 *
 * Two questions live here because both the heartbeat and the Servers screen
 * need the same honest answers:
 *
 *   - pickShareableHint: which address do we publish?
 *   - ownsLocalNode: is the node we are talking to OURS? A browser pointed at
 *     a friend's node is a CLIENT there and must never publish this machine's
 *     address as if it hosted a world.
 */

/**
 * How good an address is for a friend to dial.
 *
 * 10/8 and 192.168/16 are the usual home LANs. 172.16/12 is ranked lower on
 * purpose: on a developer machine that range is usually a virtual adapter
 * (WSL, Docker, a VPN) that no other machine can reach.
 */
function addressRank(host: string): number {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return 3
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return 0
  if (a === 192 && b === 168) return 0
  if (a === 172 && b >= 16 && b <= 31) return 1
  return 2
}

/** host:port of an address, scheme-less — the shape both sides compare on. */
function hostPortOf(url: string): string {
  try {
    const raw = String(url || '').trim()
    if (!raw) return ''
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`)
    return u.host.toLowerCase().replace(/:(443|80)$/, '')
  } catch {
    return ''
  }
}

/**
 * The best address to publish for this machine's node.
 *
 * Preference:
 *   1. a home-LAN address (10/8, 192.168/16);
 *   2. 172.16/12 — usually a virtual adapter, so it ranks below the others;
 *   3. any other routable IPv4;
 *   4. nothing (an empty string means "no shareable address yet").
 *
 * Loopback is this machine alone and link-local is not routable, so neither is
 * ever published. The scheme is kept: a peer then knows it is plain HTTP and
 * does not have to guess.
 */
export function pickShareableHint(urls: string[] | null | undefined): string {
  let best = ''
  let bestRank = Number.POSITIVE_INFINITY
  for (const raw of urls ?? []) {
    const value = String(raw || '').trim()
    if (!value) continue
    let u: URL
    try {
      u = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
    } catch {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.pathname && u.pathname !== '/') continue // an origin, never a path
    if (u.search || u.hash) continue
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!host || host.includes(':')) continue // IPv6: not dialable in practice
    if (host === 'localhost' || host.startsWith('127.')) continue
    if (host.startsWith('169.254.')) continue // link-local
    const rank = addressRank(host)
    if (rank < bestRank) {
      bestRank = rank
      best = `${u.protocol}//${u.host}`
    }
  }
  return best
}

/** The dev-proxy cookie (vite.config.ts `resolveDevApiTarget`) — where /api goes. */
function readProxyCookie(): string {
  try {
    if (typeof document === 'undefined') return ''
    const hit = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('gmatch_server_url='))
    return hit ? decodeURIComponent(hit.slice('gmatch_server_url='.length)).trim() : ''
  } catch {
    return ''
  }
}

/**
 * True when the node this surface talks to is the one running on THIS machine.
 *
 * A browser build has a relative API base (traffic rides the dev proxy), so
 * the proxy's target decides: the `gmatch_server_url` cookie, else
 * VITE_API_URL, else the dev proxy's own local node. `lanUrls` (the node's own
 * report) settles the LAN case — a cookie pointing at one of this machine's
 * addresses IS this machine's node, even though the address is not loopback.
 */
export function ownsLocalNode(lanUrls: string[] = []): boolean {
  const known = lanUrls.map(hostPortOf).filter(Boolean)
  const isOurs = (url: string) => {
    if (isLoopbackApiUrl(url)) return true
    const hp = hostPortOf(url)
    return !!hp && known.includes(hp)
  }

  const base = getApiBaseUrl().trim()
  if (base) return isOurs(base)

  const cookie = readProxyCookie()
  if (cookie) return isOurs(cookie)

  const env = String((import.meta.env.VITE_API_URL as string | undefined) || '').trim()
  if (env) return isOurs(env)

  // Nothing points anywhere: the dev proxy falls back to the local dev node.
  return true
}
