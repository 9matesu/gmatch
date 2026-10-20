// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'
import type { ChatMessage } from '../../hooks/useP2P'

/**
 * Delivery state is a property of a MESSAGE, not of the last message in a
 * block.
 *
 * The clock labels the block (one HH:MM for a run of messages), but "not
 * delivered" was rendered inside the same `isLast` gate, so a failed message
 * that was followed by another one showed no state at all: it read exactly
 * like one that had landed. That is the one thing the DM lane must never do.
 */

const identity = {
  orbitId: 'me',
  publicKeyHex: 'pk',
  privateKeyHex: 'sk',
  encryptionPubHex: 'ep',
  encryptionPrivHex: 'es',
} as never

const PEER = { orbitId: 'peer', name: 'Peer' }
const AT = 1_700_000_000_000

const own = (id: string, courierStatus?: ChatMessage['courierStatus']): ChatMessage => ({
  id,
  senderId: 'me',
  senderName: 'Me',
  text: `body ${id}`,
  timestamp: AT,
  ...(courierStatus ? { courierStatus } : {}),
})

function renderThread(messages: ChatMessage[]) {
  return render(
    <GMatchDMs
      identity={identity}
      activePmPeer={PEER}
      peers={[PEER]}
      profilePics={{}}
      onSelectPeer={vi.fn()}
      pmMessages={messages}
    />,
  )
}

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-message-row="${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el as HTMLElement
}

describe('DM delivery state', () => {
  it('states the failure of a message that is followed by another one', () => {
    renderThread([own('a', 'failed'), own('b', 'sending')])
    expect(row('a').querySelector('[title="Not delivered"]')).toBeTruthy()
  })

  it('still states a failure when it is the last message of the block', () => {
    renderThread([own('a', 'sending'), own('b', 'failed')])
    expect(screen.getByTitle('Not delivered')).toBeTruthy()
  })

  it('keeps the block clock on the last message only', () => {
    renderThread([own('a', 'failed'), own('b')])
    expect(row('a').querySelector('time')).toBeNull()
    expect(row('b').querySelector('time')).toBeTruthy()
  })

  it('does not invent a state for a delivered message', () => {
    renderThread([own('a', 'delivered')])
    expect(screen.queryByText('not delivered')).toBeNull()
    expect(screen.getByTitle('Delivered')).toBeTruthy()
  })
})
