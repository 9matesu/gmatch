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

/** Add server is the single door; hosting is one step inside it. */
async function openHostForm() {
  fireEvent.click(screen.getAllByRole('button', { name: /add server/i })[0])
  fireEvent.click(await screen.findByRole('button', { name: /host a server/i }))
}

async function openJoinForm() {
  fireEvent.click(screen.getAllByRole('button', { name: /add server/i })[0])
  fireEvent.click(await screen.findByRole('button', { name: /join with code/i }))
}

/** The row's own click target (the ⋯ button is a sibling, never nested). */
const rowOf = (text: string) => screen.getAllByRole('listitem').find((el) => el.textContent?.includes(text))!

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
  vi.restoreAllMocks()
})

describe('ServersView', () => {
  it('renders a single server list: name, quiet meta, lock marker, no address', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'central', users: [{ id: 'abcdef12', display_name: 'Alice', online: true }], posts_24h: 3, members_total: 9 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'aaa', name: 'Friend World', description: 'chill', owner_id: 'owner1', owner_name: 'Alice', password_required: 1, endpoint_hint: '192.168.0.9:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Friend World')).toBeInTheDocument())

    // one page, one list, one title: no sections, no counts line, no anchor card
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Servers')
    expect(screen.queryByRole('heading', { name: /destinations/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /hosted servers/i })).toBeNull()
    expect(screen.queryByLabelText('Current world')).toBeNull()
    expect(screen.getByRole('list', { name: 'Servers' })).toBeInTheDocument()

    // privacy: no raw address, no admin name, ever
    expect(screen.queryByText('by Alice')).not.toBeInTheDocument()
    expect(screen.queryByText(/192\.168/)).not.toBeInTheDocument()
    expect(screen.queryByText(/192\.168/)).not.toBeInTheDocument()

    // the description is the secondary line; the copy action lives in the menu
    expect(screen.getByText(/chill/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /more actions for friend world/i }))
    expect(screen.getByTitle('Copy node code')).toBeInTheDocument()

    // password_required => visible lock marker
    expect(screen.getByLabelText('password required')).toBeInTheDocument()
    // browse keeps no presence chrome: no Manage Hub, no Online pills.
    expect(screen.queryByRole('button', { name: /manage hub/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /online \(/i })).toBeNull()
  })

  it('keeps one row per server and never duplicates the same address', async () => {
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test', 'gmatch.api.url': 'https://world.test:8790' })
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 2 })
      if (url.includes('/api/servers/node')) return json({ name: 'My Realm', description: '', isAdmin: true })
      if (url.includes('/api/servers')) return json({ servers: [
        // the node on this machine, listed twice under two directory ids
        { id: 'reg1', name: 'My Realm', owner_id: ownId, password_required: 0, endpoint_hint: 'https://world.test:8790', last_seen: '2026-01-01' },
        { id: 'reg2', name: 'My Realm', owner_id: ownId, password_required: 0, endpoint_hint: 'http://world.test:8790/', last_seen: '2026-01-02' },
        // a different server that happens to share the display name
        { id: 'other', name: 'My Realm', owner_id: 'someone', password_required: 0, endpoint_hint: 'https://other.test:8790', last_seen: '2026-01-01' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText(/other\.test:8790/)
    const rows = screen.getAllByRole('listitem')
    // current node (2 records collapsed) + the namesake on another address +
    // gMatch Central (configured hub) + the built-in public world
    expect(rows).toHaveLength(4)
    expect(screen.getAllByText('My Realm')).toHaveLength(2)
  })

  it('makes the active server one inert current row, never a separate card', async () => {
    const serverSet = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet, serverRelaunch: vi.fn(),
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'client', url: 'https://world.test:8790', lanUrls: [] }),
    }
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test', 'gmatch.api.url': 'https://world.test:8790' })
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'Open World', users: [{ id: 'u1', display_name: 'Ann', online: true }], posts_24h: 0, members_total: 4 })
      if (url.includes('/api/servers/node')) return json({ name: 'Open World', description: '', isAdmin: true })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'ccc', name: 'Open World', description: '', owner_id: 'owner2', password_required: 0, endpoint_hint: 'https://world.test:8790', last_seen: 'x' },
        { id: 'ddd', name: 'Elsewhere', description: '', owner_id: 'owner3', password_required: 0, endpoint_hint: 'https://elsewhere.test:8790', last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    const active = await screen.findByLabelText('Open World, current server')
    const activeRow = active.closest('li')!
    expect(within(activeRow).getByText('Current')).toBeInTheDocument()
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    expect(within(activeRow).getByText('1 / 4')).toBeInTheDocument()

    // clicking the active row must not reconnect...
    fireEvent.click(active)
    expect(serverSet).not.toHaveBeenCalled()
    // ...and the active server lives once, in its normal position
    expect(screen.getAllByText('Open World')).toHaveLength(1)

    // the drill-in to the node dashboard is a secondary action
    fireEvent.click(within(activeRow).getByRole('button', { name: /more actions/i }))
    fireEvent.click(await within(activeRow).findByText('Open dashboard'))
    expect(await screen.findByLabelText('Current server hub')).toBeInTheDocument()
    expect(await screen.findByText('Ann')).toBeInTheDocument()
    expect(await screen.findByText('4 members · 0 posts/24h')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hub')
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('does not present relay-only infrastructure as a server', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    // the courier is a directory, not a destination: no row, no transport chip
    expect(screen.queryByText(/gMatch Central \(p2p\)/i)).toBeNull()
    expect(screen.queryByText('Relay')).toBeNull()
    expect(screen.queryByText(/relay transport/i)).toBeNull()
  })

  it('keeps the configured hub as an ordinary row with a menu-only connect', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    const onServerJoined = vi.fn()
    render(<ServersView identity={identity} toast={() => {}} onServerJoined={onServerJoined} />)
    await screen.findByText('gMatch Central')

    const centralRow = rowOf('gMatch Central')
    // The row points at the CONFIGURED hub. The built-in central deployments
    // are decommissioned and are never offered as a destination.
    expect(within(centralRow).getByText(/central\.test/)).toBeInTheDocument()
    expect(within(centralRow).queryByText(/fly\.dev/)).toBeNull()
    expect(within(centralRow).getByRole('button', { name: /connect to gmatch central/i })).toBeInTheDocument()
    fireEvent.click(within(centralRow).getByRole('button', { name: /more actions/i }))
    fireEvent.click(await within(centralRow).findByText('Connect to gMatch Central'))
    expect(onServerJoined).toHaveBeenCalledWith(expect.objectContaining({ id: 'central-deprecated' }))
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://central.test')
  })

  it('never offers a decommissioned deployment as a destination', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'dead', name: 'Old Central', description: '', owner_id: 'o1', password_required: 0, endpoint_hint: 'https://gmatch-wcz1.onrender.com', last_seen: 'x' },
      ] })
      return json({})
    })
    const toast = vi.fn()
    render(<ServersView identity={identity} toast={toast} />)
    await screen.findByText('gMatch Central')
    // The dead row is filtered out of the list entirely.
    expect(screen.queryByText('Old Central')).toBeNull()
  })

  it('shows an unavailable destination as unavailable, not as ready to connect', async () => {
    mockFetch(async (url) => {
      if (url.includes('central.test')) return json({}, 503)
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    const centralRow = rowOf('gMatch Central')
    expect(within(centralRow).getByText('Unavailable')).toBeInTheDocument()
    expect(within(centralRow).getByRole('button', { name: /connect to gmatch central/i })).toBeDisabled()
  })

  it('a listed server with no address is not offered as ready to connect', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 'ghost', name: 'Ghost Node', description: '', owner_id: 'o1', password_required: 0, last_seen: 'x' },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('Ghost Node')
    const ghost = rowOf('Ghost Node')
    expect(within(ghost).getByText('Unavailable')).toBeInTheDocument()
    expect(within(ghost).getByRole('button', { name: /connect to ghost node/i })).toBeDisabled()
  })

  it('never fabricates a count for a server nothing has measured', async () => {
    mockFetch(async (url) => {
      if (url.includes('central.test')) return json({}, 503)
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    // the hub entry stays visible and reports its real state...
    const centralRow = rowOf('gMatch Central')
    expect(within(centralRow).getByText('Unavailable')).toBeInTheDocument()
    // ...and no row invents a member figure out of nothing
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull()
    // one header action, and no second "Add server" entry point outside it
    expect(screen.getAllByRole('button', { name: /add server/i })).toHaveLength(1)
  })

  it('joins a server from the row and commits it as current without a restart', async () => {
    const serverRelaunch = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet: vi.fn().mockResolvedValue({ ok: true }),
      serverRelaunch,
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
    fireEvent.click(await screen.findByRole('button', { name: /connect to open world/i }))
    await waitFor(() => expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet)
      .toHaveBeenCalledWith({ mode: 'client', url: 'https://world.test:8790' }))
    // seamless: persisted for future restarts, but nothing relaunches
    expect(serverRelaunch).not.toHaveBeenCalled()
    expect(localStorage.getItem('gmatch.api.url')).toBe('https://world.test:8790')
    // the committed mark follows committed state, and the row goes inert
    expect(await screen.findByLabelText('Open World, current server')).toBeInTheDocument()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('password-protected server prompts from the row and stores the join handoff', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: /connect to locked world/i }))
    // Join passwords go through the in-app PromptDialog (Electron has no
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

  it('repeated clicks while a switch is in flight cannot start a second one', async () => {
    let resolveSet: ((v: { ok: boolean }) => void) | undefined
    const serverSet = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { resolveSet = resolve }))
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet, serverRelaunch: vi.fn(),
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
    const join = await screen.findByRole('button', { name: /connect to open world/i })
    fireEvent.click(join)
    await screen.findByTestId('connecting-ccc')
    fireEvent.click(join)
    expect(serverSet).toHaveBeenCalledTimes(1)
    resolveSet?.({ ok: true })
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('anonymous browser fetches the directory only, never dashboard/node', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 's1', name: 'Alpha Node', description: '', owner_id: 'o1', password_required: 0, endpoint_hint: '' },
      ] })
      return json({})
    })
    render(<ServersView identity={null as never} toast={() => {}} />)
    await screen.findByText('Alpha Node')
    expect(screen.getByText(/no account yet/i)).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/api/servers/dashboard'))).toBe(false)
    expect(calls.some((c) => c.url.includes('/api/servers/node'))).toBe(false)
  })

  it('search matches name and tags, and offers a way back from no matches', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [
        { id: 's1', name: 'Chill Zone', description: '', owner_id: 'o1', password_required: 0, tags: ['chill', 'movies'] },
        { id: 's2', name: 'Other Realm', description: '', owner_id: 'o2', password_required: 0, tags: ['gaming'] },
      ] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('Chill Zone')
    // one quiet search field in the header; no sort toolbar, no lock filter
    expect(screen.getByLabelText('Search servers')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sort servers')).toBeNull()
    expect(screen.queryByRole('button', { name: /password only/i })).toBeNull()

    fireEvent.change(screen.getByLabelText('Search servers'), { target: { value: 'chill' } })
    expect(await screen.findByText('Chill Zone')).toBeInTheDocument()
    expect(screen.queryByText('Other Realm')).toBeNull()

    fireEvent.change(screen.getByLabelText('Search servers'), { target: { value: 'zzz' } })
    expect(await screen.findByText(/no servers match/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show all servers/i }))
    expect(await screen.findByText('Chill Zone')).toBeInTheDocument()
    expect(screen.getByLabelText('Search servers')).toHaveValue('')
  })

  it('search filters the node on this machine too, so nothing matching is honest', async () => {
    ;(window as unknown as { gmatch?: unknown }).gmatch = {
      serverSet: vi.fn(), serverRelaunch: vi.fn(),
      serverState: vi.fn().mockResolvedValue({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test', 'gmatch.api.url': 'http://127.0.0.1:8790' })
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'This Machine', users: [], posts_24h: 0, members_total: 2 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('This Machine')

    fireEvent.change(screen.getByLabelText('Search servers'), { target: { value: 'machine' } })
    expect(await screen.findByText('This Machine')).toBeInTheDocument()

    // a query nothing matches empties the list instead of leaving a stale row
    fireEvent.change(screen.getByLabelText('Search servers'), { target: { value: 'zzz' } })
    expect(await screen.findByText(/no servers match/i)).toBeInTheDocument()
    expect(screen.queryByText('This Machine')).toBeNull()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('without a configured central, explains instead of crashing', async () => {
    stubLocalStorage({ 'gmatch.central.url': 'none' })
    mockFetch(async () => json({ servers: [] }))
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no central/i)).toBeInTheDocument())
  })

  it('keeps known servers and offers a retry when the directory is unreachable', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      return json({}, 500)
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText(/directory unreachable/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    // the list still renders what it knows instead of a blank page
    expect(screen.getByText('gMatch Central')).toBeInTheDocument()
  })

  it('central admin door lives behind the directory menu', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'hub', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers/node')) return json({ name: 'hub', description: '', isAdmin: false })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    // The button no longer pre-gates on node.isAdmin: the user's .exe is the
    // central admin. CentralAdminPanel itself refuses until the PIN unlocks.
    fireEvent.click(screen.getByRole('button', { name: /directory options/i }))
    expect(screen.getByRole('button', { name: /central admin/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Central admin login')).not.toBeInTheDocument()
  })

  it('add server: rejects a bad invite code next to its field and preserves it', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    await openJoinForm()
    expect(screen.getByRole('dialog', { name: /add server/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/invite code/i), { target: { value: 'not-a-code' } })
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/node code/i)
    expect(screen.getByRole('dialog', { name: /add server/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/invite code/i)).toHaveValue('not-a-code')
    expect(localStorage.getItem('gmatch.api.url')).toBeNull()
  })

  it('local groups stay out of the list and behind their own secondary door', async () => {
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers')) return json({ servers: [] })
      return json({})
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    await screen.findByText('gMatch Central')
    // the node on this machine + the built-in public world; a label is never a
    // server and adds no list row
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /local groups/i }))
    expect(screen.getByRole('dialog', { name: /local groups/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/new group name/i), { target: { value: 'Friday crew' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(await screen.findByText('Friday crew')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forget group friday crew/i }))
    await waitFor(() => expect(screen.queryByText('Friday crew')).toBeNull())
    // still the same two server rows: the group never became a destination
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
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
    await openHostForm()
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
    await openHostForm()
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
    await openHostForm()
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
    await openHostForm()
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'Second Server' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(toasts.join('|')).toMatch(/already hosts/i))
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
    expect((window as unknown as { gmatch: { serverSet: ReturnType<typeof vi.fn> } }).gmatch.serverSet).not.toHaveBeenCalled()
    delete (window as unknown as { gmatch?: unknown }).gmatch
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
    await openHostForm()
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
    await openHostForm()
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
    fireEvent.click(await screen.findByRole('button', { name: /more actions for my realm/i }))
    fireEvent.click(await screen.findByText('unregister'))
    await waitFor(() => expect(localStorage.getItem('gmatch.server.register')).toBeNull())
    expect(localStorage.getItem('gmatch.server.directoryId')).toBeNull()
  })

  it('my own server row offers privacy and unregister, with no duplicate actions', async () => {
    const ownId = (identity as unknown as { orbitId: string }).orbitId
    mockFetch(async (url) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'n', users: [], posts_24h: 0, members_total: 0 })
      if (url.includes('/api/servers/node')) return json({ name: 'n', description: '', isAdmin: true })
      return json({ servers: [{ id: 'bbb', name: 'My Realm', owner_id: ownId, password_required: 0, is_private: 0, endpoint_hint: 'my.host:8790' }] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    const myRow = await screen.findByText('My Realm')
    expect(myRow).toBeInTheDocument()
    const li = myRow.closest('li')!
    // the row itself is the action; nothing is duplicated beside it
    expect(within(li).getAllByRole('button')).toHaveLength(2)
    fireEvent.click(within(li).getByRole('button', { name: /more actions/i }))
    expect(await within(li).findByText('Make private')).toBeInTheDocument()
    expect(within(li).getByText('unregister')).toBeInTheDocument()
    // node-level settings live in the Hub of the connected server, so a
    // non-connected row offers no rename item.
    expect(within(li).queryByText('Server settings')).toBeNull()
  })

  it('hub settings editor saves name and description to node + directory', async () => {
    const did = 'd'.repeat(64)
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test', 'gmatch.api.url': 'http://my.host:8790' })
    mockFetch(async (url, init) => {
      if (url.includes('/api/servers/dashboard')) return json({ name: 'My Realm', users: [], posts_24h: 0, members_total: 1 })
      if (url.includes('/api/servers/node')) {
        if (init?.method === 'PATCH') {
          const b = JSON.parse(String(init?.body))
          return json({ server: { name: b.name, description: b.description, directoryId: did, isAdmin: true } })
        }
        return json({ name: 'My Realm', description: 'old', isAdmin: true })
      }
      if (init?.method === 'PATCH' && url.includes(`/api/servers/${did}`)) return json({ server: {} })
      return json({ servers: [] })
    })
    render(<ServersView identity={identity} toast={() => {}} />)
    const activeRow = (await screen.findByLabelText('My Realm, current server')).closest('li')!
    fireEvent.click(within(activeRow).getByRole('button', { name: /more actions/i }))
    fireEvent.click(await within(activeRow).findByText('Server settings'))
    expect(await screen.findByLabelText('Current server tags')).toBeInTheDocument()
    expect(screen.getByLabelText('New server join password')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Current server name'), { target: { value: 'Renamed Realm' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      const nodePatch = calls.find((c) => c.url.includes('/api/servers/node') && c.init?.method === 'PATCH')
      expect(nodePatch).toBeTruthy()
      expect(JSON.parse(String(nodePatch?.init?.body))).toMatchObject({ name: 'Renamed Realm' })
      const dirPatch = calls.find((c) => c.url.includes(`/api/servers/${did}`) && c.init?.method === 'PATCH')
      expect(dirPatch).toBeTruthy()
      expect(JSON.parse(String(dirPatch?.init?.body))).toMatchObject({ name: 'Renamed Realm' })
    })
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
    await screen.findByText('gMatch Central')
    expect(screen.queryByTestId('admin-pin-banner')).toBeNull()
    spy.mockRestore()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('renders online and offline members on the hub and opens a profile from a member', async () => {
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
      return json({ servers: [] })
    })
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test', 'gmatch.api.url': 'http://127.0.0.1:8790' })
    const onSelectUser = vi.fn()
    render(<ServersView identity={identity} toast={() => {}} onSelectUser={onSelectUser} />)

    // browse keeps no presence chrome: no Manage Hub, no Online pills.
    expect(screen.queryByRole('button', { name: /manage hub/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /online \(/i })).toBeNull()

    const activeRow = (await screen.findByLabelText('hub, current server')).closest('li')!
    fireEvent.click(within(activeRow).getByRole('button', { name: /more actions/i }))
    fireEvent.click(await within(activeRow).findByText('Open dashboard'))
    // Stacked sections: BobOnline is in Online, CarolRecent in Offline.
    expect(await screen.findByText('BobOnline', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('CarolRecent')).toBeInTheDocument()
    expect(screen.getByText(/Online \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Offline \(1\)/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText('BobOnline'))
    expect(onSelectUser).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'BobOnline' }))
    spy.mockRestore()
  })
})
