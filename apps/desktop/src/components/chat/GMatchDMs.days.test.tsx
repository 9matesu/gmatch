// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'
import type { ChatMessage } from '../../hooks/useP2P'

/**
 * Date separators in the rendered stream.
 *
 * The per-message clock is HH:MM, which is equally true of last Tuesday — so
 * without a separator a reply from three days ago is indistinguishable from one
 * sent during this session. The request was specifically for the age to be
 * visible, so the labels are asserted, not just their presence.
 */

const identity = {
  orbitId: 'me',
  publicKeyHex: 'pk',
  privateKeyHex: 'sk',
  encryptionPubHex: 'ep',
  encryptionPrivHex: 'es',
} as never

const PEER = { orbitId: 'peer', name: 'Peer' }

type Overrides = Parameters<typeof GMatchDMs>[0]

function baseProps(overrides: Partial<Overrides> = {}): Overrides {
  return {
    identity,
    activePmPeer: PEER,
    peers: [PEER],
    profilePics: {},
    onSelectPeer: vi.fn(),
    ...overrides,
  }
}

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0).getTime()

const msg = (id: string, timestamp: number, senderId = 'peer'): ChatMessage => ({
  id,
  senderId,
  senderName: 'Peer',
  text: `body ${id}`,
  timestamp,
})

describe('chat day separators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('shows an age label for an old day, not just a date', () => {
    const now = new Date()
    const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).setHours(12, 0, 0, 0)
    render(
      <GMatchDMs
        {...baseProps({
          pmMessages: [msg('a', threeDaysAgo), msg('b', now.getTime() - 60_000)],
        })}
      />,
    )
    const separators = screen.getAllByTestId('chat-day-separator')
    expect(separators.length).toBe(2)
    // "3 days ago" — the thing the request actually asked for.
    expect(separators.some((s) => /days ago/.test(s.textContent || ''))).toBe(true)
    expect(separators.some((s) => /Today/.test(s.textContent || ''))).toBe(true)
  })

  it('inserts exactly one separator for a same-day conversation', () => {
    // Anchored at noon of the current day: every stamp stays on the same
    // calendar day as `now` no matter what time the suite runs (raw
    // `now - 3h` crossed midnight and mislabelled the day 'Yesterday').
    const noon = new Date().setHours(12, 0, 0, 0)
    render(
      <GMatchDMs
        {...baseProps({
          pmMessages: [
            msg('a', noon - 3 * 3600_000),
            msg('b', noon - 2 * 3600_000),
            msg('c', noon - 1 * 3600_000),
          ],
        })}
      />,
    )
    const separators = screen.getAllByTestId('chat-day-separator')
    expect(separators).toHaveLength(1)
    expect(separators[0].textContent).toContain('Today')
  })

  it('labels the separator for assistive tech, not colour alone', () => {
    const now = new Date()
    const old = new Date(now.getTime() - 4 * 86_400_000).setHours(12, 0, 0, 0)
    render(<GMatchDMs {...baseProps({ pmMessages: [msg('a', old)] })} />)
    const sep = screen.getByTestId('chat-day-separator')
    expect(sep.getAttribute('role')).toBe('separator')
    expect(sep.getAttribute('aria-label')).toMatch(/Messages from .+/)
  })

  it('still renders every message body', () => {
    const now = new Date()
    render(
      <GMatchDMs
        {...baseProps({
          pmMessages: [
            msg('a', new Date(now.getTime() - 2 * 86_400_000).setHours(12, 0, 0, 0)),
            msg('b', now.getTime() - 60_000),
          ],
        })}
      />,
    )
    expect(screen.getByText('body a')).toBeDefined()
    expect(screen.getByText('body b')).toBeDefined()
  })

  it('a future-dated message (clock skew) does not say "-1 days ago"', () => {
    const now = new Date()
    render(<GMatchDMs {...baseProps({ pmMessages: [msg('a', now.getTime() + 60_000)] })} />)
    const sep = screen.getByTestId('chat-day-separator')
    expect(sep.textContent).toContain('Today')
    expect(sep.textContent).not.toContain('-')
  })
})
