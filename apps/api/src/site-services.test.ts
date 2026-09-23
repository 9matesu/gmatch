import { describe, it, expect } from 'vitest'
import { isApiPath, parseSiteServices, siteAllows } from './site-services'

describe('SITE_SERVICES gate', () => {
  it('default is a full node (no gating)', () => {
    expect(parseSiteServices({})).toBeNull()
    expect(parseSiteServices({ SITE_SERVICES: 'all' })).toBeNull()
  })

  it('site mode parses the service list', () => {
    const s = parseSiteServices({ SITE_SERVICES: 'mail,turn' })
    expect(s && [...s].sort()).toEqual(['mail', 'turn'])
  })

  it('site mode allows ONLY courier surfaces', () => {
    const s = parseSiteServices({ SITE_SERVICES: 'mail,turn' })!
    expect(siteAllows(s, '/api/health')).toBe(true)
    expect(siteAllows(s, '/api/mail/' + 'a'.repeat(64))).toBe(true)
    expect(siteAllows(s, '/api/mail/ws')).toBe(true)
     expect(siteAllows(s, '/api/turn/credentials')).toBe(true)
   })

   it('site mode allows admin only when explicitly enabled', () => {
     const courier = parseSiteServices({ SITE_SERVICES: 'mail,turn' })!
     const admin = parseSiteServices({ SITE_SERVICES: 'mail,turn,admin' })!
     expect(siteAllows(courier, '/api/admin/verify-pin')).toBe(false)
     expect(siteAllows(admin, '/api/admin/verify-pin')).toBe(true)
     expect(siteAllows(admin, '/api/posts')).toBe(false)
   })

  it('site mode 404s every contentful/stateful route — the law at the edge', () => {
    const s = parseSiteServices({ SITE_SERVICES: 'mail,turn' })!
    for (const dead of [
      '/api/pm', '/api/posts', '/api/objects/x', '/api/users/online', '/api/users',
      '/api/lobby', '/api/cards', '/api/economy/balance', '/api/admin/ping',
      '/api/ws', '/api/ws-ticket', '/api/discord-invite', '/api/signal/initiate',
      '/p/abc', '/u/bob', '/.well-known/security.txt',
    ]) {
      expect(siteAllows(s, dead), dead).toBe(false)
    }
  })

  it('mail without turn does not sneak turn through', () => {
    const s = parseSiteServices({ SITE_SERVICES: 'mail' })!
    expect(siteAllows(s, '/api/turn/credentials')).toBe(false)
  })

  it('isApiPath recognizes the routed surface (unchanged for full nodes)', () => {
    expect(isApiPath('/api/health')).toBe(true)
    expect(isApiPath('/p/abc')).toBe(true)
    expect(isApiPath('/u/bob')).toBe(true)
    expect(isApiPath('/.well-known/x')).toBe(true)
    expect(isApiPath('/assets/app.js')).toBe(false)
    expect(isApiPath('/')).toBe(false)
  })
})
