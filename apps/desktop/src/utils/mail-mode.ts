/**
 * Courier-mode detection (plan P3.3 dual-mode).
 *
 * The server-inbox route /api/pm is DELETED (v1.2.4, F26) — every node on
 * this codebase is courier-only for DMs. The probe keeps distinguishing old
 * pre-1.2.4 nodes (401 = route mounted = legacy inbox exists) from current
 * ones (404 = dead route = courier is the only mail path). Sending POST
 * /api/pm to a current node used to 404 with "Could not send message".
 * Result is cached per API base; failures fall back to 'courier' (the
 * sealed-envelope path is the only one that still works everywhere).
 *
 * Bases that can only ever run current code skip the wire probe entirely:
 * the Cloudflare courier (isKnownSiteCourier) and the bundled loopback
 * sidecar (staticMailMode). Probing them only produced console 404 noise.
 * A bare/relative base (browser-dev proxy) is NOT short-circuited: with the
 * directory disabled it may front a legacy node, and the probe is the only
 * way to tell.
 */

export type MailMode = 'courier' | 'legacy'

const cache = new Map<string, MailMode>()
const inflight = new Map<string, Promise<MailMode>>()

/**
 * Hosted nodes we know run current code — no wire probe needed. Cloudflare
 * Pages serves the release page and the blind courier on the same origin,
 * preview subdomains included.
 */
export function isKnownSiteCourier(url: string): boolean {
  try {
    const host = new URL(url.startsWith('http') ? url : `http://${url}`).hostname.toLowerCase()
    return /(^|\.)gmatch\.pages\.dev$/.test(host)
  } catch {
    return false
  }
}

/** Loopback (the bundled sidecar / dev node): current code, always courier. */
export function staticMailMode(apiBase: string): MailMode | undefined {
  const base = (apiBase || '').trim()
  try {
    const host = new URL(base.startsWith('http') ? base : `http://${base}`).hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '0.0.0.0') return 'courier'
  } catch { /* unparseable — fall through to the probe */ }
  return undefined
}

export function cachedMailMode(apiBase: string): MailMode | undefined {
  return cache.get(apiBase.replace(/\/+$/, ''))
}

export async function detectMailMode(
  apiBase: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<MailMode> {
  const base = apiBase.replace(/\/+$/, '')
  const known = cache.get(base)
  if (known) return known
  const ongoing = inflight.get(base)
  if (ongoing) return ongoing
  const p = (async (): Promise<MailMode> => {
    try {
      // 1. Cloudflare courier / loopback sidecar run current code: courier,
      //    no wire probe.
      if (isKnownSiteCourier(base) || staticMailMode(base)) {
        cache.set(base, 'courier')
        return 'courier'
      }

      // 2. Unsigned HEAD /api/pm: only OLD (pre-1.2.4) nodes still mount the
      // inbox route (any mounted response = legacy exists). Current full
      // nodes 404 it, and courier (PUT /api/mail/:token, mounted everywhere)
      // is the only mail. HEAD so the probe itself never shows as a page 404.
      const res = await fetchImpl(`${base}/api/pm`, { method: 'HEAD' }).catch(() => null)
      const mode: MailMode = res && res.status !== 404 ? 'legacy' : 'courier'

      cache.set(base, mode)
      return mode
    } catch {
      return cache.get(base) ?? 'courier'
    } finally {
      inflight.delete(base)
    }
  })()
  inflight.set(base, p)
  return p
}

/** test seam */
export function _resetMailModeCache(): void {
  cache.clear()
  inflight.clear()
}
