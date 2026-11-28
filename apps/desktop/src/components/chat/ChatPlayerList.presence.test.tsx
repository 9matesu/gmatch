// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ChatPlayerList } from './ChatPlayerList'
import * as api from '../../utils/api'
import { PeerRoster } from '../../utils/peerRoster'
import { generateFallbackName, type User } from '@orbit/shared'

const identity = {
  orbitId: 'me',
  publicKeyHex: 'pk',
  privateKeyHex: 'sk',
  encryptionPubHex: 'ep',
  encryptionPrivHex: 'es',
} as never

const fresh = () => new Date().toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const baseUser = (id: string, extra: Partial<User> = {}): User =>
  ({ id, display_name: id, publicKey: `pk-${id}`, createdAt: fresh(), ...extra }) as User

// NOTE: the list always injects self ('me') as online — scope assertions to
// the subject's row via its title attribute.
const row = (name: string) => within(screen.getByTitle(`View ${name}'s profile`))

describe('ChatPlayerList presence decay (no ghosts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
  })

  it('drops a stale online:true flag once its timestamp decays', () => {
    // Snapshot is fresh (just mounted) but the sighting is 10 min old:
    // server truth says this player left — no row at all, not "Seen 10m ago".
    render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('ghost', { display_name: 'Ghost', online: true, last_seen: ago(10 * 60_000) })]}
      />,
    )
    expect(screen.queryByTitle("View Ghost's profile")).toBeNull()
  })

  it('treats space-separated SQLite timestamps as UTC, not local time', () => {
    // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" (UTC, no Z).
    // In UTC-3 or any negative offset, raw `new Date()` treats this as local time (+3h in future).
    const sqliteStale = new Date(Date.now() - 2 * 3600_000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
    render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('stale-sql', { display_name: 'StaleSql', online: true, last_seen: sqliteStale })]}
      />,
    )
    expect(screen.queryByTitle("View StaleSql's profile")).toBeNull()
  })

  it('keeps a fresh sighting online even when the flag lags', () => {
    render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('newbie', { display_name: 'Newbie', online: false, last_seen: fresh() })]}
      />,
    )
    expect(row('Newbie').getByText('Active now')).toBeDefined()
    expect(row('Newbie').getByLabelText('Online')).toBeDefined()
  })

  it('a leaver goes offline on the next props update (no sticky carry-over)', () => {
    const { rerender } = render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('leaver', { display_name: 'Leaver', online: true, last_seen: fresh() })]}
      />,
    )
    expect(row('Leaver').getByText('Active now')).toBeDefined()

    rerender(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('leaver', { display_name: 'Leaver', online: false, last_seen: ago(5 * 60_000) })]}
      />,
    )
    expect(screen.queryByTitle("View Leaver's profile")).toBeNull()
  })

  it('header shows server counts while the dashboard snapshot is fresh', async () => {
    vi.spyOn(api, 'orbitFetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        users: [{ id: 'u1', display_name: 'U1', online: true, last_seen: fresh() }],
        online_count: 5,
        active_24h_count: 12,
      }),
    } as Response)
    render(<ChatPlayerList identity={null} users={[]} />)
    expect(await screen.findByText('5')).toBeDefined()
    expect(await screen.findByText(/0 connecting/)).toBeDefined()
  })

  it('the roster wins over a fresh server count for the online number', async () => {
    vi.spyOn(api, 'orbitFetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        users: [],
        online_count: 5,
        active_24h_count: 12,
      }),
    } as Response)
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('a', { online: true, last_seen: fresh() }))
      roster.upsert(baseUser('b', { online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    // Let the dashboard snapshot land so it would have claimed 5.
    await screen.findByText(/0 connecting/)
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.queryByText('5')).toBeNull()
    act(() => { roster.markOffline('a') })
    expect(screen.getByText('1')).toBeDefined()
  })
});

describe('ChatPlayerList roster rows (the one roster owns the list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
    vi.spyOn(api, 'orbitFetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [], online_count: 9, active_24h_count: 7 }),
    } as Response)
  })

  it('renders a peer that exists ONLY in the roster with its signed name and Active now', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('cross-node', { display_name: 'Signed Roster Name', online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/) // dashboard lands; roster still owns the rows
    const subject = row('Signed Roster Name')
    expect(subject.getByText('Signed Roster Name')).toBeDefined()
    expect(subject.getByText('Active now')).toBeDefined()
    expect(subject.getByLabelText('Online')).toBeDefined()
    // The literal placeholder is never shown for someone else.
    expect(screen.queryByText('User')).toBeNull()
  })

  it('the roster-only peer is searchable and the header count matches the roster', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('only-here', { display_name: 'RosterRider', online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    // The dashboard claims 9 online; the roster has exactly one.
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.queryByText('9')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search players...'), { target: { value: 'RosterRider' } })
    expect(row('RosterRider').getByText('Active now')).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText('Search players...'), { target: { value: 'nobody' } })
    expect(screen.queryByTitle("View RosterRider's profile")).toBeNull()
  })

  it('row state follows roster changes, not just the header count', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('live', { display_name: 'LivePeer', online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    expect(row('LivePeer').getByText('Active now')).toBeDefined()
    act(() => { roster.markOffline('live') })
    expect(screen.queryByTitle("View LivePeer's profile")).toBeNull()
  })

  it('a nameless roster row uses the shared fallback, never the literal User', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('abcdef123456', { display_name: '', online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    expect(screen.getByText(generateFallbackName('abcdef123456'))).toBeDefined()
    expect(screen.queryByText('User')).toBeNull()
  })

  it('a nameless roster row cannot blank a name learned from the node list', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(baseUser('known', { display_name: '', online: true, last_seen: fresh() }))
    })
    render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('known', { display_name: 'Known Name', online: true, last_seen: fresh() })]}
        roster={roster}
      />,
    )
    await screen.findByText(/0 connecting/)
    expect(row('Known Name').getByText('Known Name')).toBeDefined()
    expect(screen.queryByText('User')).toBeNull()
  })

  it('unsubscribes from the roster on unmount', async () => {
    const roster = new PeerRoster(null)
    const unsubscribe = vi.fn()
    const subscribe = vi.spyOn(roster, 'subscribe').mockImplementation((cb) => {
      cb(roster.list())
      return unsubscribe
    })
    const { unmount } = render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    expect(subscribe).toHaveBeenCalledTimes(1)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
});
