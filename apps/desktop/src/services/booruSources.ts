import registry from '../../../../shared/sources.json'

/**
 * Booru source registry (SPEC §6).
 *
 * `shared/sources.json` is the ONLY place a booru origin is written down.
 * This module derives every runtime view from it:
 *   - DIRECT_SOURCES  — the mirrors the renderer reaches through the dev proxy
 *   - refererFor      — the Referer header a host demands
 *   - devByteHost     — same-origin byte URLs for `npm run dev`
 *   - pxAllowHosts    — the dev /px allowlist (no open proxy)
 * Electron main reads the same JSON through electron/booru-registry.cjs, and
 * vite.config.ts builds its proxy table from it. Nothing else may hardcode a
 * booru host — that duplication is how allgirl/rule34.booru.org ended up
 * main-only while the renderer never heard of them.
 */

export type SourceKind =
  | 'dapi'
  | 'moebooru'
  | 'realhtml'
  | 'booruorg'
  | 'redgifs'
  | 'paheal'
  | 'imhentai'
  | 'babesource'

export interface SourceDef {
  id: string
  healthId: string
  kind: SourceKind
  category: 'real' | 'hentai'
  origin: string
  devProxy: string | null
  apiOrigin?: string
  mediaOrigin?: string
  devApiProxy?: string
  devMediaProxy?: string
  devImageProxies?: Array<{ host: string; prefix: string }>
  sub?: string
  parsePrefix?: string
  referer?: string
  imageHosts?: string[]
  devBytes?: 'proxy' | 'px'
  pxSubdomains?: boolean
  enabled: boolean
}

const ALL = (registry.sources as SourceDef[]).filter((s) => s.enabled !== false)

/** Kinds the renderer's dev-proxy path implements directly. */
const DIRECT_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  'dapi',
  'moebooru',
  'realhtml',
  'booruorg',
])

export interface DirectSourceDef {
  id: string
  origin: string
  proxy: string
  type: 'dapi' | 'moebooru' | 'realhtml' | 'booruorg'
  category: 'real' | 'hentai'
  sub?: string
  /**
   * Post-id namespace for this source, e.g. `tbib-`, `kona-`.
   *
   * Derived from the CANONICAL id (or the source's `parsePrefix`), never from
   * `id` — `id` is the healthId (`tbib-direct`) and Electron main namespaces
   * posts by the canonical id. Using healthId here produced `tbib-direct-102`
   * in the renderer against `tbib-102` in main, so dev and prod disagreed about
   * which posts had been seen. Renderer and main must build the same string:
   * see BOORU-API.md §6.
   */
  prefix: string
}

/**
 * Mirrors reachable through the Vite dev proxy (same-origin → no CORS).
 * Ids are the registry healthIds, which is also the renderer mirror-health key.
 */
export const DIRECT_SOURCES: readonly DirectSourceDef[] = ALL.filter(
  (s) => DIRECT_KINDS.has(s.kind) && s.devProxy,
).map((s) => ({
  id: s.healthId,
  origin: s.origin,
  proxy: s.devProxy as string,
  type: s.kind as DirectSourceDef['type'],
  category: s.category,
  // Mirrors main's rule exactly (SOURCE_FETCHERS: `s.parsePrefix || s.id`, and
  // the parsers append `${prefix}-`). One namespace per source, both runtimes.
  prefix: `${s.parsePrefix || s.id}-`,
  ...(s.sub ? { sub: s.sub } : {}),
}))

/** Every enabled source, canonical ids (Electron main's ordering). */
export const ALL_SOURCES: readonly SourceDef[] = ALL

export function sourceByHealthId(healthId: string): SourceDef | undefined {
  return ALL.find((s) => s.healthId === healthId)
}

export function sourceById(id: string): SourceDef | undefined {
  return ALL.find((s) => s.id === id)
}

export function sourceByKind(kind: SourceKind): SourceDef | undefined {
  return ALL.find((s) => s.kind === kind)
}

/**
 * Referer a host requires. Registry `referer` wins; booru.org mirrors share the
 * parent referer (their CDN fronts subdomains); everything else gets its own
 * origin — which is what the four hand-copied maps all agreed on.
 */
