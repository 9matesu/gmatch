import { signMessage } from '@orbit/crypto';
import { sealApiRequest } from '@orbit/protocol';
import { logger } from './logger';

/**
 * Courier nodes (the central Render deployment) are BLIND: `SITE_SERVICES`
 * makes every route outside directory/mail/TURN/admin 404 at the edge
 * (apps/api/src/serve.ts + site-services.ts). They are a valid *directory*,
 * never a valid *data* base — pointing the data API at one turns every
 * lobby/feed/users poll into a 404. Used by computeApiBase + the WS builder.
 */
const COURIER_HOSTS = /(^|\.)onrender\.com$/;

export function isCourierApiUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    return COURIER_HOSTS.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

function computeApiBase(): string {
  // In browser dev mode (e.g. http://localhost:5173 without Electron bridge), use relative ''
  // so requests hit the Vite dev proxy (which routes dynamically via gmatch_server_url cookie),
  // eliminating CORS blocks for both central and legacy nodes.
  if (
    typeof window !== 'undefined' &&
    !(window as unknown as { gmatch?: unknown }).gmatch &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return ''
  }

  // Desktop merge (D3): VITE_API_URL, or the Electron preload's __API_BASE__
  // (local sidecar). Default: central node; local sidecar is opt-in via the
  // server-mode switch in Settings.
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.api.url') : null;
    // A courier left over in the key (older builds auto-joined "central p2p")
    // would 404 every data route and shadow the real sidecar — ignore it.
    if (manual?.trim() && !isCourierApiUrl(manual)) {
      return manual.trim().replace(/\/+$/, '')
    }
  } catch { /* private mode */ }

  const envUrl =
    (import.meta.env.VITE_API_URL as string | undefined) ||
    (typeof window !== 'undefined' && (window as unknown as { __API_BASE__?: string }).__API_BASE__)
  if (envUrl) {
    const normalized = envUrl.replace(/\/+$/, '')
    return normalized
  }

  // Last resort (no preload/env/stored server, e.g. a browser build served
  // from a public host): the central courier. It serves the directory and the
  // share pages; stateful routes 404 there, which is why it must never be
  // selected as a data base above.
  return 'https://gmatch-wcz1.onrender.com'
}

export const API_BASE = computeApiBase();

/** Openable share links (P3.5): public HTML pages served by the API host. */
export const postShareUrl = (id: string) => `${API_BASE || 'https://gmatch-wcz1.onrender.com'}/p/${encodeURIComponent(id)}`
export const profileShareUrl = (id: string) => `${API_BASE || 'https://gmatch-wcz1.onrender.com'}/u/${encodeURIComponent(id)}`

const inflightRequests = new Map<string, Promise<Response>>()
const responseCache = new Map<string, { data: Response; expiry: number }>()
const CACHE_TTL = 3_000
const MAX_RESPONSE_CACHE_ENTRIES = 80

function pruneMap<K, V>(map: Map<K, V>, maxEntries: number) {
  while (map.size > maxEntries) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

function pruneResponseCache() {
  const now = Date.now()
  for (const [key, entry] of responseCache) {
    if (entry.expiry <= now) responseCache.delete(key)
  }
  pruneMap(responseCache, MAX_RESPONSE_CACHE_ENTRIES)
}

function cacheKey(method: string, endpoint: string, orbitId: string): string {
  // Scope by identity so authenticated GET responses (inbox, cards, profile,
  // lobby, feed) can never leak across accounts in the same browser session.
  return `${method}:${orbitId}:${endpoint}`
}

function cloneResponse(res: Response): Promise<Response> {
  const cloned = res.clone()
  return Promise.resolve(new Response(cloned.body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers: cloned.headers,
  }))
}

export function getApiBaseUrl(): string {
  return API_BASE
}

export function getApiWebSocketUrl(path = '/api/ws'): string {
  let base = API_BASE
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.api.url') : null
    if (stored?.trim() && !isCourierApiUrl(stored)) base = stored.trim()
  } catch { /* session-only */ }
  // Browser dev: API_BASE is relative (''), so the socket must ride the dev
  // proxy on the page's own origin. Falling through to the courier opened a
  // socket the courier 404s by design (serve.ts:243) — a dead peer swarm.
  if (!base) {
    if (typeof window !== 'undefined' && window.location?.host) {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      return `${scheme}://${window.location.host}${path.startsWith('/') ? path : `/${path}`}`
    }
    return `ws://127.0.0.1:8790${path.startsWith('/') ? path : `/${path}`}`
  }
  base = base.replace(/\/+$/, '')
  const scheme = base.startsWith('https') ? 'wss' : 'ws'
  const hostAndPath = base.includes('://') ? base.slice(base.indexOf('://') + 3) : base.replace(/^\/+/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${scheme}://${hostAndPath}${cleanPath}`
}

