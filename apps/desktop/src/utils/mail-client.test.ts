// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { open1to1, deliveryToken } from '@orbit/protocol'
import { MailClient, ackBody, type MailSocket } from './mail-client'

const alice = generateIdentity()
const bob = generateIdentity()
const BOB_TOKEN = deliveryToken(bob.publicKeyHex)

class FakeSocket implements MailSocket {
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  send(d: string) { this.sent.push(d) }
  close() { this.closed = true }
  emitOpen() { this.onopen?.() }
  emit(data: string) { this.onmessage?.({ data }) }
  emitClose() { this.onclose?.() }
}

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(async (input: any, init?: any) => handler(String(input), init)) as unknown as typeof fetch
}

function okJson(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function client(deps: Partial<Record<'fetchImpl' | 'onMail' | 'now', unknown>> = {}) {
  const sockets: FakeSocket[] = []
  const c = new MailClient({
    apiBase: 'http://courier.test',
    identity: bob,
    onMail: vi.fn(),
    webSocketFactory: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    ...deps,
  } as any)
  return { c, sockets }
}

describe('MailClient (blind courier)', () => {
  it('inbox token is the delivery token of MY pubkey', () => {
    const { c } = client()
    expect(c.token).toBe(BOB_TOKEN)
  })

  it('start() watches the token anonymously — the frame carries no identity', async () => {
    const { c, sockets } = client({ fetchImpl: makeFetch(async () => okJson({ envelopes: [] })) })
    c.start()
    expect(sockets).toHaveLength(1)
    sockets[0].emitOpen()
    await Promise.resolve()
    const watchFrame = JSON.parse(sockets[0].sent[0])
    expect(watchFrame).toEqual({ type: 'watch', tokens: [BOB_TOKEN] })
    expect(sockets[0].sent.join()).not.toContain(bob.orbitId)
    expect(sockets[0].sent.join()).not.toContain(bob.publicKeyHex)
  })

  it('a mail notice for my token triggers a pull, opens envelopes, acks consumed', async () => {
    // Alice -> bob sealed message, pre-generated through the protocol:
    const { seal1to1 } = await import('@orbit/protocol')
    const env = seal1to1('ping', 'mail', alice, bob)

    const onMail = vi.fn()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let box = [env] // stateful courier: ack drains the fake box
    const fetchImpl = makeFetch(async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/ack')) {
        const ackJson = JSON.parse(String(init!.body))
        box = box.filter((e) => !ackJson.ids.includes(e.id))
        return okJson({ ok: true })
      }
      return okJson({ envelopes: box })
    })
    const { c, sockets } = client({ fetchImpl, onMail })
    c.start()
    sockets[0].emitOpen()
    await new Promise((r) => setTimeout(r, 0))
    sockets[0].emit(JSON.stringify({ type: 'mail', to: BOB_TOKEN, id: env.id }))
    await new Promise((r) => setTimeout(r, 0))
    // Second pull after the ack finds an empty box -> consumed exactly once.
    sockets[0].emit(JSON.stringify({ type: 'mail', to: BOB_TOKEN, id: env.id }))
    await new Promise((r) => setTimeout(r, 0))

    expect(onMail).toHaveBeenCalledTimes(1)
    const opened = onMail.mock.calls[0][0]
    expect(opened.body).toBe('ping')
    expect(opened.senderOrbitId).toBe(alice.orbitId)

    const ackCall = calls.find((x) => x.url.endsWith('/ack'))
    expect(ackCall).toBeTruthy()
    const ackJson = JSON.parse(String(ackCall!.init!.body))
    expect(ackJson.ids).toEqual([env.id])
    expect(ackJson.pubkey).toBe(bob.publicKeyHex)
  })

  it('envelopes I cannot open are never acked (no DoS by acking foreign ids)', async () => {
    const eve = generateIdentity()
    const other = generateIdentity()
    const { seal1to1 } = await import('@orbit/protocol')
    // Eve mails the WRONG token slot (pretend collision): bob lists but cannot open.
    const foreign = seal1to1('not for you', 'mail', eve, other)
    const withForeignEnv = okJson({ envelopes: [foreign] })

    const fetchImpl = makeFetch(async (url) => {
      if (url.includes('/ack')) throw new Error('ack must not be called')
      return url.endsWith(`/api/mail/${BOB_TOKEN}`) ? withForeignEnv : okJson({ envelopes: [] })
    })
    const { c, sockets } = client({ fetchImpl })
    c.start()
    sockets[0].emitOpen()
    const opened = await c.pull()
    expect(opened).toHaveLength(0)
  })

  it('send() PUTs a sealed envelope whose wire form leaks nothing', async () => {
    let putBody = ''
    const fetchImpl = makeFetch(async (url, init) => {
      if (init?.method === 'PUT') putBody = String(init.body)
      return okJson({ ok: true })
    })
    const { c } = client({ fetchImpl })
    const env = await c.send('TOP SECRET DM', 'mail', alice)
    expect(env.to).toBe(deliveryToken(alice.publicKeyHex))
    expect(putBody).not.toContain('TOP SECRET DM')
    // Alice can open it with her keys.
    const opened = open1to1(env, alice.encryptionPrivHex)
    expect(opened.body).toBe('TOP SECRET DM')
    expect(opened.senderOrbitId).toBe(bob.orbitId)
  })

  it('reconnect uses jittered backoff and restarts the watch', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = makeFetch(async () => okJson({ envelopes: [] }))
      const { c, sockets } = client({ fetchImpl })
      c.start()
      sockets[0].emitClose()
      expect(sockets).toHaveLength(1)
      vi.advanceTimersByTime(70_000)
      expect(sockets.length).toBeGreaterThan(1)
      const s = sockets[sockets.length - 1]
      s.emitOpen()
      await vi.waitFor(() => expect(s.sent[0]).toContain('watch'))
      c.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ackBody signs exactly the contract the courier verifies', async () => {
    const { verifySignature, hexToBytes } = await import('@orbit/crypto')
    const body = ackBody(bob, BOB_TOKEN, ['aabbccdd', 'eeff0011'])
    expect(body.pubkey).toBe(bob.publicKeyHex)
    expect(verifySignature(hexToBytes(body.sig), new TextEncoder().encode(`${BOB_TOKEN}|aabbccdd,eeff0011`), bob.publicKeyHex)).toBe(true)
  })

  it('watches session delivery tokens and supplies epoch in ackBody when draining session mail', async () => {
    const { sessionDeliveryToken, seal1to1 } = await import('@orbit/protocol')
    const curEpoch = 'a'.repeat(32)
    const prevEpoch = 'b'.repeat(32)
    const curSessionToken = sessionDeliveryToken(bob.publicKeyHex, curEpoch)
    const prevSessionToken = sessionDeliveryToken(bob.publicKeyHex, prevEpoch)

    const sessionEnv = seal1to1('session message', 'mail', alice, bob, { to: curSessionToken })
    let ackPayload: any = null
    const fetchImpl = makeFetch(async (url, init) => {
      if (url.endsWith('/ack')) {
        ackPayload = JSON.parse(String(init!.body))
        return okJson({ ok: true })
      }
      if (url.endsWith(`/api/mail/${curSessionToken}`)) {
        return okJson({ envelopes: [sessionEnv] })
      }
      return okJson({ envelopes: [] })
    })

    const { c } = client({ fetchImpl })
    c.epoch = { cur: curEpoch, prev: prevEpoch }
    expect(c.watchedTokens()).toEqual([BOB_TOKEN, curSessionToken, prevSessionToken])

    await c.pull()
    expect(ackPayload).toBeTruthy()
    expect(ackPayload.ids).toEqual([sessionEnv.id])
    expect(ackPayload.epoch).toBe(curEpoch)
    expect(ackPayload.pubkey).toBe(bob.publicKeyHex)
  })
})

