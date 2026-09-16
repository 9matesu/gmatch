// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ChatPlayerList } from './ChatPlayerList'
import * as api from '../../utils/api'
import type { User } from '@orbit/shared'

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

  it('shows a stale online:true flag as offline once its timestamp decays', () => {
    // Snapshot is fresh (just mounted) but the sighting is 10 min old:
    // server truth says this player left — must not show "Active now".
    render(
      <ChatPlayerList
        identity={identity}
        users={[baseUser('ghost', { display_name: 'Ghost', online: true, last_seen: ago(10 * 60_000) })]}
      />,
    )
    expect(row('Ghost').queryByText('Active now')).toBeNull()
    expect(row('Ghost').getByLabelText('Offline')).toBeDefined()
    expect(row('Ghost').getByText(/Seen /)).toBeDefined()
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
    expect(row('Leaver').queryByText('Active now')).toBeNull()
    expect(row('Leaver').getByLabelText('Offline')).toBeDefined()
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
    expect(await screen.findByText(/12 24h/)).toBeDefined()
  })
});