export function setApiBaseUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem('gmatch.api.url', url.trim())
    else localStorage.removeItem('gmatch.api.url')
  } catch { /* session-only */ }
}

/** True for a loopback API base (packaged host-mode sidecar address). */
export function isLoopbackApiUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url, 'http://localhost')
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
  } catch {
    return /127\.0\.0\.1|localhost/.test(url)
  }
}

/**
 * Packaged-exe install fix: a stale `gmatch.api.url=http://127.0.0.1:8790`
 * (left by an old host-mode install or server-join debug) makes a fresh
 * client-default install hammer a dead sidecar forever — the "loops pinging
 * 127.0.0.1" report. Call once on boot when the main process says we are a
 * packaged client: the stale key is dropped so API_BASE falls through to
 * the central node. Returns true when a stale key was cleared.
 */
export function clearStaleLoopbackApiBase(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const manual = localStorage.getItem('gmatch.api.url')
    if (manual?.trim() && isLoopbackApiUrl(manual.trim())) {
      localStorage.removeItem('gmatch.api.url')
      return true
    }
  } catch { /* private mode */ }
  return false
}

/** Cookie the dev proxy reads to route /api (vite.config.ts `resolveDevApiTarget`). */
const SERVER_COOKIE = 'gmatch_server_url'
/** Marker key the Servers tab keeps in sync with the connected node (onboardingState.ts). */
const SERVER_MARKER = 'gmatch.onboarding.serverUrl'

/**
 * Boot migration: older builds auto-joined the central node on first run, which
 * wrote the BLIND COURIER into `gmatch.api.url`, the marker key and a 1-year
 * `gmatch_server_url` cookie. A courier 404s (now 503s) every stateful route, so
 * that state wedges dev and packaged clients alike until it is cleared by hand.
 * The courier is a directory/mail/TURN node, never a data base — drop it and
 * let API_BASE fall through to the sidecar / dev node. Returns true when
 * something was purged.
 */
export function purgeCourierApiState(): boolean {
  let purged = false
  try {
    if (typeof localStorage !== 'undefined') {
      for (const key of ['gmatch.api.url', SERVER_MARKER]) {
        const value = localStorage.getItem(key)
        if (value?.trim() && isCourierApiUrl(value)) {
          localStorage.removeItem(key)
          purged = true
        }
      }
    }
  } catch { /* private mode */ }
  try {
    if (typeof document !== 'undefined' && document.cookie.includes(`${SERVER_COOKIE}=`)) {
      const value = readCookie(SERVER_COOKIE)
      if (isCourierApiUrl(value)) {
        document.cookie = `${SERVER_COOKIE}=; path=/; max-age=0`
        purged = true
      }
    }
  } catch { /* cookies disabled */ }
  return purged
}

function readCookie(name: string): string | null {
  try {
    const hit = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
  } catch {
    return null
  }
}

/**
 * Boot-time fix (all surfaces — browser tab, dev, Electron): a stale
 * `gmatch.api.url` pointing at a dead loopback sidecar (left by an old
 * host-mode install or dev session) makes every surface hammer dead
 * 127.0.0.1:8790 forever. Probe the sidecar health; when it is unreachable
 * the stale key is dropped so API_BASE falls through to the central node /
 * dev proxy. A HEALTHY sidecar (opt-in local dev, GMATCH_LOCAL_API=1) keeps
 * its override. Returns true when a stale key was cleared.
 */
