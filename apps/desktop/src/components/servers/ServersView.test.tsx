// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ServersView } from './ServersView'

type FetchCall = { url: string; init?: RequestInit }
let calls: FetchCall[] = []

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as unknown as typeof fetch)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

import { generateIdentity } from '@orbit/crypto'
const real = generateIdentity()
const identity = { ...real, orbitId: 'gmatch_' + real.publicKeyHex.slice(0, 56), displayName: 'Me' } as never

// This jsdom build does not expose localStorage — stub it explicitly.
function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage)
}

beforeEach(() => {
  delete (window as unknown as { gmatch?: unknown }).gmatch
  stubLocalStorage({ 'gmatch.central.url': 'https://central.test' })
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ServersView', () => {
  it('lists public servers with online dots and password lock marker', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [{ id: 'abcdef12', display_name: 'Alice', online: true }], posts_24h: 3, members_total: 9 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'aaa', name: 'Friend World', description: 'chill', owner_id: 'owner1', password_required: 1, endpoint_hint: '192.168.0.9:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Friend World')).toBeInTheDocument())
    expect(screen.getByText('chill')).toBeInTheDocument()
    // password_required => visible lock marker
    expect(screen.getByLabelText('password required')).toBeInTheDocument()
    // dashboard section present with the central node userlist
    expect(await screen.findByText('Alice')).toBeInTheDocument()
  })

  it('register form posts name and shows created server', async () => {
    let created = false
    mockFetch(async (url, init) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers') && init?.method === 'POST') {
        created = true
        return json({ server: { id: 'bbb', name: 'My Realm', owner_id: (identity as unknown as { orbitId: string }).orbitId, password_required: 0, endpoint_hint: '' } }, 201)
      }
      return json({ servers: created ? [{ id: 'bbb', name: 'My Realm', owner_id: (identity as unknown as { orbitId: string }).orbitId, password_required: 0, endpoint_hint: '' }] : [] })
    })
    const toasts: string[] = []
    render(<ServersView identity={identity} toast={(m) => toasts.push(m)} />)
    fireEvent.click(screen.getByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'My Realm' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => {
      if (!screen.queryByText('My Realm')) throw new Error('calls=' + JSON.stringify(calls.map((c) => [c.url.slice(8), c.init?.method || '-'])) + ' toasts=' + JSON.stringify(toasts))
    }, { timeout: 1500 })
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post?.url).toContain('central.test/api/servers')
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: 'My Realm' })
  })

  it('join sets the node URL for the session and asks for restart when packaged', async () => {
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet: vi.fn().mockResolvedValue({ ok: true }),
      serverRelaunch: vi.fn().mockResolvedValue(undefined),
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'ccc', name: 'Open World', description: '', owner_id: 'owner2', password_required: 0, endpoint_hint: 'https://world.test:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    const joinBtn = await screen.findByRole('button', { name: /join/i })
    fireEvent.click(joinBtn)
    await waitFor(() => expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet)
      .toHaveBeenCalledWith({ mode: 'client', url: 'https://world.test:8790' }))
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('without a configured central, explains instead of crashing', async () => {
    stubLocalStorage({ 'gmatch.central.url': 'none' })
    mockFetch(async () => json({ servers: [] }))
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no central/i)).toBeInTheDocument())
  })

  it('password-protected server prompts and stores the join handoff', async () => {
    const KEY = ['gmatch', 'server', 'join'].join('.')
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test' })
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      serverSet: vi.fn().mockResolvedValue({ ok: true }),
      serverRelaunch: vi.fn().mockResolvedValue(undefined),
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    vi.spyOn(window, 'prompt').mockReturnValue('s3cret')
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'ddd', name: 'Locked World', description: '', owner_id: 'owner3', password_required: 1, endpoint_hint: 'https://locked.test:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    const joinBtn = await screen.findByRole('button', { name: /join/i })
    fireEvent.click(joinBtn)
    await waitFor(() => expect(window.prompt).toHaveBeenCalled())
    await waitFor(() => expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet)
      .toHaveBeenCalledWith({ mode: 'client', url: 'https://locked.test:8790' }))
    // one-shot handoff persisted locally for the post-restart verify
    const raw = localStorage.getItem(KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).password).toBe('s3cret')
    delete (window as unknown as { gmatch?: unknown }).gmatch
    vi.restoreAllMocks()
  })
})