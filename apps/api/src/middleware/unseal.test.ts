// T2 server-side: a sealed mutation must authenticate and its inner JSON body
// must reach the route handler unchanged.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { generateIdentity } from '@orbit/crypto'
import { sealApiRequest } from '@orbit/protocol'
import { unsealRequest } from './unseal'
import { orbitAuth } from './auth'
import { createMockEnv, type TestIdentity } from '../test-utils'

describe('sealed api request middleware', () => {
  const node = generateIdentity()

  function buildApp(env: any) {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.env = { ...env, NODE_PRIV_HEX: node.encryptionPrivHex }
      return next()
    })
    app.use('*', unsealRequest)
    app.post('/api/test', orbitAuth, async (c) => {
      const body = await c.req.json()
      return c.json({ echo: body })
    })
    return app
  }

  async function signedInnerHeaders(client: TestIdentity, method: string, url: string, body: string) {
    // Reuse the exact payload the client signs (nonce path).
    const { signRequestHeaders } = await import('../test-utils')
    return signRequestHeaders(client, method, url, body)
  }

  it('accepts a sealed POST and the route sees the plaintext JSON body', async () => {
    const env = await createMockEnv()
    const app = buildApp(env)
    const client = createClientIdentity()
    const body = JSON.stringify({ caption: 'private text' })
    const headers = await signedInnerHeaders(client, 'POST', '/api/test', body)
    const sealHeader = sealApiRequest(
      { headers, body },
      { privateKeyHex: client.privateKeyHex, publicKeyHex: client.publicKeyHex, encryptionPrivHex: client.encryptionPrivHex, encryptionPubHex: client.encryptionPubHex },
      node.encryptionPubHex,
    )
    const res = await app.request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orbit-Sealed': sealHeader },
      body: 'sealed-placeholder', // outer body must be ignored
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echo: { caption: 'private text' } })
  })

  it('400 on tampered/unopenable seal', async () => {
    const env = await createMockEnv()
    const app = buildApp(env)
    const res = await app.request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orbit-Sealed': 'garbage' },
      body: 'x',
    })
    expect(res.status).toBe(400)
  })

  it('plain signed path still works (no seal header)', async () => {
    const env = await createMockEnv()
    const app = buildApp(env)
    const client = createClientIdentity()
    const body = JSON.stringify({ caption: 'plain' })
    const headers = await signedInnerHeaders(client, 'POST', '/api/test', body)
    const res = await app.request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echo: { caption: 'plain' } })
  })
})

import { createTestIdentity as createClientIdentity } from '../test-utils'
