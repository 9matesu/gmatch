// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import type { User } from '@orbit/shared'
import {
  EXTRA_RELAY_CONNECT_TIMEOUT_MS,
  MAX_EXTRA_RELAY_NODES,
  useP2P,
} from './useP2P'
import { _resetPeerNodes, rememberKnownNode, rememberPeerNode } from '../utils/peerNodes'
import { sendSwarmFrame } from '../utils/p2pSwarm'

/**
 * Two nodes, fake clock: the extra relay sockets are a bounded, TRUSTED
 * transport — not a wildcard fan-out. A beacon's self-declared URL is a routing
 * hint only; a hostile node's `relayedBy` stamp is never proof of who sent a
 * frame. The whole hook is mounted so this exercises the real socket wiring.
 */
const OWN = 'http://127.0.0.1:8790'
const NODE_B = 'http://26.0.0.9:8790'
const NODE_C = 'http://192.168.1.20:8790'
const NODE_D = 'http://26.0.0.10:8790'

vi.mock('./useSettings', () => ({
  readSettings: () => ({ meshEnabled: false, meshCommunityKey: '' }),
}))

vi.mock('../services/courierPresence', () => ({
  broadcastPresence: vi.fn(async () => true),
  fetchPresenceRosterFrom: vi.fn(async () => ({ users: [], nodeById: new Map<string, string>() })),
}))

vi.mock('../utils/p2pSwarm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/p2pSwarm')>()
  return {
    ...actual,
    handleSwarmMessage: vi.fn(),
    hydrateLocalObjects: vi.fn(async () => 0),
    hydrateDurableReplications: vi.fn(async () => 0),
    announceHeldObjects: vi.fn(),
    announcePeerOnline: vi.fn(),
    setSwarmReceiptIdentity: vi.fn(),
    setSwarmOperationHandler: vi.fn(),
    setSwarmOperationAckHandler: vi.fn(),
  }
})

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []
  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  bufferedAmount = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this) }
  send(data: string) { this.sent.push(String(data)) }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.() }
}

class FakeBroadcastChannel {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
}

const PEERS: User[] = ['p1', 'p2', 'p3'].map((id) => ({
  id,
  publicKey: `pk-${id}`,
  encryptionPubKey: `ek-${id}`,
  createdAt: '',
  online: true,
} as User))

function parseFrames(ws: FakeWebSocket): any[] {
  return ws.sent
    .filter((s) => s.includes('SWARM_FRAME'))
    .map((s) => JSON.parse(s))
}

