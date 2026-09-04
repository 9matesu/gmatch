import { Context, Next } from 'hono'

interface Bucket {
  count: number
  resetAt: number
}

const stores = new Map<string, Bucket>()
const WINDOW_MS = 60_000
const AUTH_MAX_REQUESTS = 1200
const ANON_MAX_REQUESTS = 180

// Lightweight polling & user actions exempt from rate limiting
const EXEMPT_PATHS = new Set([
  'POST:/api/users/heartbeat',
  'POST:/api/users/profile',
  'POST:/api/objects',
  'POST:/api/lobby/images',
  'POST:/api/lobby/join',
  'POST:/api/lobby/leave',
  'POST:/api/ws-ticket',
  'GET:/api/friends',
  'GET:/api/friends/requests',
  'GET:/api/inbox',
  'GET:/api/recommendations',
  'GET:/api/users',
  'GET:/api/signal/pending',
  'GET:/api/announcements',
  'GET:/api/objects/stories',
  'GET:/api/lobby',
  'GET:/api/lobby/images',
  'GET:/api/lobby/special',
  'GET:/api/lobby/league',
  'GET:/api/rooms',
])

function isExempt(c: Context): boolean {
  const method = c.req.method
  const url = c.req.path
  if (EXEMPT_PATHS.has(`${method}:${url}`)) return true
  if (method === 'GET' && url.startsWith('/api/admin/')) return true
  if (method === 'GET' && url.startsWith('/api/objects/')) return true
  if (method === 'GET' && url.endsWith('/pfp')) return true
  if (url.startsWith('/api/lobby/match/') || url.startsWith('/api/lobby/special/')) return true
  return false
}

function cleanupStores() {
  const now = Date.now()
  for (const [key, bucket] of stores) {
    if (bucket.resetAt <= now) stores.delete(key)
  }
}

function getClientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
}

function getRateLimitSubject(c: Context): { key: string; max: number } {
  const orbitId = c.req.header('x-orbit-id') || c.req.header('X-Orbit-Id')
  if (orbitId && /^[a-zA-Z0-9_-]{8,128}$/.test(orbitId)) {
    return { key: `id:${orbitId}`, max: AUTH_MAX_REQUESTS }
  }
  return { key: `ip:${getClientIp(c)}`, max: ANON_MAX_REQUESTS }
}

export async function rateLimit(c: Context, next: Next) {
  if (isExempt(c)) {
    await next()
    return
  }

  if (stores.size > 100) cleanupStores()
  const subject = getRateLimitSubject(c)
  const now = Date.now()
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS
  const key = `${subject.key}:${windowStart}`
  const maxRequests = subject.max

  // Try in-memory cache first
  let bucket = stores.get(key)
  if (!bucket || bucket.resetAt <= now) {
    // Try DB-backed rate limit for horizontal scaling
    try {
      const db = (c as any).env?.DB
      if (db) {
        const row = (await db.prepare('SELECT count FROM RateLimits WHERE key = ? AND window_start = ?').bind(key, windowStart).first()) as { count?: number } | null
        const dbCount = row?.count || 0
        if (dbCount >= maxRequests) {
          const resetSec = Math.ceil((windowStart + WINDOW_MS - now) / 1000)
          c.header('X-RateLimit-Limit', String(maxRequests))
          c.header('X-RateLimit-Remaining', '0')
          c.header('X-RateLimit-Reset', String(resetSec))
          c.header('Retry-After', String(resetSec))
          return c.json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
        }
        // Seed in-memory cache from DB
        bucket = { count: dbCount, resetAt: windowStart + WINDOW_MS }
        stores.set(key, bucket)
      }
    } catch {
      // DB fallback — use in-memory only
    }
  }

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    stores.set(key, bucket)
  }

  bucket.count++

  try {
    const db = (c as any).env?.DB
    if (db) {
      await db.prepare(
        'INSERT INTO RateLimits (key, count, window_start) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1'
      ).bind(key, 1, windowStart).run()
    }
  } catch {}

  const remaining = Math.max(0, maxRequests - bucket.count)
  const resetSec = Math.ceil((bucket.resetAt - now) / 1000)

  c.header('X-RateLimit-Limit', String(maxRequests))
  c.header('X-RateLimit-Remaining', String(remaining))
  c.header('X-RateLimit-Reset', String(resetSec))

  if (bucket.count > maxRequests) {
    c.header('Retry-After', String(resetSec))
    c.header('Access-Control-Allow-Origin', c.req.header('Origin') || '*')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Orbit-Id, X-Orbit-Timestamp, X-Orbit-Signature, X-Orbit-PubKey, X-Orbit-PubKey-Enc, X-Orbit-Nonce, Idempotency-Key, X-Idempotency-Key')
    c.header('Access-Control-Allow-Methods', 'POST, GET, PATCH, DELETE, OPTIONS')
    return c.json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
  }

  await next()
}
