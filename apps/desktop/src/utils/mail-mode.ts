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
  try {
    const res = await fetchImpl(`${base}/api/pm`, { method: 'GET' })
    const mode: MailMode = res.status === 404 ? 'courier' : 'legacy'
    cache.set(base, mode)
    return mode
  } catch {
    return known ?? 'legacy'
  }
}

/** test seam */
export function _resetMailModeCache(): void {
  cache.clear()
}