describe('useP2P cross-node relay sockets (two nodes, fake clock)', () => {
  let identity: ReturnType<typeof generateIdentity>

  beforeEach(() => {
    vi.useFakeTimers()
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage)
    FakeWebSocket.instances = []
    identity = generateIdentity()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = String(url).includes('/api/users/online')
        ? { users: PEERS }
        : String(url).includes('/api/health')
          ? { mode: 'host' }
          : String(url).includes('/api/lobby/chat')
            ? { messages: [] }
            : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    _resetPeerNodes()
    localStorage.setItem('gmatch.api.url', OWN)
    // Directory-published / user-chosen nodes: the ONLY legal relay targets.
    rememberKnownNode(NODE_B)
    rememberKnownNode(NODE_C)
    rememberKnownNode(NODE_D)
    // Signed beacon claims (routing hints, never relay destinations).
    rememberPeerNode('p1', NODE_B)
    rememberPeerNode('p2', NODE_C)
    rememberPeerNode('p3', NODE_D)
    rememberPeerNode('liar', 'http://attacker.test:8790')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function mount() {
    const hook = renderHook(() => useP2P(identity as any))
    // Let the roster fetch + dynamic transport imports settle inside act so
    // their state updates do not leak into the assertions below.
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    return hook
  }

  function extras(): FakeWebSocket[] {
    return FakeWebSocket.instances.filter((ws) => ws.url.includes('/api/ws') && !ws.url.includes('127.0.0.1'))
  }

  it('never opens a socket for a beacon-only URL and caps extras at two', async () => {
    await mount()
    expect(extras()).toHaveLength(MAX_EXTRA_RELAY_NODES)
    expect(extras().map((ws) => ws.url)).toContain(wsUrl(NODE_B))
    expect(extras().map((ws) => ws.url)).toContain(wsUrl(NODE_C))
    expect(extras().map((ws) => ws.url)).not.toContain('ws://attacker.test:8790/api/ws')
  })

  it('a CONNECTING socket does not hold its slot forever', async () => {
    await mount()
    const first = extras()
    expect(first).toHaveLength(2)
    await act(async () => { vi.advanceTimersByTime(EXTRA_RELAY_CONNECT_TIMEOUT_MS) })
    expect(first.every((ws) => ws.readyState === FakeWebSocket.CLOSED)).toBe(true)
    // A fresh roster round reconciles and reopens the still-wanted nodes; the
    // ceiling holds instead of accumulating dead sockets.
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(extras().filter((ws) => ws.readyState !== FakeWebSocket.CLOSED)).toHaveLength(2)
    expect(extras().length).toBeGreaterThan(2)
  })

  it('sends a reply only to the node that requested the transfer', async () => {
    await mount()
    const b = extras().find((ws) => ws.url === wsUrl(NODE_B))!
    const c = extras().find((ws) => ws.url === wsUrl(NODE_C))!
    const home = FakeWebSocket.instances.find((ws) => ws.url === wsUrl(OWN))!
    b.open(); c.open(); home.open()

    await act(async () => {
      b.onmessage?.({ data: JSON.stringify({
        type: 'SWARM_FRAME',
        relayedBy: 'forged',
        swarm: { type: 'SWARM_WANT', id: 'obj-1', transferId: 'transfer-b', offerPub: 'a'.repeat(64), from: 'p1' },
      }) })
    })
    await act(async () => {
      sendSwarmFrame({
        type: 'SWARM_CHUNK', id: 'obj-1', index: 0, total: 1,
        mimeType: 'image/jpeg', dataBase64: 'AA==', transferId: 'transfer-b',
      })
    })

    // Other frames (signed ops, presence) legitimately use the home relay;
    // only the CHUNK answering node B's WANT must not be copied to anyone else.
    const transferFrames = (ws: FakeWebSocket) =>
      parseFrames(ws).filter((f) => f.swarm?.transferId === 'transfer-b')
    expect(transferFrames(b)).toHaveLength(1)
    expect(transferFrames(c)).toHaveLength(0)
    expect(transferFrames(home)).toHaveLength(0)
  })

  it('discards a hostile relayedBy stamp on an extra socket', async () => {
    const { result } = await mount()
    const b = extras().find((ws) => ws.url === wsUrl(NODE_B))!
    b.open()
    await act(async () => {
      b.onmessage?.({ data: JSON.stringify({
        type: 'SWARM_FRAME',
        relayedBy: 'victim', // stamped by the OTHER node, never trusted
        swarm: {
          type: 'IMAGE_ANNOUNCE',
          user: { id: 'p1', publicKey: 'pk-p1', createdAt: '' },
          timestamp: 1,
          payload: { id: 'obj-2', owner_id: 'victim', size_bytes: 1, mime_type: 'image/jpeg', created_at: '' },
        },
      }) })
    })
    const item = result.current.p2pItems.find((i) => i.id === 'obj-2')
    expect(item).toBeDefined()
    // The stolen name never becomes a verified owner: the only proven sender
    // is the self-described peer on the extra socket.
    expect((item as any).owner_verified).toBe(false)
  })

  it('reconciles after onclose instead of leaving a dead slot', async () => {
    await mount()
    const b = extras().find((ws) => ws.url === wsUrl(NODE_B))!
    b.close()
    expect(FakeWebSocket.instances.filter((ws) => ws.url === wsUrl(NODE_B))).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(60_000) })
    const bSockets = FakeWebSocket.instances.filter((ws) => ws.url === wsUrl(NODE_B))
    expect(bSockets).toHaveLength(2)
    expect(bSockets[1].readyState).toBe(FakeWebSocket.CONNECTING)
  })
})

function wsUrl(base: string): string {
  return `${base.replace(/^http/, 'ws')}/api/ws`
}
