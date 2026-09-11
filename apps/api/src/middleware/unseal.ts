import { Context, Next } from 'hono'
import { openApiRequest } from '@orbit/protocol'

/**
 * Sealed-request unseal (security plan T2). When `X-Orbit-Sealed` is present,
 * open the ECIES envelope (kind=api_req, sealed with the NODE key from
 * apps/api/src/node-key.ts) and REWRITE the request to carry the inner signed
 * headers + inner JSON body, so the entire existing orbitAuth/route pipeline
 * runs untouched on the decrypted bytes. No seal header => pass through
 * (signed-plaintext legacy stays valid until API_SEALED_ONLY is flipped).
 */
export async function unsealRequest(c: Context, next: Next) {
  const sealed = c.req.header('X-Orbit-Sealed')
  if (!sealed) {
    if ((c.env as { API_SEALED_ONLY?: string })?.API_SEALED_ONLY && ['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      return c.json({ error: 'sealed requests required (API_SEALED_ONLY)' }, 400)
    }
    return next()
  }
  const nodePrivHex = (c.env as { NODE_PRIV_HEX?: string })?.NODE_PRIV_HEX
  if (!nodePrivHex) return c.json({ error: 'node key unavailable. Server misconfigured' }, 500)
  let opened: { headers: Record<string, string>; body: string }
  try {
    opened = openApiRequest(sealed, nodePrivHex)
  } catch {
    return c.json({ error: 'invalid seal' }, 400)
  }
  // Enforce size/format ceilings BEFORE trusting the inner payload.
  if (opened.body.length > 2_000_000 || Object.keys(opened.headers).length > 24) {
    return c.json({ error: 'invalid seal' }, 400)
  }
  const url = new URL(c.req.url)
  url.pathname = url.pathname // pathname-only requests; keep query intact
  const inner = new Headers()
  for (const [k, v] of Object.entries(opened.headers)) inner.set(k, String(v))
  c.req.raw = new Request(url.toString(), {
    method: c.req.method,
    headers: inner,
    body: opened.body || undefined,
  })
  return next()
}
