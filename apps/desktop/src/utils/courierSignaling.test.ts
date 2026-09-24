// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { sendCourierSignal, handleInboundSignal, type CourierSignalPayload } from './courierSignaling'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { open1to1, deliveryToken } from '@orbit/protocol'

describe('courierSignaling', () => {
  const alice = generateIdentity() as OrbitIdentity
  const bob = generateIdentity() as OrbitIdentity

  it('seals signal envelope to recipient token via PUT /api/mail/:token', async () => {
    let capturedUrl = ''
    let capturedBody: any = null

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const payload: CourierSignalPayload = {
      type: 'offer',
      sessionId: 'test-session-123',
      fromOrbitId: alice.orbitId,
      fromPubKeyHex: alice.publicKeyHex,
      fromEncPubHex: alice.encryptionPubHex || '',
      sdp: { type: 'offer', sdp: 'v=0\r\no=alice...' },
    }

    const ok = await sendCourierSignal(
      bob.publicKeyHex,
      bob.encryptionPubHex || '',
      payload,
      alice,
      fetchMock as unknown as typeof globalThis.fetch,
    )

    expect(ok).toBe(true)
    const expectedToken = deliveryToken(bob.publicKeyHex)
    expect(capturedUrl).toContain(`/api/mail/${expectedToken}`)
    expect(capturedBody.env.kind).toBe('signal')
    expect(capturedBody.env.to).toBe(expectedToken)

    // Verify Bob can decrypt it
    const opened = open1to1(capturedBody.env, bob.encryptionPrivHex || '')

    expect(opened.kind).toBe('signal')
    const decryptedPayload = JSON.parse(opened.body)
    expect(decryptedPayload.type).toBe('offer')
    expect(decryptedPayload.sessionId).toBe('test-session-123')
    expect(decryptedPayload.fromOrbitId).toBe(alice.orbitId)
  })

  it('handleInboundSignal ignores non-signal envelopes', async () => {
    const fakeEnvelope: any = {
      kind: 'mail',
      id: 'env-1',
      to: 'token',
      body: JSON.stringify({ text: 'hello' }),
      senderPubHex: alice.publicKeyHex,
      senderOrbitId: alice.orbitId,
    }

    const handled = await handleInboundSignal(fakeEnvelope, bob)
    expect(handled).toBe(false)
  })
})
