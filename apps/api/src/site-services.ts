/**
 * SITE_SERVICES gate (plan P2.3-P2.4): the official site runs ONLY the blind
 * courier (mail + TURN) plus health and statics. Everything stateful/
 * contentful (pm, posts, objects, users, economy...) 404s in site mode —
 * the law is enforced at the edge, not by convention. Self-hosted full nodes
 * (default `all`) are unaffected.
 */
export function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/u/')
  )
}

export function parseSiteServices(env: Record<string, string | undefined> = process.env): Set<string> | null {
  const raw = (env.SITE_SERVICES || 'all').trim().toLowerCase()
  if (raw === 'all') return null // full node: no gating
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

export function siteAllows(services: Set<string>, pathname: string): boolean {
  if (pathname === '/api/health') return true
  if (services.has('mail') && pathname.startsWith('/api/mail')) return true
  if (services.has('turn') && pathname.startsWith('/api/turn')) return true
  return false
}
