import { Context, Next } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { verifySignature } from '@orbit/crypto'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import crypto from 'crypto'

// Bounded Nonce cache for replay protection (max 10,000 entries, 60s TTL)
const MAX_NONCES = 10_000
const NONCE_TTL_MS = 60_000
const seenNonces = new Map<string, number>()

// Server-issued nonces for mutation requests (challenge-response pattern)
const issuedNonces = new Map<string, { orbitId: string; expiresAt: number }>()
const NONCE_ISSUE_TTL_MS = 120_000

function cleanupNonces() {
  const now = Date.now()
  for (const [n, ts] of seenNonces.entries()) {
    if (now - ts > NONCE_TTL_MS) {
      seenNonces.delete(n)
    }
  }
  for (const [n, data] of issuedNonces.entries()) {
    if (now > data.expiresAt) {
      issuedNonces.delete(n)
    }
  }
}

export async function issueNonce(c: Context) {
  const orbitId = c.get('orbitId') || c.req.header('X-Orbit-Id')
  if (!orbitId) return c.json({ error: 'Not authenticated' }, 401)

  const nonce = crypto.randomUUID()
  issuedNonces.set(nonce, { orbitId, expiresAt: Date.now() + NONCE_ISSUE_TTL_MS })

  if (issuedNonces.size > MAX_NONCES) {
    const oldest = issuedNonces.keys().next().value
    if (oldest) issuedNonces.delete(oldest)
  }

  return c.json({ nonce, expiresIn: NONCE_ISSUE_TTL_MS })
}

function errorResponse(c: Context, message: string, status: ContentfulStatusCode): Response {
  const origin = c.req.header('Origin') || '*'
  return c.json({ error: message }, status, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Orbit-Id, X-Orbit-Timestamp, X-Orbit-Signature, X-Orbit-PubKey, X-Orbit-PubKey-Enc, X-Orbit-Nonce, Idempotency-Key, X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'POST, PUT, GET, PATCH, DELETE, OPTIONS',
  })
}

export async function orbitAuth(c: Context, next: Next) {
  if (seenNonces.size + issuedNonces.size > 100) cleanupNonces()
  if (c.req.method === 'OPTIONS') {
    return next()
  }

  const orbitId = c.req.header('X-Orbit-Id')
  const timestamp = c.req.header('X-Orbit-Timestamp')
  const signatureHex = c.req.header('X-Orbit-Signature')
  const publicKeyHex = c.req.header('X-Orbit-PubKey')
  const encryptionPubKeyHex = c.req.header('X-Orbit-PubKey-Enc') || ''
  const nonce = c.req.header('X-Orbit-Nonce') || ''

  if (!orbitId || !timestamp || !signatureHex || !publicKeyHex) {
    return errorResponse(c, 'Missing authentication headers', 401)
  }

  // Validate timestamp. GET requests are idempotent and carry no nonce, so
  // they get a wider window to survive browser connection queues under load
  // (e.g. the admin image stream). Large multipart uploads (Babecock card,
  // match-card, camera capture) need a wider window too — slow networks can
  // blow past 30s between sign-attempt and the server actually receiving the
  // body. We bump the window to 5 minutes for those requests so a fat POST
  // never expires mid-upload.
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return errorResponse(c, 'Invalid timestamp', 400)
  const isMultipartUpload = c.req.method !== 'GET' && (c.req.header('Content-Type') || '').includes('multipart/')
  const maxAgeMs = isMultipartUpload ? 300_000 : (c.req.method === 'GET' ? 120_000 : 30_000)
  const timeDiff = Math.abs(Date.now() - ts)
  if (timeDiff > maxAgeMs) {
    return errorResponse(c, 'Request expired', 401)
  }

  // Nonce replay protection for non-GET requests
  if (c.req.method !== 'GET' && nonce) {
    cleanupNonces()

    // Check if it's a server-issued nonce (preferred)
    const issued = issuedNonces.get(nonce)
    if (issued) {
      if (issued.expiresAt <= Date.now()) {
        issuedNonces.delete(nonce)
        return errorResponse(c, 'Nonce expired — request a new one', 401)
      }
      if (issued.orbitId !== orbitId) {
        return errorResponse(c, 'Nonce issued for a different identity', 401)
      }
      // Server-issued nonce is valid; mark as used
      issuedNonces.delete(nonce)
      seenNonces.set(nonce, Date.now())
    } else {
      // Fall back to client-issued nonce validation
      if (seenNonces.has(nonce)) return errorResponse(c, 'Nonce already used (replay detected)', 401)
      if (seenNonces.size >= MAX_NONCES) {
        const oldestKey = seenNonces.keys().next().value
        if (oldestKey) seenNonces.delete(oldestKey)
      }
      seenNonces.set(nonce, Date.now())
    }
  }

  // The signature covers the Method, URL, Timestamp, Nonce, and Body
  const url = new URL(c.req.url).pathname
  const method = c.req.method
  const isMultipart = (c.req.header('Content-Type') || '').includes('multipart/')
  let bodyText = ''
  if (['POST', 'PUT', 'PATCH'].includes(method) && !isMultipart) {
    const cloned = c.req.raw.clone()
    bodyText = await cloned.text()
  }

  const payload = nonce
    ? `${method}|${url}|${timestamp}|${nonce}|${bodyText}`
    : `${method}|${url}|${timestamp}|${bodyText}`
  const messageBytes = new TextEncoder().encode(payload)

  let signatureBytes;
  try {
    signatureBytes = hexToBytes(signatureHex)
  } catch (e) {
    return errorResponse(c, 'Invalid signature encoding', 400)
  }

  let isValid = false;
  try {
    isValid = verifySignature(signatureBytes, messageBytes, publicKeyHex)
  } catch (e) {
    return errorResponse(c, 'Signature verification failed', 400)
  }

  if (!isValid) {
    return errorResponse(c, 'Invalid signature', 401)
  }

  // Hash the public key and ensure it matches the Orbit ID to prevent identity spoofing
  const computedId = bytesToHex(sha256(hexToBytes(publicKeyHex)))
  if (computedId !== orbitId) {
    return errorResponse(c, 'Public key does not match Orbit ID', 401)
  }

  // Auto-register user in DB if they don't exist and keep last_seen fresh
  try {
    const nowIso = new Date().toISOString()
    await c.env.DB.prepare('INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen').bind(orbitId, publicKeyHex, nowIso).run()
    if (encryptionPubKeyHex) {
      try {
        await c.env.DB.prepare('UPDATE Users SET encryption_pub_key = ? WHERE id = ?').bind(encryptionPubKeyHex, orbitId).run()
      } catch {
        // column optional
      }
    }
  } catch (err) {
  }

  c.set('orbitId', orbitId)
  c.set('publicKeyHex', publicKeyHex)
  c.set('rawBody', bodyText)

  // Check if user is banned (table is optional). Include the ban reason in
  // the 403 response body so the client can surface why access is denied.
  try {
    const row = await c.env.DB.prepare('SELECT reason FROM Bans WHERE user_id = ?').bind(orbitId).first() as { reason?: string | null } | null
    if (row) {
      return errorResponse(c, row.reason ? `Account suspended: ${row.reason}` : 'Account suspended', 403)
    }
  } catch { }

  await next()
}
