import { signMessage } from '@orbit/crypto';
import { sealApiRequest } from '@orbit/protocol';
import { logger } from './logger';

function computeApiBase(): string {
  // Desktop merge (D3): VITE_API_URL, or the Electron preload's __API_BASE__
  // (local sidecar). Default: central node; local sidecar is opt-in via the
  // server-mode switch in Settings.
  try {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.api.url') : null
    if (manual?.trim()) {
      return manual.trim().replace(/\/+$/, '')
    }
  } catch { /* private mode */ }

  const envUrl =
    (import.meta.env.VITE_API_URL as string | undefined) ||
    (typeof window !== 'undefined' && (window as unknown as { __API_BASE__?: string }).__API_BASE__)
  if (envUrl) return envUrl.replace(/\/+$/, '')

  // Dev mode in browser (npm run dev): default to local dev sidecar on 8790
  if (
    typeof window !== 'undefined' &&
    (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1') &&
    import.meta.env.DEV &&
    import.meta.env.MODE !== 'test'
  ) {
    return 'http://127.0.0.1:8790'
  }

  // Dev (vite) and packaged builds both default to the gmatch central node;
  // the local sidecar is opt-in via VITE_API_URL / __API_BASE__ / server-mode.
  return 'https://gmatch.fly.dev'
}

export const API_BASE = computeApiBase();

/** Openable share links (P3.5): public HTML pages served by the API host. */
export const postShareUrl = (id: string) => `${API_BASE}/p/${encodeURIComponent(id)}`
export const profileShareUrl = (id: string) => `${API_BASE}/u/${encodeURIComponent(id)}`

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

export function setApiBaseUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem('gmatch.api.url', url.trim())
    else localStorage.removeItem('gmatch.api.url')
  } catch { /* session-only */ }
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

type OrbitIdentityLike = { orbitId: string; publicKeyHex: string; privateKeyHex: string; encryptionPubHex?: string; encryptionPrivHex?: string }

// ---- sealed-request support (security plan T2) -----------------------------
/** Node X25519 transport pubkey, cached per API base (TTL 1h). */
let nodeKeyCache: { base: string; pubHex: string | null; at: number } | null = null
const NODE_KEY_TTL_MS = 60 * 60 * 1000

export function _resetNodeKeyCache(): void { nodeKeyCache = null }
export function _resetResponseCache(): void { responseCache.clear(); inflightRequests.clear(); }

function originOf(u: string): string {
  try { return new URL(u).origin } catch { return API_BASE }
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
function signRequestHeaders(
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
  identity: OrbitIdentityLike,
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
  const pathname = new URL(url).pathname;
  const isFormUpload = typeof FormData !== 'undefined' && options.body instanceof FormData

  async function buildHeaders(): Promise<Headers> {
    const signed = signRequestHeaders(method, pathname, bodyForSig, identity, options.headers)
    // Sealed request (security plan T2 + wave 2 B2): signed headers + JSON
    // body travel ECIES-encrypted to the node key; only X-Orbit-Sealed is
    // visible on the wire. GETs seal their identity headers too (empty body)
    // so an observer never sees WHO asks. Multipart uploads stay as-is
    // (binary streaming; identity headers ride plaintext there).
    if (!isFormUpload && identity.encryptionPrivHex && identity.encryptionPubHex) {
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
  const sealedBody = headers.has('X-Orbit-Sealed') ? 'sealed' : bodyForSig
  const ck = cacheKey(method, endpoint, identity.orbitId)

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

  const doFetch = async (): Promise<Response> => {
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
      if (res.status === 429) {
        logger.warn('[orbitFetch] Rate limited, retrying after delay...')
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10)
        await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 10000)))
        // Re-sign with a fresh timestamp so the retry is not rejected as expired.
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
      // The server responded with an error status (404/403/400/500, ...).
      // Surface it to callers — never mask server errors or offline state with
      // locally fabricated mock data.
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
    const pathname = new URL(url).pathname
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
