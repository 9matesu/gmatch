// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { generateIdentity } from '@orbit/crypto'
import { seal1to1, open1to1 } from '@orbit/protocol'
import { useCourierDms } from './useCourierDms'
import { decodeDomBody } from '../utils/dominationMesh'
import { _resetMailModeCache } from '../utils/mail-mode'
import type { MailSocket } from '../utils/mail-client'

const alice = generateIdentity()
const bob = generateIdentity()

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

function mockFetch(box: { value: unknown[] }, pmStatus = 404) {
  return vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.endsWith('/api/pm')) return new Response('{}', { status: pmStatus })
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

describe('useCourierDms mesh domination (Fase 5/6 slice 3)', () => {
  it('meshSend seals a dom_request to the known peer; wire has no plaintext', async () => {
    const box: { value: unknown[] } = { value: [] }
    const { result } = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch(box), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.courierActive).toBe(true))
    expect(result.current.meshPeerKnown(bob.orbitId)).toBe(false)
    result.current.registerPeerKeys(bob.orbitId, bob.publicKeyHex, bob.encryptionPubHex)
    expect(result.current.meshPeerKnown(bob.orbitId)).toBe(true)

    let res: unknown
    await act(async () => {
      res = await result.current.meshSend(bob.orbitId, 'message', { text: 'boo' }, 'Alice')
    })
    expect((res as { ok: boolean }).ok).toBe(true)
    expect(box.value).toHaveLength(1)
    const wire = JSON.stringify(box.value)
    expect(wire).not.toContain('boo')
    expect(wire).not.toContain('dom_request')
    const opened = open1to1(box.value[0] as never, bob.encryptionPrivHex)
    expect(decodeDomBody(opened.body)).toMatchObject({ t: 'dom_request', action: 'message' })
  })

  it('meshSend to unknown peer fails loud with no PUT (sem fetch cego)', async () => {
    const box: { value: unknown[] } = { value: [] }
    const { result } = renderHook(
      () => useCourierDms(alice, { fetchImpl: mockFetch(box), webSocketFactory: () => new FakeSocket() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.courierActive).toBe(true))
    let res: unknown
    await act(async () => {
      res = await result.current.meshSend('stranger-9', 'message', {}, 'Alice')
    })
    expect(res).toEqual({ ok: false, reason: 'no-keys' })
    expect(box.value).toHaveLength(0)
  })

  it('inbound consented dom_request fires onDomEffect + landed receipt', async () => {
    const box: { value: unknown[] } = { value: [] }
    box.value.push(seal1to1(
      JSON.stringify({ t: 'dom_request', id: 'dom-in-1', action: 'message', payload: { text: 'hi' } }),
      'mail', bob, alice,
    ))
    const onDomEffect = vi.fn()
    const { result } = renderHook(
      () => useCourierDms(alice, {
        fetchImpl: mockFetch(box),
        webSocketFactory: () => new FakeSocket(),
        dominationConsent: (a) => a === 'message',
        onDomEffect,
      }),
      { wrapper },
    )
    await waitFor(() => expect(onDomEffect).toHaveBeenCalledWith('message', bob.orbitId, undefined))
    // Receipt sealed back onto the wire.
    await waitFor(() => expect(box.value.length).toBeGreaterThan(1))
    const receiptEnv = box.value[box.value.length - 1] as never
    const opened = open1to1(receiptEnv, bob.encryptionPrivHex)
    expect(decodeDomBody(opened.body)).toEqual({ t: 'dom_receipt', id: 'dom-in-1', status: 'landed' })
    expect(result.current.courierActive).toBe(true)
  })

  it('inbound non-consented action is declined, no effect (closed by default)', async () => {
    const box: { value: unknown[] } = { value: [] }
    box.value.push(seal1to1(
      JSON.stringify({ t: 'dom_request', id: 'dom-in-2', action: 'blur' }),
      'mail', bob, alice,
    ))
    const onDomEffect = vi.fn()
    renderHook(
      () => useCourierDms(alice, {
        fetchImpl: mockFetch(box),
        webSocketFactory: () => new FakeSocket(),
        onDomEffect,
      }),
      { wrapper },
    )
    await waitFor(() => expect(box.value.length).toBeGreaterThan(1))
    expect(onDomEffect).not.toHaveBeenCalled()
    const receiptEnv = box.value[box.value.length - 1] as never
    const opened = open1to1(receiptEnv, bob.encryptionPrivHex)
    expect(decodeDomBody(opened.body)).toEqual({ t: 'dom_receipt', id: 'dom-in-2', status: 'declined' })
  })

  it('mesh camera decision approved seals a landed receipt for the request id', async () => {
    const box: { value: unknown[] } = { value: [] }
    box.value.push(seal1to1(
      JSON.stringify({ t: 'dom_request', id: 'dom-cam-9', action: 'camera' }),
      'mail', bob, alice,
    ))
    const onDomEffect = vi.fn()
    renderHook(
      () => useCourierDms(alice, {
        fetchImpl: mockFetch(box),
        webSocketFactory: () => new FakeSocket(),
        dominationConsent: (a) => a === 'camera',
        onDomEffect,
      }),
      { wrapper },
    )
    await waitFor(() => expect(onDomEffect).toHaveBeenCalledWith('camera', bob.orbitId, undefined))
    // Live approval pending: no receipt yet.
    await new Promise((r) => setTimeout(r, 50))
    expect(box.value).toHaveLength(1)
    act(() => {
      window.dispatchEvent(new CustomEvent('gmatch:domination-camera-decision', {
        detail: { id: 'dom-cam-9', approved: true },
      }))
    })
    await waitFor(() => expect(box.value.length).toBeGreaterThan(1))
    const receiptEnv = box.value[box.value.length - 1] as never
    const opened = open1to1(receiptEnv, bob.encryptionPrivHex)
    expect(decodeDomBody(opened.body)).toEqual({ t: 'dom_receipt', id: 'dom-cam-9', status: 'landed' })
  })
})
