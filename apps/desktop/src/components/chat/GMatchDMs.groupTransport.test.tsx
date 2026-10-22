// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'

/**
 * The group chat says WHERE its words travel. A sealed room rides the
 * courier (the node cannot read it); a group without a room still lives on
 * the node, and the UI says that instead of implying encryption.
 */
const identity = {
  orbitId: 'me',
  publicKeyHex: 'pk',
  privateKeyHex: 'sk',
  encryptionPubHex: 'ep',
  encryptionPrivHex: 'es',
} as never

type Overrides = Parameters<typeof GMatchDMs>[0]

function baseProps(overrides: Partial<Overrides> = {}): Overrides {
  return {
    identity,
    activePmPeer: { orbitId: 'peer', name: 'Peer' },
    peers: [{ orbitId: 'peer', name: 'Peer' }],
    profilePics: {},
    onSelectPeer: vi.fn(),
    ...overrides,
  }
}

const GROUP = { id: 'g1', name: 'Crew', owner_id: 'peer', member_count: 3, is_member: 1 }

describe('group chat transport', () => {
  it('says the conversation is sealed when the group rides a room', () => {
    render(
      <GMatchDMs
        {...baseProps({
          groups: [{ ...GROUP, transport: 'sealed' }],
          activeGroupId: 'g1',
          groupMessages: { g1: [] },
        })}
      />,
    )
    expect(screen.getByText(/sealed group chat/i)).toBeDefined()
    expect(screen.getByText(/end-to-end encrypted/i)).toBeDefined()
  })

  it('says the conversation is on the node when there is no room', () => {
    render(
      <GMatchDMs
        {...baseProps({
          groups: [{ ...GROUP, transport: 'node' }],
          activeGroupId: 'g1',
          groupMessages: { g1: [] },
        })}
      />,
    )
    expect(screen.getByText(/on this node/i)).toBeDefined()
    expect(screen.queryByText(/end-to-end encrypted/i)).toBeNull()
  })
})
