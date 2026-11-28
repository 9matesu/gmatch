import { getApiBaseUrl, isLoopbackApiUrl, orbitFetch, type OrbitIdentityLike } from './api'
import { radminAdapterIp } from '../services/radmin'

/**
 * Addresses a friend can dial, and whose node they belong to.
 *
 * A node binds 0.0.0.0 and owns its port, so IT is the one that knows the
 * addresses it answers on. The packaged shell reads that list from the
 * Electron bridge (electron/server-mode.cjs#lanUrls); a browser build has no
 * bridge, so the node answers for itself on GET /api/servers/node (`lanUrls`).
 *
 * Three questions live here because the heartbeat, the Servers screen and the
 * presence beacon all need the same honest answers:
 *
 *   - pickShareableHint: which address do we publish?
 *   - ownsLocalNode: is the node we are talking to OURS? A browser pointed at
 *     a friend's node is a CLIENT there and must never publish this machine's
 *     address as if it hosted a world.
 *   - resolveNodeAddress: which address does ANOTHER machine dial to reach
 *     the node we are on? That is the node our presence beacon names and the
 *     node whose mailbox we must drain.
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

/** A loopback address the NODE itself reported — never guessed from the base. */
function pickLoopbackHint(urls: string[]): string {
  for (const raw of urls) {
    const value = String(raw || '').trim()
    if (!value) continue
    try {
      const u = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
      if (host === 'localhost' || host.startsWith('127.') || host === '::1') return `${u.protocol}//${u.host}`
    } catch { /* junk */ }
  }
  return ''
}

/**
 * The node's own report for a detected Radmin IP: the SAME address plus the
 * scheme/port it answers on. Without a matching report there is no evidence
 * this machine's node is reachable at that IP, so nothing is invented.
 */
function radminReportFor(ip: string, urls: string[]): { scheme: string; port: string } | null {
  for (const raw of urls) {
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`)
      if (u.hostname.replace(/^\[|\]$/g, '').toLowerCase() === ip.toLowerCase() && u.port) {
        return { scheme: u.protocol, port: u.port }
      }
    } catch { /* keep looking */ }
  }
  return null
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

/**
 * The cached node address. The node's addresses do not change minute to
 * minute, and the answer is needed by the beacon (every 60s) and by the
 * mailbox list, so it is fetched once and reused for a while. The cache is
 * keyed by the API base, so switching to another node does not serve the old
 * address.
 */
const NODE_ADDRESS_TTL_MS = 10 * 60 * 1000
let nodeAddressCache: { base: string; url: string; at: number } | null = null

/** test seam */
export function _resetNodeAddress(): void {
  nodeAddressCache = null
}

/**
 * The address ANOTHER machine dials to reach the node we are connected to.
 *
 * This is the address our signed presence beacon names, and the box a peer
 * drops our sealed envelopes into — so it has to be DIALABLE from the
 * outside. Two common bases are not:
 *
 *   - `http://127.0.0.1:8790` — the packaged app's own node. A peer on
 *     another machine would read that as ITS OWN loopback.
 *   - `''` — a browser build riding the dev proxy: no address at all.
 *
 * Sources, in order:
 *   1. an absolute, non-loopback API base: that IS the node we are on (a
 *      client joined to a friend's node) and it is already dialable;
 *   2. a Radmin adapter this machine actually has (26/8) AND that the node
 *      itself reports — two installs on the same Radmin VLAN can then reach
 *      each other's node directly;
 *   3. the node's own report (`GET /api/servers/node` -> `lanUrls`) — how a
 *      loopback or relative base gets a real LAN address;
 *   4. a loopback the node reported (last resort, honest but not cross-node).
 *
 * Returns null when nothing dialable is known: a beacon without a node URL
 * is still a valid beacon (it just cannot be routed across nodes). No address
 * is ever synthesized: every part comes from the adapter or the node report.
 */
export async function resolveNodeAddress(
  identity: OrbitIdentityLike | null,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  radminIp: () => Promise<string | null> = radminAdapterIp,
): Promise<string | null> {
  const base = getApiBaseUrl().trim()
  if (base && !isLoopbackApiUrl(base)) {
    try {
      const u = new URL(base)
      if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}`
    } catch { /* not a URL; fall through to the node's report */ }
  }
  if (nodeAddressCache && nodeAddressCache.base === base && Date.now() - nodeAddressCache.at < NODE_ADDRESS_TTL_MS) {
    return nodeAddressCache.url || null
  }
  let urls: string[] = []
  try {
    const res = await orbitFetch('/api/servers/node', { method: 'GET' }, identity, fetchImpl)
    if (res.ok) {
      const j = (await res.json()) as { lanUrls?: string[] }
      urls = j?.lanUrls ?? []
    }
  } catch {
    // The node is unreachable (or has no such route): the beacon simply
    // carries no address. Never a guess.
  }
  let url = ''
  try {
    const ip = (await radminIp())?.trim()
    const shape = ip ? radminReportFor(ip, urls) : null
    if (ip && shape) url = `${shape.scheme}//${ip}:${shape.port}`
  } catch { /* no adapter / no bridge: the LAN fallback stands */ }
  if (!url) url = pickShareableHint(urls) || pickLoopbackHint(urls)
  nodeAddressCache = { base, url, at: Date.now() }
  return url || null
}
