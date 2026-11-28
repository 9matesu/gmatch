// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'
import type { ChatMessage } from '../../hooks/useP2P'

/** One cancel affordance, two honest actions: stop a pending send locally,
 *  tombstone a sent one for everyone. Neither may be confused with the other. */
const identity = {
  orbitId: 'me', publicKeyHex: 'pk', privateKeyHex: 'sk',
  encryptionPubHex: 'ep', encryptionPrivHex: 'es',
} as never
const PEER = { orbitId: 'peer', name: 'Peer' }
const AT = 1_700_000_000_000

const own = (id: string, courierStatus?: ChatMessage['courierStatus']): ChatMessage => ({
  id, senderId: 'me', senderName: 'Me', text: `body ${id}`,
  timestamp: AT, ...(courierStatus ? { courierStatus } : {}),
})

function renderThread(messages: ChatMessage[], onDeleteMessage = vi.fn(), onDeleteForEveryone = vi.fn()) {
  render(
    <GMatchDMs
      identity={identity}
      activePmPeer={PEER}
      peers={[PEER]}
      profilePics={{}}
      onSelectPeer={vi.fn()}
      pmMessages={messages}
      onDeleteMessage={onDeleteMessage}
      onDeleteForEveryone={onDeleteForEveryone}
    />,
  )
  return { onDeleteMessage, onDeleteForEveryone }
}

describe('DM cancel affordance', () => {
  it('cancels a pending send locally without announcing a deletion', () => {
    const { onDeleteMessage, onDeleteForEveryone } = renderThread([own('pending', 'sending')])
    screen.getByRole('button', { name: 'Cancel send' }).click()
    expect(onDeleteMessage).toHaveBeenCalledWith('pending', 'peer')
    expect(onDeleteForEveryone).not.toHaveBeenCalled()
  })

  it('tombstones a sent message for everyone instead of silently removing it', () => {
    const { onDeleteMessage, onDeleteForEveryone } = renderThread([own('sent', 'delivered')])
    screen.getByRole('button', { name: 'Delete for everyone' }).click()
    expect(onDeleteForEveryone).toHaveBeenCalledWith('peer', 'sent')
    expect(onDeleteMessage).not.toHaveBeenCalled()
  })
})
