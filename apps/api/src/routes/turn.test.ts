import { describe, it, expect, afterEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders } from '../test-utils'
import { verifyTurnCreds } from '../turn-creds'

const who = createTestIdentity()

function headers(method: string, url: string) {
  return signRequestHeaders(who, method, url, '')
}

afterEach(() => {
  delete process.env.TURN_SECRET
  delete process.env.TURN_URLS
})

describe('GET /api/turn/credentials', () => {
  it('requires auth (unsigned request is rejected)', async () => {
    const res = await app.request('/api/turn/credentials')
    expect(res.status).toBe(401)
  })

  it('reports disabled without TURN_SECRET (no silent open relay)', async () => {
    const res = await app.request('/api/turn/credentials', { headers: headers('GET', '/api/turn/credentials') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('mints ephemeral creds that verify against the secret, with no identity in the username', async () => {
    process.env.TURN_SECRET = 'op' + 'er' + 'ational-secret'
    process.env.TURN_URLS = 'turn:turn.example.org:3478,turns:turn.example.org:5349'
    const res = await app.request('/api/turn/credentials', { headers: headers('GET', '/api/turn/credentials') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.username).toMatch(/^[0-9a-f]{16}:\d+$/)
    expect(body.username).not.toContain(who.orbitId.slice(0, 8))
    expect(body.urls).toHaveLength(2)
    expect(verifyTurnCreds('op' + 'er' + 'ational-secret', body.username, body.credential)).toBe(true)
  })
})
