import { describe, it, expect } from 'vitest'
import app from '../index'
import { generateIdentity, signMessage } from '@orbit/crypto'
import { deliveryToken, seal1to1, open1to1 } from '@orbit/protocol'

const alice = generateIdentity()
const bob = generateIdentity()
const BOB_TOKEN = deliveryToken(bob.publicKeyHex)

function envelopeForBob(body: string) {
  return seal1to1(body, 'mail', alice, bob)
}

async function put(env: unknown) {
  return app.request(`/api/mail/${(env as { to: string }).to}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env }),
  })
}

describe('blind courier REST (routes/mail)', () => {
  it('PUT stores an opaque envelope; GET returns it byte-identical; bob opens it', async () => {
    const env = envelopeForBob('hi bob')
    const putRes = await put(env)
    expect(putRes.status).toBe(202)

    const listRes = await app.request(`/api/mail/${BOB_TOKEN}`)
    expect(listRes.status).toBe(200)
    const { envelopes } = await listRes.json()
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].sealed).toBe(env.sealed)

    const opened = open1to1(envelopes[0], bob.encryptionPrivHex)
    expect(opened.body).toBe('hi bob')
    expect(opened.senderOrbitId).toBe(alice.orbitId)
  })

  it('GET is idempotent until acked (swarm semantics)', async () => {
    const env = envelopeForBob('twice')
    await put(env)
    const a = await (await app.request(`/api/mail/${BOB_TOKEN}`)).json()
    const b = await (await app.request(`/api/mail/${BOB_TOKEN}`)).json()
    expect(a.envelopes.map((e: { id: string }) => e.id)).toEqual(b.envelopes.map((e: { id: string }) => e.id))
    expect(a.envelopes.length).toBeGreaterThan(0)
  })

  it('ack drains only with a valid signature over token|ids', async () => {
    const env = envelopeForBob('drain me')
    await put(env)
    const ids = [env.id]
    const msg = new TextEncoder().encode(`${BOB_TOKEN}|${ids.join(',')}`)
    const sig = Buffer.from(signMessage(msg, bob.privateKeyHex)).toString('hex')

    // Eve's signature is rejected (403) and mail survives.
    const eve = generateIdentity()
    const bad = await app.request(`/api/mail/${BOB_TOKEN}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, pubkey: eve.publicKeyHex, sig: 'ab'.repeat(64) }),
    })
    expect(bad.status).toBe(403)
    const still = await (await app.request(`/api/mail/${BOB_TOKEN}`)).json()
    expect(still.envelopes.some((e: { id: string }) => e.id === env.id)).toBe(true)

    const good = await app.request(`/api/mail/${BOB_TOKEN}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, pubkey: bob.publicKeyHex, sig }),
    })
    expect(good.status).toBe(200)
    const after = await (await app.request(`/api/mail/${BOB_TOKEN}`)).json()
    expect(after.envelopes.some((e: { id: string }) => e.id === env.id)).toBe(false)
  })

  it('rejects malformed envelopes and token mismatch', async () => {
    const env = envelopeForBob('x')
    const mismatch = await app.request(`/api/mail/${'c'.repeat(64)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    })
    expect(mismatch.status).toBe(400)
    const badShape = await put({ ...env, v: 1 })
    expect(badShape.status).toBe(400)
  })

  it('the courier never sees plaintext: wire fields are opaque only', async () => {
    const secret = 'TOP-SECRET-CAPTION'
    const env = envelopeForBob(secret)
    const wire = JSON.stringify(env)
    expect(wire).not.toContain(secret)
    await put(env)
    const raw = await (await app.request(`/api/mail/${BOB_TOKEN}`)).text()
    expect(raw).not.toContain(secret)
  })
})
