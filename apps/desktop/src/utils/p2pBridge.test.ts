// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { fetchP2pStatus, sendP2pFrame, subscribeP2pFrames } from './p2pBridge'
import { useP2PNode } from '../hooks/useP2PNode'

const frame = {
  binding: { orbitId: 'o', orbitPubkeyHex: 'p', peerId: 'q', sigHex: 's' },
  envelope: { v: 2 as const, kind: 'mail', to: 't', id: 'i', sealed: 'c2VhbGVk' },
  peerId: 'q',
  transport: '/ip4/127.0.0.1/tcp/1',
}

beforeEach(() => {
  try {
    delete (window as { gmatch?: unknown }).gmatch
  } catch {
    /* */
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('p2pBridge', () => {
  it('reads as not-started with no bridge, and send fails loudly', async () => {
    expect(await fetchP2pStatus()).toEqual({ started: false })
    expect(await sendP2pFrame('p', {}, {})).toEqual({ ok: false, error: 'no p2p bridge' })
    expect(subscribeP2pFrames(() => {})).toBeTypeOf('function')
  })

  it('passes status/send through and delivers subscribed frames', async () => {
    let fire: (f: typeof frame) => void = () => {}
    let fired = false
    Object.defineProperty(window, 'gmatch', {
      configurable: true,
      value: {
        p2pStatus: async () => ({ started: true, peerId: '12D3KooWMe', addrs: [], peers: [] }),
        p2pSend: async () => ({ ok: true }),
        onP2pMessage: (c: (f: typeof frame) => void) => {
          fire = c
          fired = true
          return () => { fired = false }
        },
      },
    })
    expect(await fetchP2pStatus()).toMatchObject({ started: true, peerId: '12D3KooWMe' })
    expect(await sendP2pFrame('peer', { b: 1 }, { e: 2 })).toEqual({ ok: true })
    const seen: typeof frame[] = []
    const off = subscribeP2pFrames((f) => seen.push(f))
    expect(fired).toBe(true)
    fire(frame)
    expect(seen).toEqual([frame])
    off()
  })
})

describe('useP2PNode', () => {
  it('loads status and collects inbound frames', async () => {
    let fire: (f: typeof frame) => void = () => {}
    Object.defineProperty(window, 'gmatch', {
      configurable: true,
      value: {
        p2pStatus: async () => ({ started: true, peerId: '12D3KooWMe', addrs: [], peers: [] }),
        onP2pMessage: (c: (f: typeof frame) => void) => {
          fire = c
          return () => {}
        },
      },
    })
    const { result } = renderHook(() => useP2PNode())
    await waitFor(() => expect(result.current.status.started).toBe(true))
    act(() => { fire(frame) })
    expect(result.current.frames).toEqual([frame])
  })
})
