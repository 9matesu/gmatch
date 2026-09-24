// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { broadcastPresence, fetchPresenceRoster, PRESENCE_TOKEN } from './courierPresence'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'

describe('courierPresence', () => {
  const alice = generateIdentity() as OrbitIdentity
  const bob = generateIdentity() as OrbitIdentity

  it('broadcasts signed presence envelope to the well-known presence token', async () => {
    let capturedUrl = ''
    let capturedBody: any = null

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const ok = await broadcastPresence(
      alice,
      { displayName: 'Alice In Wonderland', pfpUrl: 'https://example.com/alice.png' },
      fetchMock as unknown as typeof globalThis.fetch,
    )

    expect(ok).toBe(true)
    expect(capturedUrl).toContain(`/api/mail/${PRESENCE_TOKEN}`)
    expect(capturedBody.env).toBeDefined()
    expect(capturedBody.env.kind).toBe('announce')
    expect(capturedBody.env.to).toBe(PRESENCE_TOKEN)
    expect(capturedBody.env.sealed).toBeDefined()
  })

  it('fetches presence beacons, verifies signatures, and maps to online users', async () => {
    let capturedEnvelope: any = null

    const putFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedEnvelope = JSON.parse(init?.body as string).env
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    await broadcastPresence(
      bob,
      { displayName: 'Bob The Builder', pfpUrl: null },
      putFetch as unknown as typeof globalThis.fetch,
    )

    const getFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`/api/mail/${PRESENCE_TOKEN}`)) {
        return new Response(JSON.stringify({
          envelopes: [capturedEnvelope],
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    const users = await fetchPresenceRoster(
      alice.orbitId,
      getFetch as unknown as typeof globalThis.fetch,
    )

    expect(users).toHaveLength(1)
    expect(users[0].id).toBe(bob.orbitId)
    expect(users[0].display_name).toBe('Bob The Builder')
    expect(users[0].online).toBe(true)
    expect(users[0].publicKey).toBe(bob.publicKeyHex)
  })

  it('ignores forged or tampered presence beacons', async () => {
    const fakeEnvelope = {
      v: 2,
      kind: 'announce',
      to: PRESENCE_TOKEN,
      id: 'fake-id',
      sealed: btoa(JSON.stringify({
        orbitId: 'impostor',
        displayName: 'Impostor',
        publicKeyHex: bob.publicKeyHex,
        timestamp: Date.now(),
        sig: 'bad-signature',
      })),
      exp: Date.now() + 60000,
    }

    const getFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({
        envelopes: [fakeEnvelope],
      }), { status: 200 })
    })

    const users = await fetchPresenceRoster(
      alice.orbitId,
      getFetch as unknown as typeof globalThis.fetch,
    )

    expect(users).toHaveLength(0)
  })
})
