// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import * as api from '../../utils/api'
import { PeerRoster } from '../../utils/peerRoster'
import { swarmTransportRegistry } from '../../utils/transportState'
import { generateFallbackName, type User } from '@orbit/shared'
import { ChatPlayerList } from './ChatPlayerList'

const identity = {
  orbitId: 'me',
  publicKeyHex: 'pk',
  privateKeyHex: 'sk',
  encryptionPubHex: 'ep',
  encryptionPrivHex: 'es',
} as never

const fresh = () => new Date().toISOString()
const u = (id: string, name: string, extra: Partial<User> = {}): User =>
  ({ id, display_name: name, publicKey: `pk-${id}`, createdAt: fresh(), ...extra }) as User

const rowFor = (name: string): HTMLElement =>
  screen.getByTitle(`View ${name}'s profile`).closest('[data-testid="chat-player-row"]') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  try { window.localStorage?.clear() } catch {}
  // The presence poll reads the node dashboard; keep it deterministic and quiet.
  vi.spyOn(api, 'orbitFetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ users: [], online_count: 0, active_24h_count: 0 }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatPlayerList · cross-node parity & density', () => {
  it('a cross-node peer with a real name looks identical to a local peer', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(u('cross-node', 'Cross Node', { online: true, last_seen: fresh() }))
    })
    render(
      <ChatPlayerList
        identity={identity}
        users={[u('local-peer', 'Local Peer', { online: true, last_seen: fresh() })]}
        roster={roster}
      />,
    )
    await screen.findByText(/0 connecting/)

    const local = rowFor('Local Peer')
    const cross = rowFor('Cross Node')

    // Same row shape: both carry the online dot, the name and an Active line.
    for (const row of [local, cross]) {
      expect(within(row).getByLabelText('Online')).toBeDefined()
      expect(within(row).getByText('Active now')).toBeDefined()
      expect(row.className).toContain('flex')
      expect(row.className).toContain('items-center')
    }
    // The literal placeholder is never shown for anyone.
    expect(screen.queryByText('User')).toBeNull()
  })

  it('a nameless cross-node peer uses the shared fallback, never "User"', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(u('abcdef123456', '', { online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    expect(screen.getByText(generateFallbackName('abcdef123456'))).toBeDefined()
    expect(screen.queryByText('User')).toBeNull()
  })

  it('an online peer shows its REAL transport label; an offline peer is gone', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(u('live', 'Live Peer', { online: true, last_seen: fresh() }))
      roster.upsert(u('away', 'Away Peer', { last_seen: fresh() }))
      roster.markOffline('away')
      swarmTransportRegistry.markDirectValidated('live')
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    expect(within(rowFor('Live Peer')).getByText(/P2P direct/)).toBeDefined()
    // Dead rows are not a roster: no "Seen 6h ago" clutter.
    expect(screen.queryByTitle("View Away Peer's profile")).toBeNull()
  })

  it('an ONLINE peer with a dial in flight still reads Active now; connecting is only a detail', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(u('dialing-online', 'Dialing Online', { online: true, last_seen: fresh() }))
      swarmTransportRegistry.startDirectAttempt('dialing-online')
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/1 connecting/)
    const row = rowFor('Dialing Online')
    expect(within(row).getByText('Active now')).toBeDefined()
    expect(within(row).getByText(/connecting…/)).toBeDefined()
    // An unvalidated dial must never claim a settled route.
    expect(within(row).queryByText(/P2P direct|relay via node/)).toBeNull()
    expect(within(row).getByLabelText('Online')).toBeDefined()
    swarmTransportRegistry.forget('dialing-online')
  })

  it('shows an older-version note only for a peer whose signed version is older', async () => {
    const previous = (window as unknown as { gmatch?: unknown }).gmatch
    ;(window as unknown as { gmatch?: unknown }).gmatch = { appVersion: async () => '1.7.2' }
    try {
      const roster = new PeerRoster(null)
      act(() => {
        roster.upsert(u('old', 'Old Peer', { online: true, last_seen: fresh() }))
        roster.upsert(u('unknown', 'Unknown Peer', { online: true, last_seen: fresh() }))
      })
      // The roster row carries the peer's signed version; absence is unknown.
      ;(roster.get('old') as unknown as { appVersion?: string }).appVersion = '1.6.0'
      render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
      await screen.findByText(/0 connecting/)
      expect(within(rowFor('Old Peer')).getByText(/older version — update to share media/)).toBeDefined()
      expect(within(rowFor('Unknown Peer')).queryByText(/older version/)).toBeNull()
    } finally {
      (window as unknown as { gmatch?: unknown }).gmatch = previous
    }
  })

  it('only a NOT-online peer with a dial in flight reads Connecting as its primary label', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      // A ghost hydrated offline, then a dial started: the transport is the
      // only honest thing to say because the roster has no online sighting.
      roster.hydrate([u('dialing-offline', 'Dialing Offline', { online: false })])
      swarmTransportRegistry.startDirectAttempt('dialing-offline')
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/1 connecting/)
    const row = rowFor('Dialing Offline')
    expect(within(row).getByText(/Connecting…/)).toBeDefined()
    expect(within(row).queryByText('Active now')).toBeNull()
    swarmTransportRegistry.forget('dialing-offline')
  })

  it('rows use the tightened density (px-2 py-1.5), not the old p-2', async () => {
    const roster = new PeerRoster(null)
    act(() => {
      roster.upsert(u('dense', 'Dense Peer', { online: true, last_seen: fresh() }))
    })
    render(<ChatPlayerList identity={identity} users={[]} roster={roster} />)
    await screen.findByText(/0 connecting/)
    const row = rowFor('Dense Peer')
    expect(row.className).toContain('px-2')
    expect(row.className).toContain('py-1.5')
    expect(row.className).not.toMatch(/\bp-2\b/)
  })

  it('keeps the search a compact single-line field', () => {
    render(<ChatPlayerList identity={identity} users={[u('a', 'Alpha', { online: true, last_seen: fresh() })]} />)
    const input = screen.getByLabelText('Search players')
    const shell = input.parentElement as HTMLElement
    expect(input.tagName).toBe('INPUT')
    expect(shell.className).toContain('py-1.5')
    expect(shell.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)
  })
})