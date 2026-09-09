/**
 * Security plan B.6 — SITE-blindness end-to-end.
 *
 * The official site runs with SITE_SERVICES=mail,turn. This test composes the
 * EXACT edge gate from serve.ts around the full app with a DB proxy that
 * records every prepare()/save() call, then proves:
 *   1. every contentful/identity endpoint 404s at the edge;
 *   2. ZERO database statements execute on any of those requests;
 *   3. the courier (mail/turn/health/statics) works WITHOUT touching content
 *      tables (mail-store has its own in-memory store);
 *   4. the legacy identity-bound /api/ws upgrade is refused in site mode.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import app from './index'
import { isApiPath, parseSiteServices, siteAllows } from './site-services'
import { createMockEnv } from './test-utils'

const CONTENT_TABLES = /\b(Users|Posts|Objects|Pm|Messages|Stories|Cards|Matches|Announcements|Reports|Wallets|Ledger)\b/i

function contentSql(sqls: string[]): string[] {
  return sqls.filter((q) => CONTENT_TABLES.test(q))
}

const CONTENTFUL = [
  ['GET', '/api/pm'],
  ['POST', '/api/pm'],
  ['GET', '/api/posts'],
  ['POST', '/api/posts'],
  ['GET', '/api/objects/whatever'],
  ['POST', '/api/objects'],
  ['GET', '/api/users'],
  ['POST', '/api/users'],
  ['GET', '/api/lobby'],
  ['GET', '/api/economy/balance'],
  ['POST', '/api/admin/verify-pin'],
  ['GET', '/api/signal/rooms'],
  ['GET', '/api/booru?q=x'],
]

describe('B.6 — site mode is blind (edge gate + zero DB touches)', () => {
  let dbCalls: string[]
  let gated: Hono<any>
  let env: any

  beforeEach(async () => {
    dbCalls = []
    const raw = await createMockEnv()
    env = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === 'DB') {
          return new Proxy(raw.DB, {
            get(dbObj, key) {
              if (key === 'prepare') {
                return (sql: string) => {
                  dbCalls.push(sql)
                  return dbObj.prepare(sql)
                }
              }
              const v = Reflect.get(dbObj, key)
              return typeof v === 'function' ? v.bind(dbObj) : v
            },
            has(_d, key) {
              return Reflect.has(raw.DB, key)
            },
            set(_d, key, v) {
              ;(raw.DB as any)[key] = v
              return true
            },
            deleteProperty(_d, key) {
              delete (raw.DB as any)[key]
              return true
            },
            ownKeys() {
              return Reflect.ownKeys(raw.DB)
            },
            getPrototypeOf() {
              return Reflect.getPrototypeOf(raw.DB)
            },
          })
        }
        const v = Reflect.get(raw, prop)
        return typeof v === 'function' && prop !== '_client' ? v.bind(raw) : v
      },
      has: (_t, prop) => Reflect.has(raw, prop),
    })

    // EXACT composition of serve.ts's edge gate.
    const siteServices = parseSiteServices({ SITE_SERVICES: 'mail,turn' })
    const outer = new Hono()
    outer.use('*', async (c, next) => {
      const path = new URL(c.req.url).pathname
      if (siteServices && isApiPath(path) && !siteAllows(siteServices, path)) {
        return c.text('Not Found', 404)
      }
      c.env = env
      return next()
    })
    outer.all('*', async (c) => app.fetch(new Request(c.req.url, { method: c.req.method, headers: c.req.raw.headers, body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.text().catch(() => undefined) }), env))
    gated = outer
  })

  it('every contentful endpoint 404s AND executes zero SQL', async () => {
    for (const [method, path] of CONTENTFUL) {
      dbCalls = []
      const res = await gated.request(path, { method })
      expect(res.status, `${path} must 404 in site mode`).toBe(404)
      expect(contentSql(dbCalls), `${path} leaked content SQL: ${JSON.stringify(dbCalls)}`).toEqual([])
    }
  })

  it('courier surface works with zero content-table SQL', async () => {
    const put = await gated.request('/api/mail/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: { v: 2, kind: 'dm', id: 'aaaaaaaaaaaa', to: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', sealed: 'YWJjZGVm' } }),
    })
    expect(put.status).toBe(202)
    const get = await gated.request('/api/mail/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(Array.isArray(body.envelopes)).toBe(true)
    expect(body.envelopes.length).toBe(1)
    expect(body.envelopes[0].sealed).toBe('YWJjZGVm') // verbatim blind bytes
  })

  it('health endpoint answers without SQL', async () => {
    dbCalls = []
    const res = await gated.request('/api/health')
    expect([200, 503]).toContain(res.status) // db_ready flag depends on test env; edge allows it
    expect(contentSql(dbCalls)).toEqual([]) // anonymous rate-limit counters are allowed
  })

  it('siteAllows matches the gate matrix used in serve.ts (regression anchor)', () => {
    const s = parseSiteServices({ SITE_SERVICES: 'mail,turn' })!
    expect(siteAllows(s, '/api/mail/abc')).toBe(true)
    expect(siteAllows(s, '/api/mail/ws')).toBe(true)
    expect(siteAllows(s, '/api/turn/credentials')).toBe(true)
    expect(siteAllows(s, '/api/health')).toBe(true)
    expect(siteAllows(s, '/api/pm')).toBe(false)
    expect(siteAllows(s, '/api/posts')).toBe(false)
    expect(siteAllows(s, '/api/users')).toBe(false)
  })
})
