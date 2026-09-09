import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * coturn `use-auth-secret` ephemeral credentials (plan Phase 2.2).
 *
 * The site is the ONLY TURN server. Clients mint short-lived creds by proving
 * possession of their identity — but the credential itself is bound to a
 * RANDOM username, never to the orbitId, so the TURN logs cannot say who
 * relayed (blind-courier law #2: the server never learns who enters/leaves).
 *
 * Format (coturn REST API): username = "<rand>:<unix-exp>",
 * credential = base64(HMAC-SHA256(secret, username)).
 */

export interface TurnCreds {
  username: string
  credential: string
  ttl: number
  urls: string[]
}

const USERNAME_RE = /^[0-9a-f]{16}:\d{1,13}$/

export function mintTurnCreds(
  secret: string,
  urls: string[],
  now: number = Date.now(),
  ttlSeconds = 3600,
  rand?: string,
): TurnCreds {
  if (!secret) throw new Error('TURN_SECRET not configured')
  const r = rand ?? randomHex(8)
  if (!/^[0-9a-f]{16}$/.test(r)) throw new Error('bad random component')
  const username = `${r}:${Math.floor(now / 1000) + ttlSeconds}`
  const credential = createHmac('sha256', secret).update(username).digest('base64')
  return { username, credential, ttl: ttlSeconds, urls }
}

/** Verify a credential the way coturn does (used by tests + self-checks). */
export function verifyTurnCreds(secret: string, username: string, credential: string, now: number = Date.now()): boolean {
  if (!USERNAME_RE.test(username)) return false
  const [, expStr] = username.split(':')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false
  const expected = createHmac('sha256', secret).update(username).digest()
  let got: Buffer
  try {
    got = Buffer.from(credential, 'base64')
  } catch {
    return false
  }
  return got.length === expected.length && timingSafeEqual(got, expected)
}

function randomHex(n: number): string {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
