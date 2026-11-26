// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  PEER_NOTIFICATIONS_CHANGED_EVENT,
  markPeerNotificationsRead,
  readPeerNotificationReads,
} from '../utils/peerNotifications'
import { usePeerNotificationReads } from './usePeerNotificationReads'

/**
 * The read set is durable (localStorage), so the centre must re-read it when the
 * player marks a row read — otherwise a tapped report would stay unread in the
 * UI until a reload and the badge would not clear.
 *
 * The store is the thing under test here, and `localStorage` is stubbed so the
 * test does not depend on the jsdom global existing.
 */
function stubStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
}

function Probe({ id }: { id?: string | null }) {
  const read = usePeerNotificationReads(id)
  return <span data-testid="read">{[...read].sort().join(',')}</span>
}

describe('usePeerNotificationReads', () => {
  beforeEach(() => {
    stubStorage()
  })

  it('reads the durable set for the identity', () => {
    markPeerNotificationsRead('me', ['op-1'])
    render(<Probe id="me" />)
    expect(screen.getByTestId('read').textContent).toBe('op-1')
  })

  it('updates when a row is marked read after mount', () => {
    render(<Probe id="me" />)
    expect(screen.getByTestId('read').textContent).toBe('')
    act(() => {
      markPeerNotificationsRead('me', ['op-2'])
    })
    expect(screen.getByTestId('read').textContent).toBe('op-2')
  })

  it('re-reads when the identity changes', () => {
    markPeerNotificationsRead('alice', ['op-a'])
    markPeerNotificationsRead('bob', ['op-b'])
    const { rerender } = render(<Probe id="alice" />)
    expect(screen.getByTestId('read').textContent).toBe('op-a')
    rerender(<Probe id="bob" />)
    expect(screen.getByTestId('read').textContent).toBe('op-b')
  })

  it('is empty with no identity', () => {
    markPeerNotificationsRead('me', ['op-1'])
    render(<Probe id={null} />)
    expect(screen.getByTestId('read').textContent).toBe('')
    // Sanity: the store still holds the value for the real identity.
    expect([...readPeerNotificationReads('me')]).toEqual(['op-1'])
  })

  it('exposes the same event name the store raises', () => {
    expect(PEER_NOTIFICATIONS_CHANGED_EVENT).toBe('gmatch:peer-notifications-changed')
  })
})
