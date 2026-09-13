/**
 * Courier-mode detection (plan P3.3 dual-mode).
 *
 * Official SITE (SITE_SERVICES=mail,turn) 404s every contentful route —
 * including GET /api/pm, which on a FULL node answers 401 (auth headers
 * missing). One unsigned request distinguishes the two without guessing:
 *   404 -> blind courier (E2EE mail only, no server inbox)
 *   any other response -> full node (legacy inbox stays authoritative)
 * Result is cached per API base; failures fall back to 'legacy' (the inbox
 * path is the more forgiving one and self-host/dev keeps working).
 */

export type MailMode = 'courier' | 'legacy'

const cache = new Map<string, MailMode>()
const inflight = new Map<string, Promise<MailMode>>()

export function cachedMailMode(apiBase: string): MailMode | undefined {
  return cache.get(apiBase.replace(/\/+$/, ''))
}

export function isKnownSiteCourier(url: string): boolean {
  try {
    const host = new URL(url.startsWith('http') ? url : `http://${url}`).hostname.toLowerCase()
    return host === 'gmatch.fly.dev' || host === 'goonmatch.fly.dev'
  } catch {
    return false
  }
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
      // 1. Central official site runs strictly in courier mode
      if (isKnownSiteCourier(base)) {
        cache.set(base, 'courier')
        return 'courier'
      }

      // 2. Query /api/health: never triggers a 404 in DevTools console on live nodes
      const res = await fetchImpl(`${base}/api/health`, { method: 'GET' })
      let mode: MailMode = 'legacy'

      if (res.status === 404) {
        mode = 'courier'
      } else if (res.ok) {
        const data = await res.json().catch(() => null) as { mode?: string; services?: string[] } | null
        if (data?.mode === 'courier' || (Array.isArray(data?.services) && !data.services.includes('all'))) {
          mode = 'courier'
        } else {
          mode = 'legacy'
        }
      } else {
        mode = 'legacy'
      }

      cache.set(base, mode)
      return mode
    } catch {
      return cache.get(base) ?? 'legacy'
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
