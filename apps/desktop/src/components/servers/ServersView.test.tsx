// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
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

import { _resetResponseCache } from '../../utils/api'

beforeEach(() => {
  _resetResponseCache()
  delete (window as unknown as { gmatch?: unknown }).gmatch
  stubLocalStorage({ 'gmatch.central.url': 'https://central.test' })
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ServersView', () => {
  it('lists public servers with plain counts and password lock marker', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [{ id: 'abcdef12', display_name: 'Alice', online: true }], posts_24h: 3, members_total: 9 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'aaa', name: 'Friend World', description: 'chill', owner_id: 'owner1', owner_name: 'Alice', password_required: 1, endpoint_hint: '192.168.0.9:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Friend World')).toBeInTheDocument())
    // create-node cycle: the row shows the shareable HANDLE, never an address
    // or the admin's name.
    expect(screen.queryByText('by Alice')).not.toBeInTheDocument()
    expect(screen.queryByText(/192\.168/)).not.toBeInTheDocument()
    expect(screen.getByTitle('Copy node code')).toBeInTheDocument()
    expect(screen.getByText('chill')).toBeInTheDocument()
    // password_required => visible lock marker
    expect(screen.getByLabelText('password required')).toBeInTheDocument()
    // browse view keeps no presence chrome: no Manage Hub, no Online pills.
    expect(screen.queryByRole('button', { name: /manage hub/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /online \(/i })).toBeNull()
    // dashboard userlist lives on the hub: open it to find Alice.
    fireEvent.click(screen.getByRole('button', { name: /my server \/ hub/i }))
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    // hero is ONE row: counts live under the name, not in a duplicate header
    expect(await screen.findByText('9 members · 3 posts/24h')).toBeInTheDocument()
    expect(screen.queryByText('This server')).not.toBeInTheDocument()
  })

  it('renders the directory as a gallery-style browser list with count', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 's1', name: 'Alpha Node', description: 'desc1', owner_id: 'o1', password_required: 0, endpoint_hint: '1.2.3.4:8790' },
        { id: 's2', name: 'Beta Node', description: 'desc2', owner_id: 'o2', password_required: 1, endpoint_hint: '5.6.7.8:8790' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Alpha Node')).toBeInTheDocument())
    expect(screen.getByText(/server browser \(2\)/i)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBe(2)
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

  it('create while connected to central hosts locally: switches + relaunches, claim survives restart', async () => {
    const HOST_KEY = ['gmatch', 'server', 'host'].join('.')
    const serverSet = vi.fn().mockResolvedValue({ ok: true })
    const serverRelaunch = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet,
      serverRelaunch,
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'client', url: 'https://central.test', lanUrls: ['http://192.168.0.42:8790'] }),
    }
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    mockFetch(async (url, init) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers') && init?.method === 'POST') {
        return json({ server: { id: 'b'.repeat(64), name: 'My Realm', owner_id: ownId, password_required: 0, endpoint_hint: '' } }, 201)
      }
      return json({ servers: [] })
    })
    const toasts: string[] = []
    render(<ServersView identity={identity} toast={(m) => toasts.push(m)} />)
    fireEvent.click(await screen.findByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'My Realm' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(serverSet).toHaveBeenCalledWith({ mode: 'host', url: '' }))
    expect(serverRelaunch).toHaveBeenCalled()
    // one-shot claim carried across the restart (name + directory linkage)
    const raw = localStorage.getItem(HOST_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toMatchObject({ name: 'My Realm', directoryId: 'b'.repeat(64) })
    // heartbeat replay payload saved; LAN hint auto-filled
    expect(JSON.parse(localStorage.getItem('gmatch.server.register') || '{}')).toMatchObject({
      name: 'My Realm', endpoint_hint: 'http://192.168.0.42:8790',
    })
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('create on a fresh host claims the local node immediately, including the join password', async () => {
    const serverRelaunch = vi.fn()
    const serverSet = vi.fn()
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet,
      serverRelaunch,
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    mockFetch(async (url, init) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'gmatch', users: [], posts_24h: 0, members_total: 1 })
      if (url.includes('/api/servers/node')) {
        if (init?.method === 'PATCH') return json({ server: { name: 'My Realm', description: '', directoryId: 'c'.repeat(64), isAdmin: true } })
        return json({ name: 'gmatch', description: '', directoryId: null, isAdmin: true })
      }
      if (url.includes('/api/server/password') && init?.method === 'POST') return json({ enabled: true })
      if (url.includes('/api/servers') && init?.method === 'POST') {
        return json({ server: { id: 'c'.repeat(64), name: 'My Realm', owner_id: ownId, password_required: 1, endpoint_hint: '' } }, 201)
      }
      return json({ servers: [] })
    })
    const toasts: string[] = []
    render(<ServersView identity={identity} toast={(m) => toasts.push(m)} />)
    fireEvent.click(await screen.findByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'My Realm' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /join password/i }))
    fireEvent.change(screen.getByLabelText(/server join password/i), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(toasts.join('|')).toMatch(/admin/i))
    const patch = calls.find((c) => c.url.includes('/api/servers/node') && c.init?.method === 'PATCH')
    expect(patch).toBeTruthy()
    expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ name: 'My Realm', directory_id: 'c'.repeat(64) })
    const pw = calls.find((c) => c.url.includes('/api/server/password'))
    expect(JSON.parse(String(pw?.init?.body))).toMatchObject({ password: 'secret' })
    // no restart needed when already hosting
    expect(serverRelaunch).not.toHaveBeenCalled()
    expect(serverSet).not.toHaveBeenCalled()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('second create on a hosting install is blocked in favor of rename', async () => {
    stubLocalStorage({
      'gmatch.central.url': 'https://central.test',
      'gmatch.server.register': JSON.stringify({ name: 'My Realm' }),
    })
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet: vi.fn(),
      serverRelaunch: vi.fn(),
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 1 })
      return json({ servers: [] })
    })
    const toasts: string[] = []
    render(<ServersView identity={identity} toast={(m) => toasts.push(m)} />)
    fireEvent.click(await screen.findByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'Second Server' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(toasts.join('|')).toMatch(/already hosts/i))
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
    expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet).not.toHaveBeenCalled()
    delete (window as unknown as { gmatch?: unknown }).gmatch
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
    // Join passwords now go through the in-app PromptDialog (Electron has no
    // window.prompt): type it and submit.
    const pwInput = await screen.findByRole('textbox', { name: 'Server password' })
    fireEvent.change(pwInput, { target: { value: 's3cret' } })
    fireEvent.keyDown(pwInput, { key: 'Enter' })
    await waitFor(() => expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet)
      .toHaveBeenCalledWith({ mode: 'client', url: 'https://locked.test:8790' }))
    // one-shot handoff persisted locally for the post-restart verify
    const raw = localStorage.getItem(KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).password).toBe('s3cret')
    delete (window as unknown as { gmatch?: unknown }).gmatch
    vi.restoreAllMocks()
  })

  it('allows switching between online and 24h tabs and clicking user card opens profile', async () => {
    const orbitApi = await import('../../utils/api')
    const spy = vi.spyOn(orbitApi, 'orbitFetch').mockImplementation(async (endpoint: string) => {
      if (String(endpoint).includes('/api/servers/dashboard')) {
        return json({
          name: 'hub',
          users: [
            { id: 'usr_on', display_name: 'BobOnline', online: true, last_seen: new Date().toISOString() },
            { id: 'usr_off', display_name: 'CarolRecent', online: false, last_seen: new Date(Date.now() - 3600000).toISOString() },
          ],
          posts_24h: 5,
          members_total: 12,
        })
      }
      if (String(endpoint).includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    const onSelectUser = vi.fn()
    render(<ServersView identity={identity} toast={() => {}} onSelectUser={onSelectUser} />)

    // Browse view keeps no presence chrome: no Manage Hub, no Online pills.
    expect(await screen.findByText('Server browser (0)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /manage hub/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /online \(/i })).toBeNull()

    // Hub members section owns presence: switch to the hub tab first.
    fireEvent.click(screen.getByRole('button', { name: /my server \/ hub/i }))
    // Online tab is default: BobOnline is visible, CarolRecent is hidden
    expect(await screen.findByText('BobOnline', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('CarolRecent')).toBeNull()

    // Switch to Last 24h tab: CarolRecent is visible too
    fireEvent.click(screen.getByRole('button', { name: /last 24h/i }))
    expect(await screen.findByText('CarolRecent')).toBeInTheDocument()

    // Click Bob's card: triggers onSelectUser
    fireEvent.click(screen.getByText('BobOnline'))
    expect(onSelectUser).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'BobOnline' }))
    spy.mockRestore()
  })

  it('central admin door renders in client mode too (panel self-gates)', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'hub', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers/node')) return json({ name: 'hub', description: '', isAdmin: false })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('Server browser (0)')
    // The button no longer pre-gates on node.isAdmin: the user's .exe is the
    // central admin. CentralAdminPanel itself refuses until the PIN unlocks.
    expect(screen.getByRole('button', { name: /central admin/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Central admin login')).not.toBeInTheDocument()
  })

  it('anonymous browser fetches directory only, never dashboard/node', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 's1', name: 'Alpha Node', description: '', owner_id: 'o1', password_required: 0, endpoint_hint: '' },
      ] })
      return json({})
    })
    render(<ServersView identity={null as never} toast={() => {}} />)
    await screen.findByText('Alpha Node')
    expect(screen.getByText(/server browser \(1\)/i)).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/api/servers/dashboard'))).toBe(false)
    expect(calls.some((c) => c.url.includes('/api/servers/node'))).toBe(false)
  })

  it('create drawer previews the node handle before creating and offers a private toggle', async () => {
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'https://central.test', lanUrls: ['http://192.168.0.42:8790'], adminPin: 'abcd1234' }),
      serverSet: async () => ({ ok: true }),
      serverRelaunch: () => {},
    }
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [], posts_24h: 0, members_total: 0 })
      return json({ servers: [] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/^Server name$/), { target: { value: 'My Realm' } })
    const preview = await screen.findByTestId('create-handle-preview')
    expect(preview.textContent).toContain('gmatch://node/')
    // the LAN IP lives only inside the opaque code, never rendered as text
    expect(preview.textContent).not.toMatch(/192\.168/)
    expect(screen.getByLabelText(/Private server/i)).toBeInTheDocument()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('create with Private checked sends private:true and stores it for the heartbeat', async () => {
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test' })
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'https://central.test', lanUrls: ['http://192.168.0.42:8790'] }),
      serverSet: async () => ({ ok: true }),
      serverRelaunch: () => {},
    }
    mockFetch(async (url, init) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers') && init?.method === 'POST') {
        return json({ server: { id: 'p'.repeat(64), name: 'My Realm', owner_id: ownId, password_required: 0, is_private: 1, endpoint_hint: '' } }, 201)
      }
      return json({ servers: [] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /create server/i }))
    fireEvent.change(screen.getByLabelText(/^Server name$/), { target: { value: 'My Realm' } })
    fireEvent.click(screen.getByLabelText(/Private server/i))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === 'POST')
      expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: 'My Realm', private: true })
    })
    expect(JSON.parse(localStorage.getItem('gmatch.server.register') || '{}')).toMatchObject({ private: true })
  })

  it('unregistering my server clears the host claim so create works again', async () => {
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    stubLocalStorage({
      'gmatch.central.url': 'https://central.test',
      'gmatch.server.register': JSON.stringify({ name: 'My Realm', private: false }),
      'gmatch.server.directoryId': 'bbb',
    })
    ;(window as unknown as { confirm: () => boolean }).confirm = () => true
    mockFetch(async (url, init) => {
      if (init?.method === 'DELETE' && url.includes('/api/servers/bbb')) return json({ ok: true })
      if (url.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 1 })
      if (url.includes('/api/servers/node')) return json({ name: 'My Realm', description: '', isAdmin: true })
      return json({ servers: [{ id: 'bbb', name: 'My Realm', owner_id: ownId, password_required: 0, endpoint_hint: '10.0.0.1:8790' }] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    fireEvent.click(await screen.findByText('unregister'))
    await waitFor(() => expect(localStorage.getItem('gmatch.server.register')).toBeNull())
    expect(localStorage.getItem('gmatch.server.directoryId')).toBeNull()
  })

  it('my directory row gets rename / make private / switch controls', async () => {
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers/node')) return json({ name: 'n', description: '', isAdmin: true })
      return json({ servers: [{ id: 'bbb', name: 'My Realm', owner_id: ownId, password_required: 0, is_private: 0, endpoint_hint: 'my.host:8790' }] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    expect(await screen.findByText('Make private')).toBeInTheDocument()
    // the button row per owner row: rename + switch sit next to share/unregister
    expect(within(screen.getByRole('listitem')).getAllByRole('button').length).toBeGreaterThanOrEqual(4)
  })

  it('shows the admin passcode once on first host login and never again after dismiss', async () => {
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [], adminPin: 'beefcafe' }),
    }
    // orbitFetch's 3s GET cache would leak a prior test's isAdmin:false —
    // bypass it with a direct spy (same idiom as the tabs test above).
    const orbitApi = await import('../../utils/api')
    const spy = vi.spyOn(orbitApi, 'orbitFetch').mockImplementation(async (endpoint: string, _init?: RequestInit) => {
      const e = String(endpoint)
      if (e.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 1 })
      if (e.includes('/api/servers/node')) return json({ name: 'My Realm', description: '', isAdmin: true })
      return json({ servers: [] })
    })
    const { unmount } = render(<ServersView identity={identity} toast={() => {}} />)
    const banner = await screen.findByTestId('admin-pin-banner')
    expect(banner.textContent).toContain('beefcafe')
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(screen.queryByTestId('admin-pin-banner')).toBeNull()
    unmount()
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('Server browser (0)')
    expect(screen.queryByTestId('admin-pin-banner')).toBeNull()
    spy.mockRestore()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('collapses the search/filter band and remembers it across a reload', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 's1', name: 'Alpha Node', description: '', owner_id: 'o1', password_required: 0, endpoint_hint: '' },
      ] })
      return json({})
    })
    const { unmount } = render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('Alpha Node')
    // band starts open: the search field is on screen
    expect(screen.getByLabelText('Search servers')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /hide filters/i }))
    expect(screen.queryByLabelText('Search servers')).toBeNull()
    // hiding the band never hides the directory itself
    expect(screen.getByText(/server browser \(1\)/i)).toBeInTheDocument()
    unmount()
    // the choice survives a reload
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText(/server browser \(1\)/i)
    expect(screen.queryByLabelText('Search servers')).toBeNull()
  })
})