// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatPlayerList } from './ChatPlayerList'
import type { User } from '@orbit/shared'

describe('ChatPlayerList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
  })

  const mockUsers: User[] = [
    {
      id: 'u1',
      display_name: 'Alice',
      online: true,
      last_seen: new Date().toISOString(),
      publicKey: 'pub1',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'u2',
      display_name: 'Bob',
      online: false,
      last_seen: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago
      publicKey: 'pub2',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'u3',
      display_name: 'OldUser',
      online: false,
      last_seen: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // 48 hours ago (>24h)
      publicKey: 'pub3',
      createdAt: new Date().toISOString(),
    },
  ]

  it('lists only live players: offline and long-idle users are not a roster', () => {
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
      />,
    )

    // Alice is online; "Seen 2h ago" and "Seen 48h ago" are dead rows.
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.queryByText('Bob')).toBeNull()
    expect(screen.queryByText('OldUser')).toBeNull()
  })

  it('filters player list by search query', () => {
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
      />,
    )

    const searchInput = screen.getByPlaceholderText('Search players...')
    fireEvent.change(searchInput, { target: { value: 'Alice' } })

    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.queryByText('Bob')).toBeNull()

    // Clear search
    const clearBtn = screen.getByLabelText('Clear player search')
    fireEvent.click(clearBtn)
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.queryByText('Bob')).toBeNull()
  })

  it('keeps player search a compact single-line field', () => {
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
      />,
    )
    const input = screen.getByLabelText('Search players')
    const shell = input.parentElement as HTMLElement
    expect(input.tagName).toBe('INPUT')
    expect(input.className).toContain('text-xs')
    expect(shell.className).toContain('py-1.5')
    expect(shell.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)
  })

  it('triggers onOpenProfile when clicking a player', () => {
    const onOpenProfile = vi.fn()
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
        onOpenProfile={onOpenProfile}
      />,
    )

    fireEvent.click(screen.getByText('Alice'))
    expect(onOpenProfile).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'u1', display_name: 'Alice' }))
  })

  it('collapses via the Players label and hides the list body', () => {
    const onToggleCollapse = vi.fn()
    const { rerender } = render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
        onToggleCollapse={onToggleCollapse}
      />,
    )
    // Expanded: the search field and rows are present.
    expect(screen.getByPlaceholderText('Search players...')).toBeDefined()
    fireEvent.click(screen.getByLabelText('Collapse players'))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)

    // Collapsed: the body is gone, the icon toggle remains to expand.
    rerender(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk', encryptionPubHex: 'ep', encryptionPrivHex: 'es' }}
        users={mockUsers}
        collapsed
        onToggleCollapse={onToggleCollapse}
      />,
    )
    expect(screen.queryByPlaceholderText('Search players...')).toBeNull()
    expect(screen.getByLabelText('Expand players')).toBeDefined()
  })
})
