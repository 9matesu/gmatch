// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatPlayerList } from './ChatPlayerList'
import type { User } from '@orbit/shared'

/**
 * Row actions on the directory list.
 *
 * The row used to be a single button that opened the profile, so starting a DM
 * or challenging someone from chat meant going through the profile first. The
 * actions are separate labelled buttons now; the assertions check the wiring
 * AND that a blind courier disables the invite with a reason instead of
 * letting the click fail as a 404.
 */

const identity = { orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }

const user: User = {
  id: 'u1',
  display_name: 'Alice',
  online: true,
  last_seen: new Date().toISOString(),
  publicKey: 'pub1',
  createdAt: new Date().toISOString(),
} as User

describe('ChatPlayerList row actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
  })

  it('opens the profile from the row body, not from an action button', () => {
    const onOpenProfile = vi.fn()
    const onMessagePlayer = vi.fn()
    render(
      <ChatPlayerList
        identity={identity}
        users={[user]}
        onOpenProfile={onOpenProfile}
        onMessagePlayer={onMessagePlayer}
      />,
    )
    fireEvent.click(screen.getByText('Alice'))
    expect(onOpenProfile).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'u1' }))
    expect(onMessagePlayer).not.toHaveBeenCalled()
  })

  it('starts a conversation from the message action', () => {
    const onMessagePlayer = vi.fn()
    render(
      <ChatPlayerList
        identity={identity}
        users={[user]}
        onMessagePlayer={onMessagePlayer}
      />,
    )
    fireEvent.click(screen.getByLabelText('Message Alice'))
    expect(onMessagePlayer).toHaveBeenCalledWith({ orbitId: 'u1', name: 'Alice', pfp: undefined })
  })

  it('sends a game invite through the server-authoritative path', () => {
    const onInvitePlayer = vi.fn()
    render(
      <ChatPlayerList
        identity={identity}
        users={[user]}
        onInvitePlayer={onInvitePlayer}
      />,
    )
    fireEvent.click(screen.getByLabelText('Invite Alice to a game'))
    expect(onInvitePlayer).toHaveBeenCalledWith('u1')
  })

  it('disables the invite with the node reason when the node cannot host one', () => {
    const onInvitePlayer = vi.fn()
    const reason = 'This node only relays sealed mail — game invites need a node that hosts matches.'
    render(
      <ChatPlayerList
        identity={identity}
        users={[user]}
        onInvitePlayer={onInvitePlayer}
        inviteUnavailableReason={reason}
      />,
    )
    const button = screen.getByLabelText('Invite Alice to a game') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe(reason)
    fireEvent.click(button)
    expect(onInvitePlayer).not.toHaveBeenCalled()
  })

  it('offers no actions on your own row', () => {
    render(<ChatPlayerList identity={{ ...identity, orbitId: 'u1' }} users={[user]} onMessagePlayer={vi.fn()} onInvitePlayer={vi.fn()} />)
    expect(screen.queryByLabelText('Message Alice')).toBeNull()
    expect(screen.queryByLabelText('Invite Alice to a game')).toBeNull()
  })
})
