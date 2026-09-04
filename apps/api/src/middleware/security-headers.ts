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
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://goonmatch.fly.dev wss://goonmatch.fly.dev https://*.fly.dev wss://*.fly.dev https://orbit-api.mcos-mateus.workers.dev wss://orbit-api.mcos-mateus.workers.dev https://*.workers.dev; form-action 'self'; frame-ancestors 'none'",
    { append: false }
  )
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