export async function clearDeadLoopbackApiBase(): Promise<boolean> {
  try {
    if (typeof localStorage === 'undefined') return false
    const manual = localStorage.getItem('gmatch.api.url')
    if (!manual?.trim() || !isLoopbackApiUrl(manual.trim())) return false
    const base = manual.trim().replace(/\/+$/, '')
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1200) })
      if (res.ok) return false // sidecar alive: the override is legitimate
    } catch { /* dead: clear below */ }
    localStorage.removeItem('gmatch.api.url')
    return true
  } catch {
    return false
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function resolveEndpoint(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint
  return `${API_BASE}${endpoint}`
}

/** Minimal identity shape `orbitFetch` accepts (encryption keys optional — the sealed path is skipped without them). */
export interface OrbitIdentityLike { orbitId: string; publicKeyHex: string; privateKeyHex: string; encryptionPubHex?: string; encryptionPrivHex?: string }

// ---- sealed-request support (security plan T2) -----------------------------
/** Node X25519 transport pubkey, cached per API base (TTL 1h). */
let nodeKeyCache: { base: string; pubHex: string | null; at: number } | null = null
const NODE_KEY_TTL_MS = 60 * 60 * 1000

export function _resetNodeKeyCache(): void { nodeKeyCache = null }
export function _resetResponseCache(): void { responseCache.clear(); inflightRequests.clear(); }
export function invalidateCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    responseCache.clear();
    inflightRequests.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.includes(pathPrefix)) {
      responseCache.delete(key);
    }
  }
  for (const key of inflightRequests.keys()) {
    if (key.includes(pathPrefix)) {
      inflightRequests.delete(key);
    }
  }
}

function getPathname(u: string): string {
  try {
    return new URL(u, 'http://localhost').pathname
  } catch {
    const withoutQuery = u.split('?')[0] || '/'
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  }
}

function originOf(u: string): string {
  try {
    const fallbackBase = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : (API_BASE || 'http://localhost')
    return new URL(u, fallbackBase).origin
  } catch {
    return API_BASE
  }
}

async function getNodePubkey(fetchImpl: typeof globalThis.fetch, targetUrl: string = API_BASE): Promise<string | null> {
  // Seal to the node that will READ the request — its origin, not ours.
  const base = originOf(targetUrl)
  if (nodeKeyCache && nodeKeyCache.base === base && Date.now() - nodeKeyCache.at < NODE_KEY_TTL_MS) {
    return nodeKeyCache.pubHex
  }
  let pubHex: string | null = null
  try {
    const res = await fetchImpl(`${base}/api/identity`)
    if (res.ok) {
      const data = (await res.json()) as { server_pubkey?: string | null; sealed_available?: boolean }
      pubHex = data.sealed_available ? (data.server_pubkey || null) : null
    }
  } catch {
    /* offline/legacy node: plain signed path stands */
  }
  nodeKeyCache = { base, pubHex, at: Date.now() }
  return pubHex
}

/**
 * Builds signed auth headers for a request. Timestamp + nonce are generated
 * fresh on every call so retries re-sign instead of reusing a stale timestamp.
 */
export const LEGACY_FLY_ORIGIN = 'https://gmatch.fly.dev'

export function signRequestHeaders(
  method: string,
  pathname: string,
  bodyForSig: string,
  identity: OrbitIdentityLike,
  baseHeaders?: HeadersInit
): Headers {
  const nonce = method !== 'GET' ? randomHex(16) : '';
  const timestamp = Date.now().toString();
  const payload = nonce
    ? `${method}|${pathname}|${timestamp}|${nonce}|${bodyForSig}`
    : `${method}|${pathname}|${timestamp}|${bodyForSig}`;
  const signatureBytes = signMessage(new TextEncoder().encode(payload), identity.privateKeyHex);

  const headers = new Headers(baseHeaders);
  headers.set('X-Orbit-Id', identity.orbitId);
  headers.set('X-Orbit-Timestamp', timestamp);
  headers.set('X-Orbit-Signature', toHex(signatureBytes));
  headers.set('X-Orbit-PubKey', identity.publicKeyHex);
  if (nonce) {
    headers.set('X-Orbit-Nonce', nonce);
  }
  if (identity.encryptionPubHex) {
    headers.set('X-Orbit-PubKey-Enc', identity.encryptionPubHex);
  }
  return headers;
}

/**
 * Client-Side P2P OrbitFetch Adapter
 */
