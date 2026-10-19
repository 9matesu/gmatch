// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { generateIdentity } from '@orbit/crypto'
import { seal1to1 } from '@orbit/protocol'
import { useCourierDms } from './useCourierDms'
import { encodeDmBody } from '../utils/mail-dm'
import { _resetMailModeCache } from '../utils/mail-mode'
import type { MailSocket } from '../utils/mail-client'

const alice = generateIdentity()
const bob = generateIdentity()

// jsdom in this repo does not expose localStorage; stub like mail-dm.test.ts.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage

class FakeSocket implements MailSocket {
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  send(d: string) { this.sent.push(d) }
  close() { /* noop */ }
}

function mockFetch(box: { value: unknown[] }, acks: unknown[] = [], pmStatus = 404) {
  return vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.endsWith('/api/pm')) return new Response('{}', { status: pmStatus })
    if (url.endsWith('/ack')) {
      acks.push(JSON.parse(String(init.body)))
      box.value = [] // drain like the real courier
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (init?.method === 'PUT') {
      box.value.push(JSON.parse(String(init.body)).env)
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/mail/')) {
      return new Response(JSON.stringify({ envelopes: box.value }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

const wrapper = ({ children }: { children: ReactNode }) => createElement('div', null, children)

beforeEach(() => {
  _resetMailModeCache()
  localStorage.clear()
})

describe('useCourierDms', () => {
  it('legacy mode (inbox answers): hook is inert', async () => {
    const f = mockFetch({ value: [] }, [], 401)
    const { result } = renderHook(
      () => useCourierDms(bob, { fetchImpl: f, webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.mode).toBe('legacy'))
    expect(result.current.courierActive).toBe(false)
    expect(await result.current.send(bob.orbitId, 'nope')).toBeNull()
    expect(result.current.threadFor('x')).toBeNull()
  })

  it('courier mode: send seals to the known peer key; wire has no plaintext', async () => {
    const box: { value: unknown[] } = { value: [] }
    const { result } = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch(box), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.mode).toBe('courier'))
    expect(result.current.courierActive).toBe(true)

    result.current.registerPeerKeys(bob.orbitId, bob.publicKeyHex, bob.encryptionPubHex)
    const msg = await result.current.send(bob.orbitId, 'sealed hello')
    expect(msg?.status).toBe('sent')
    const t = result.current.threadFor(bob.orbitId) || []
    expect(t.some((m) => m.text === 'sealed hello' && m.own && m.status === 'sent')).toBe(true)
    expect(JSON.stringify(box.value)).not.toContain('sealed hello')
  })

  it('unknown peer -> failed LOUD (held locally, not silently lost)', async () => {
    const { result } = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch({ value: [] }), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.courierActive).toBe(true))
    const msg = await result.current.send(bob.orbitId, 'into the void')
    expect(msg?.status).toBe('failed')
    expect((result.current.threadFor(bob.orbitId) || []).some((m) => m.text === 'into the void' && m.status === 'failed')).toBe(true)
  })

  it('inbound sealed DM surfaces in the thread and acks (sender sees delivered)', async () => {
    // --- bob receives alice's dm ---
    const box: { value: unknown[] } = { value: [] }
    const acks: unknown[] = []
    box.value.push(seal1to1(
      encodeDmBody({ id: 'in-7', peerId: bob.orbitId, own: true, text: 'hi bob', ts: 99, status: 'sent' }),
      'mail', alice, bob,
    ))
    const r1 = renderHook(
      () => useCourierDms(bob, { fetchImpl: mockFetch(box, acks), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(r1.result.current.threadFor(alice.orbitId)?.[0]?.text).toBe('hi bob'))
    await waitFor(() => expect(acks).toHaveLength(1))

    // --- alice receives bob's dm_ack for her out message ---
    const box2: { value: unknown[] } = { value: [] }
    const r2 = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch(box2), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(r2.result.current.courierActive).toBe(true))
    r2.result.current.registerPeerKeys(bob.orbitId, bob.publicKeyHex, bob.encryptionPubHex)
    const sent = (await r2.result.current.send(bob.orbitId, 'ping'))!
    expect(sent.status).toBe('sent')
    box2.value.push(seal1to1(JSON.stringify({ t: 'dm_ack', id: sent.id }), 'mail', bob, alice))
    await r2.result.current.pull()
    await waitFor(() => {
      expect(r2.result.current.threadFor(bob.orbitId)?.find((m) => m.id === sent.id)?.status).toBe('delivered')
    })
  })

  it('edit / delete / reaction / receipt all round-trip through the sealed mail path', async () => {
    const box: { value: unknown[] } = { value: [] }
    const acks: unknown[] = []
    const r = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch(box, acks), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(r.result.current.courierActive).toBe(true))
    r.result.current.registerPeerKeys(bob.orbitId, bob.publicKeyHex, bob.encryptionPubHex)

    const sent = (await r.result.current.send(bob.orbitId, 'first draft'))!
    expect(await r.result.current.edit(bob.orbitId, sent.id, 'corrected')).toBe(true)
    await waitFor(() => {
      const m = r.result.current.threadFor(bob.orbitId)?.find((x) => x.id === sent.id)
      expect(m?.text).toBe('corrected')
      expect(m?.editedTs).toBeTruthy()
    })

    expect(await r.result.current.react(bob.orbitId, sent.id, '🔥', true)).toBe(true)
    await waitFor(() => {
      expect(r.result.current.threadFor(bob.orbitId)?.find((x) => x.id === sent.id)?.reactions).toEqual({ '🔥': [alice.orbitId] })
    })

    // Bob reads up to that stamp -> the sender's copy records the watermark.
    box.value.push(seal1to1(JSON.stringify({ t: 'dm_read', id: sent.id, upTo: sent.ts }), 'mail', bob, alice))
    await r.result.current.pull()
    await waitFor(() => {
      expect(r.result.current.threadFor(bob.orbitId)?.find((x) => x.id === sent.id)?.readTs).toBe(sent.ts)
    })

    expect(await r.result.current.remove(bob.orbitId, sent.id)).toBe(true)
    await waitFor(() => {
      const m = r.result.current.threadFor(bob.orbitId)?.find((x) => x.id === sent.id)
      expect(m?.deletedTs).toBeTruthy()
      expect(m?.text).toBe('')
    })
  })

  it('peer typing pings surface, expire, and are cleared by the next message', async () => {
    const box: { value: unknown[] } = { value: [] }
    const r = renderHook(
      () => useCourierDms(bob, { fetchImpl: mockFetch(box), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(r.result.current.courierActive).toBe(true))

    box.value.push(seal1to1(JSON.stringify({ t: 'dm_typing', at: Date.now() }), 'mail', alice, bob))
    await r.result.current.pull()
    await waitFor(() => expect(r.result.current.isTyping(alice.orbitId)).toBe(true))

    box.value.push(seal1to1(
      encodeDmBody({ id: 'after-typing', peerId: bob.orbitId, own: true, text: 'sent it', ts: Date.now(), status: 'sent' }),
      'mail', alice, bob,
    ))
    await r.result.current.pull()
    await waitFor(() => expect(r.result.current.isTyping(alice.orbitId)).toBe(false))
    // Typing never becomes chat history.
    expect(r.result.current.threadFor(alice.orbitId)?.some((m) => m.text === '')).toBe(false)
  })
})
