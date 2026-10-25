// Security plan B.5 / F7: CSP connect-src must not contain wildcards.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { securityHeaders, connectSrcFromEnv } from '../middleware/security-headers'

function app(): Hono {
  const a = new Hono()
  a.use('*', securityHeaders)
  a.get('/x', (c) => c.text('ok'))
  return a
}

describe('B.5 — CSP origin lockdown', () => {
  it('default CSP contains NO *.host wildcards in connect-src', async () => {
    const res = await app().request('/x')
    const csp = res.headers.get('content-security-policy') || ''
    const connect = csp.split(';').find((p) => p.trim().startsWith('connect-src')) || ''
    expect(connect).not.toMatch(/\*\./)
    expect(connect).toContain("'self'")
  })

  it('CSP_CONNECT_ORIGINS extends connect-src with EXACT origins only', () => {
    const src = connectSrcFromEnv({ CSP_CONNECT_ORIGINS: 'https://gmatch.pages.dev,wss://gmatch.pages.dev' })
    expect(src).toContain("'self' https://gmatch.pages.dev wss://gmatch.pages.dev")
    expect(src).not.toContain('*.')
  })

  it('malformed entries are dropped (no wildcard smuggling)', () => {
    const src = connectSrcFromEnv({ CSP_CONNECT_ORIGINS: 'https://*.evil.com, not-a-url, wss://good.example ' })
    expect(src).not.toContain('evil')
    expect(src).not.toContain('not-a-url')
    expect(src).toContain('wss://good.example')
  })

  it('full CSP still carries the non-negotiable directives', async () => {
    const csp = (await app().request('/x')).headers.get('content-security-policy') || ''
    for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
      expect(csp).toContain(d)
    }
  })
})