export async function orbitFetch(
  endpoint: string,
  options: RequestInit,
  identity?: OrbitIdentityLike | null,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  const url = resolveEndpoint(endpoint)
  const method = (options.method || 'GET').toUpperCase();

  let bodyForSig = '';
  if (options.body && typeof options.body === 'string') {
    bodyForSig = options.body;
  } else if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    bodyForSig = JSON.stringify(options.body);
  }

  // Use only the pathname for signature computation (server uses new URL().pathname)
  const pathname = getPathname(url);
  const isFormUpload = typeof FormData !== 'undefined' && options.body instanceof FormData

  async function buildHeaders(): Promise<Headers> {
    if (!identity) {
      return new Headers(options.headers)
    }
    const signed = signRequestHeaders(method, pathname, bodyForSig, identity, options.headers)
    // Sealed request (security plan T2 + wave 2 B2): signed headers + JSON
    // body travel ECIES-encrypted to the node key; only X-Orbit-Sealed is
    // visible on the wire. GETs seal their identity headers too (empty body)
    // so an observer never sees WHO asks. Multipart uploads stay as-is
    // (binary streaming; identity headers ride plaintext there).
    // Large JSON payloads (>4KB) also stay plaintext-signed: the seal rides
    // as a request HEADER, and base64-in-JSON-in-base64 inflation (~20x)
    // tripped the edge's header-size limit (403/431) on profile pictures.
    const sealBodySizeSafe = bodyForSig.length === 0 || bodyForSig.length <= 4096
    if (!isFormUpload && sealBodySizeSafe && identity.encryptionPrivHex && identity.encryptionPubHex) {
      const nodePub = await getNodePubkey(fetchImpl, url)
      if (nodePub) {
        const headersRecord: Record<string, string> = {}
        signed.forEach((v, k) => { headersRecord[k] = v })
        const contentType = signed.get('Content-Type') || (bodyForSig ? 'application/json' : null)
        const seal = sealApiRequest(
          { headers: headersRecord, body: bodyForSig || '' },
          {
            privateKeyHex: identity.privateKeyHex,
            publicKeyHex: identity.publicKeyHex,
            encryptionPrivHex: identity.encryptionPrivHex!,
            encryptionPubHex: identity.encryptionPubHex!,
          },
          nodePub,
        )
        const out = new Headers(options.headers)
        for (const k of ['X-Orbit-Id', 'X-Orbit-Timestamp', 'X-Orbit-Signature', 'X-Orbit-PubKey', 'X-Orbit-PubKey-Enc', 'X-Orbit-Nonce']) out.delete(k)
        out.set('X-Orbit-Sealed', seal)
        if (contentType) out.set('Content-Type', contentType)
        return out
      }
    }
    return signed
  }
  const headers = await buildHeaders()
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.api.url') : null
    // Same rule as computeApiBase: a courier must not steer data traffic.
    if (stored?.trim() && !isCourierApiUrl(stored) && !API_BASE) {
      headers.set('X-GMatch-Server', stored.trim())
    }
  } catch { /* session-only */ }
  const sealedBody = headers.has('X-Orbit-Sealed') ? 'sealed' : bodyForSig
  const ck = cacheKey(method, endpoint, identity?.orbitId || 'anon')

  // In-flight dedup for GET requests
  if (method === 'GET') {
    pruneResponseCache()
    const cached = responseCache.get(ck)
    if (cached && Date.now() < cached.expiry) {
      return cloneResponse(cached.data)
    }
    const inflight = inflightRequests.get(ck)
    if (inflight) {
      const res = await inflight
      return cloneResponse(res)
    }
  }

  const canRetry = !isFormUpload && (method === 'GET' || method === 'HEAD')
  const retryDelay = (attempt: number, response?: Response): number => {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      return 1
    }
    const retryAfter = response?.headers.get('Retry-After')
    const parsed = retryAfter ? Number(retryAfter) * 1000 : 0
    const base = Math.min(1000 * (2 ** attempt), 8000)
    return Math.min(parsed || base, 10000) + Math.floor(Math.random() * 250)
  }
  const waitRetry = (attempt: number, response?: Response) => new Promise<void>((resolve) => setTimeout(resolve, retryDelay(attempt, response)))

  const doFetch = async (attempt = 0): Promise<Response> => {
    const controller = new AbortController()
    const isUpload = options.body instanceof FormData
    const timeout = setTimeout(() => controller.abort(), isUpload ? 120000 : 30000)
    try {
      // GET must never carry a body (real fetch throws) — the seal lives in
      // the header alone; only non-GET sealed requests send the placeholder.
      const bodyInitFor = (h: Headers) =>
        h.has('X-Orbit-Sealed') && method !== 'GET' && method !== 'HEAD' ? { body: sealedBody } : {}
      const res = await fetchImpl(url, { ...options, headers, ...bodyInitFor(headers), signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) {
        if (method === 'GET') {
          responseCache.set(ck, { data: res.clone(), expiry: Date.now() + CACHE_TTL })
          pruneResponseCache()
        }
        return res
      }
      // Multipart uploads include file blobs; once the body has streamed we
      // cannot reuse `options.body` again (it is consumed). A 401 on an
      // upload therefore can't be retried transparently in-process — surface
      // the error so the caller (BabecockPanel, lobby image upload, etc.)
      // can prompt the user to retry with a fresh session by hitting the
      // page route. For non-upload mutations and for GET, retry once with a
      // freshly signed header (the most common case: the client sat idle a
      // while and the X-Orbit-Timestamp expired before the request arrived).
      if (res.status === 401 && !isUpload) {
        const retryHeaders = await buildHeaders()
        const retryRes = await fetchImpl(url, { ...options, headers: retryHeaders, ...bodyInitFor(retryHeaders), signal: controller.signal })
        if (retryRes.ok) {
          if (method === 'GET') {
            responseCache.set(ck, { data: retryRes.clone(), expiry: Date.now() + CACHE_TTL })
            pruneResponseCache()
          }
        }
        return retryRes
      }
      if (canRetry && attempt < 4 && (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500)) {
        logger.warn(`[orbitFetch] transient ${res.status}; retry ${attempt + 1}/4`)
        await waitRetry(attempt, res)
        return doFetch(attempt + 1)
      }
      return res
    } catch {
      clearTimeout(timeout)
      return offlineErrorResponse()
    }
  }

  if (method === 'GET') {
    const promise = doFetch().finally(() => inflightRequests.delete(ck))
    inflightRequests.set(ck, promise)
    return await promise
  }

  return await doFetch()

}