export function refererFor(hostname: string): string {
  for (const s of ALL) {
    if (s.referer && hostMatches(hostname, s.origin)) return s.referer
    for (const h of s.imageHosts ?? []) {
      if (s.referer && hostMatches(hostname, `https://${h}`)) return s.referer
    }
  }
  return `https://${hostname}/`
}

/** Media/alt hosts this origin family serves bytes from. */
export function imageHostsFor(origin: string): string[] {
  const s = ALL.find((x) => x.origin === origin)
  return s?.imageHosts ?? []
}

/** Host (or a subdomain of it) is this URL's origin. */
function hostMatches(hostname: string, origin: string): boolean {
  try {
    return new URL(origin).hostname === hostname
  } catch {
    return false
  }
}

/**
 * Same-origin dev URL for fetching a remote picture's bytes: vite dev serves
 * known hosts through local proxies (no CORS block, no console spam).
 *
 * Routing comes from each source's `devBytes`, not a hostname regex: a mirror's
 * BYTES often come from a different host than its API (xbooru serves JSON from
 * xbooru.com and images from img.xbooru.com; booru.org from img.booru.org), and
 * which of those can be path-proxied versus must go through /px is a property
 * of the source, not of the string in the URL.
 *
 * Null = no dev route for this host — skip the background fetch in DEV.
 * Pure (exported for tests).
 */
export function devFetchable(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const path = `${u.pathname}${u.search}`

    for (const s of ALL) {
      const originHost = new URL(s.origin).hostname
      const isOrigin = u.hostname === originHost
      // A subdomain of a pxSubdomains source serves its bytes, not its API
      // (xbooru: xbooru.com answers JSON, img.xbooru.com answers images).
      const isSubdomain = !!s.pxSubdomains && u.hostname.endsWith(`.${originHost}`)
      const isByteHost = (s.imageHosts ?? []).includes(u.hostname)
      const isMediaHost = !!s.mediaOrigin && u.hostname === new URL(s.mediaOrigin).hostname
      if (!isOrigin && !isSubdomain && !isByteHost && !isMediaHost) continue

      // The RedGifs CDN gets its own prefix, checked FIRST: it is listed as an
      // imageHost too (it is a byte host), but it has a working same-origin
      // path proxy while /px would needlessly re-fetch it server-side.
      if (s.devMediaProxy && isMediaHost) return `${s.devMediaProxy}${path}`

      // Bytes that redirect, lack ACAO or are hotlink-protected must go through
      // /px, which fetches server-side (following redirects) and streams
      // same-origin. yande.re is the case that matters: it has a path proxy for
      // its HTML, but proxying the image path would pass the 302 to files.
      // yande.re straight through and the browser would then die on CORS.
      const mustPx = s.devBytes === 'px' || isSubdomain || isByteHost
      if (mustPx) return `/px?u=${encodeURIComponent(url)}`

      if (s.devProxy && isOrigin) return `${s.devProxy}${path}`
    }

    // Non-booru CDN media (feed posts, avatars): no ACAO, so /px is the only
    // way a browser dev session can read the bytes.
    if (BYTE_HOSTS.has(u.hostname)) return `/px?u=${encodeURIComponent(url)}`
    return null
  } catch {
    return null
  }
}

const BYTE_HOSTS = new Set(registry.byteHosts ?? [])

/** Every host the /px proxy may be asked to fetch, for the allowlist. */
export function pxAllowHosts(): string[] {
  const hosts = new Set<string>(registry.byteHosts ?? [])
  for (const s of ALL) {
    hosts.add(new URL(s.origin).hostname)
    for (const h of s.imageHosts ?? []) hosts.add(h)
    if (s.mediaOrigin) hosts.add(new URL(s.mediaOrigin).hostname)
  }
  return [...hosts]
}

/** Regex form of pxAllowHosts, for the dev proxy's hot path. */
export function pxAllowPattern(): RegExp {
  const escaped = pxAllowHosts().map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(^|\\.)(${escaped.join('|')})$`)
}
