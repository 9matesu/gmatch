// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('renders online and 24h offline users and excludes users inactive > 24h', () => {
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', secretKeyHex: 'sk', encryptionPubHex: 'ep', encryptionSecretHex: 'es' }}
        users={mockUsers}
      />,
    )

    // Alice is online
    expect(screen.getByText('Alice')).toBeDefined()
    // Bob is offline (2h ago)
    expect(screen.getByText('Bob')).toBeDefined()
    expect(screen.getByText(/2h ago/)).toBeDefined()
    // OldUser (>24h) should not be displayed
    expect(screen.queryByText('OldUser')).toBeNull()
  })

  it('filters player list by search query', () => {
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', secretKeyHex: 'sk', encryptionPubHex: 'ep', encryptionSecretHex: 'es' }}
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
    expect(screen.getByText('Bob')).toBeDefined()
  })

  it('triggers onOpenProfile when clicking a player', () => {
    const onOpenProfile = vi.fn()
    render(
      <ChatPlayerList
        identity={{ orbitId: 'me', publicKeyHex: 'pk', secretKeyHex: 'sk', encryptionPubHex: 'ep', encryptionSecretHex: 'es' }}
        users={mockUsers}
        onOpenProfile={onOpenProfile}
      />,
    )

    fireEvent.click(screen.getByText('Alice'))
    expect(onOpenProfile).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'u1', display_name: 'Alice' }))
  })
})
