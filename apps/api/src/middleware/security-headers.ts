import { Context, Next } from 'hono'

export async function securityHeaders(c: Context, next: Next) {
  await next()

  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains', { append: false })
  c.header('X-Content-Type-Options', 'nosniff', { append: false })
  c.header('X-Frame-Options', 'DENY', { append: false })
  c.header('Referrer-Policy', 'no-referrer', { append: false })
  // Lock down sensitive browser features. Camera/mic are self-only because
  // CameraCapture + FlashModal already require a user gesture; geolocation is
  // never used. Keeping PI face/voice APIs disabled across the board.
  c.header('Permissions-Policy', 'geolocation=(), camera=(self), microphone=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()')
  // Isolate the browsing context. Same-origin keeps dialogs/popups from
  // reaching into the app via window.opener, without breaking image/lightbox
  // embedding by requiring a strict COEP policy.
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Resource-Policy', 'cross-origin')
  // img-src dropped https: now that all external media is proxied in under
  // /api — clients should never resolve a remote host themselves, eliminating
  // IP-leak + cross-origin tracker risks. blob:/data: stay for canvas PFP
  // generation and in-memory lightboxes.
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; ${connectSrcFromEnv()}; form-action 'self'; frame-ancestors 'none'`,
    { append: false }
  )
}

/**
 * connect-src built from EXACT origins only (security plan B.5): 'self' plus
 * a comma-separated allow-list from CSP_CONNECT_ORIGINS. Wildcard hosts are
 * rejected — the old wildcard grants (any tenant of a PaaS domain) meant any
 * host there could have been an exfil target.
 */
export function connectSrcFromEnv(env: Record<string, string | undefined> = process.env): string {
  const parts = ["connect-src 'self'"]
  const raw = env.CSP_CONNECT_ORIGINS || ''
  for (const item of raw.split(',')) {
    const origin = item.trim()
    if (!origin) continue
    let u: URL
    try {
      u = new URL(/:\/\//.test(origin) ? origin : `https://${origin}`)
    } catch {
      continue
    }
    if (!/^wss?:$|^https?:$/.test(u.protocol)) continue
    if (u.hostname.includes('*') || origin.includes('*')) continue
    // Schemeless inputs parse as https://<token> — require the token to at
    // least look like a hostname (has a dot) so junk like `not-a-url` dies.
    if (!/:\/\//.test(origin) && !u.hostname.includes('.')) continue
    if (u.pathname !== '/' || u.search || u.hash) continue
    const scheme = u.protocol === 'wss:' || u.protocol === 'ws:' ? u.protocol.replace(':', '') : 'https'
    const wsScheme = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss' : 'ws'
    const base = `${scheme}://${u.host}`
    const alt = `${wsScheme}://${u.host}`
    if (!parts.includes(base)) parts.push(base)
    if (scheme === 'https' && !parts.includes(alt)) parts.push(alt)
  }
  return parts.join(' ')
}

/**
 * Mask PII before it lands in console/server logs. Currently redacts
 * x-forwarded-for / x-real-ip (per the privacy audit request); pass any
 * header through `redactHeader` so future PII-bearing headers stay private.
 */
export function redactIp(ip: string | undefined | null): string {
  if (!ip) return 'unknown'
  // Keep first /24 wall-breaking last octet for forensics without leaking
  // the full client address. IPv6 keeps its /64 prefix.
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':') + '::X'
  }
  const parts = ip.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.X`
  return 'unknown'
}

export function clientIpForLog(c: Context): string {
  return redactIp(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'))
}
