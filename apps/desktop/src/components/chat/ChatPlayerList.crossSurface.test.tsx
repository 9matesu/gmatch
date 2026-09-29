// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { usePresence, __resetPresenceForTests, ingestSnapshot } from '../../game/presenceStore'
import { ChatPlayerList } from './ChatPlayerList'
import type { User } from '@orbit/shared'

const identity = { orbitId: 'me' } as never
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const fresh = () => new Date().toISOString()

const u = (id: string, name: string, extra: Partial<User> = {}): User =>
  ({ id, display_name: name, publicKey: `pk-${id}`, createdAt: fresh(), ...extra }) as User

function ProfileDot({ id }: { id: string }) {
  // Exactly the read UserProfileModal performs.
  const online = usePresence((s) => s.isOnline(id, Date.now()))
  return <span data-testid={`dot-${id}`}>{online ? 'Online' : 'Offline'}</span>
}

function Surfaces({ users }: { users: User[] }) {
  return (
    <>
      <ChatPlayerList identity={identity} users={users} />
      <ProfileDot id="subject" />
    </>
  )
}

describe('presence: one answer for every surface', () => {
  beforeEach(() => {
    __resetPresenceForTests()
  })

  it('the chat list and the profile agree on a stale sighting', () => {
    // The reported bug: the same person read Online in one place and Offline
    // in another, because each surface derived presence from its own object.
    const stale = u('subject', 'Subject', { last_seen: ago(10 * 60_000), online: true })
    render(<Surfaces users={[stale]} />)

    expect(screen.getByTitle(`View Subject's profile`).textContent).toContain('Seen')
    expect(screen.getByTestId('dot-subject').textContent).toBe('Offline')
  })

  it('the chat list and the profile agree on a fresh sighting', () => {
    render(<Surfaces users={[u('subject', 'Subject', { last_seen: fresh() })]} />)
    expect(screen.getByTitle(`View Subject's profile`).textContent).toContain('Active now')
    expect(screen.getByTestId('dot-subject').textContent).toBe('Online')
  })

  it('a store update moves BOTH surfaces together', () => {
    // This is the property that was missing: one ingest, one shared answer.
    render(<Surfaces users={[]} />)
    expect(screen.getByTestId('dot-subject').textContent).toBe('Offline')

    act(() => {
      ingestSnapshot([{ id: 'subject', last_seen: fresh(), online: true }])
    })
    expect(screen.getByTestId('dot-subject').textContent).toBe('Online')
  })

  it('self reads online everywhere with no sighting at all', () => {
    render(<Surfaces users={[]} />)
    // The modal for yourself must never say Offline.
    expect(usePresence.getState().isOnline('me')).toBe(true)
  })
})