export interface UploadWithProgressResult {
  ok: boolean
  status: number
  /** Parsed `{ id }` from a successful response body or existing duplicate. */
  id: string | null
  error?: string
}

/**
 * XHR-based POST of a FormData body that reports upload progress. Auth signing
 * matches orbitFetch (fresh nonce/timestamp per request). `fetch` can't expose
 * upload progress, so match-card uploads use this to drive a progress bar.
 */
export function uploadWithProgress(
  endpoint: string,
  formData: FormData,
  identity: { orbitId: string; publicKeyHex: string; privateKeyHex: string; encryptionPubHex?: string },
  onProgress?: (pct: number) => void
): Promise<UploadWithProgressResult> {
  return new Promise((resolve) => {
    const url = resolveEndpoint(endpoint)
    const pathname = getPathname(url)
    const send = (attempt: number) => {
      const headers = signRequestHeaders('POST', pathname, '', identity)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)

      headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-type') return
        xhr.setRequestHeader(key, value)
      })

      xhr.upload.onprogress = (e) => {
        if (!onProgress) return
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 100)
        onProgress(Math.min(100, Math.max(0, pct)))
      }

      xhr.onerror = () => {
        if (attempt === 0) {
          send(1)
        } else {
          resolve({ ok: false, status: 0, id: null, error: 'Network error during upload' })
        }
      }
      xhr.onabort = () => resolve({ ok: false, status: 0, id: null, error: 'Upload aborted' })
      xhr.onload = () => {
        let body: any = null
        try {
          body = JSON.parse(xhr.responseText)
        } catch {}

        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100)
          const id = body && typeof body.id === 'string' ? body.id : null
          resolve({ ok: true, status: xhr.status, id })
        } else if (xhr.status === 401 && attempt === 0) {
          // Re-sign with a fresh timestamp and retry once. The X-Orbit
          // ticket window may have expired between the user opening the
          // dialog and the upload actually starting (max 5 min on the
          // server now, but still worth a one-shot retry).
          send(1)
        } else {
          const id = (body && typeof body.existing_id === 'string') ? body.existing_id : ((body && typeof body.id === 'string') ? body.id : null)
          const errorMsg = body?.error || `Upload failed (${xhr.status})`
          resolve({ ok: false, status: xhr.status, id, error: errorMsg })
        }
      }

      xhr.send(formData)
    }
    send(0)
  })
}

// Genuine network failures return an honest 503 so callers surface an offline
// state instead of locally fabricated mock data (which made the app appear to
// work — and silently swallow actions — while the API was unreachable).
function offlineErrorResponse(): Response {
  return new Response(JSON.stringify({ error: 'API request failed' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}
