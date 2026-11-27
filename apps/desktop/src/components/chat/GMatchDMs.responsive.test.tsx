// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'

/**
 * The chat shows ONE pane at a time on a phone.
 *
 * It used to render three fixed columns (list 240px + conversation + players
 * 240px) at every width, so a 390px viewport got 480px of chrome and the
 * composer was pushed off the right edge. The responsive rule follows the state
 * that already means "show me the list" (`listMode`) instead of inventing a
 * second one.
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
  } as Overrides
}

/** The three panes, by their accessible text. */
function panes() {
  const list = document.querySelector('div.w-full.md\\:w-60')
  const conversation = document.querySelector('div.flex-1.min-h-0.flex-col')
  const players = document.querySelector('div.hidden.md\\:flex.w-60')
  return {
    listClass: list?.className ?? '',
    conversationClass: conversation?.className ?? '',
    playersClass: players?.className ?? '',
  }
}

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

afterEach(() => {
  setWidth(1024)
  vi.restoreAllMocks()
})

describe('chat responsive panes', () => {
  it('on a phone, starts on the LIST with the conversation hidden', () => {
    setWidth(390)
    render(<GMatchDMs {...baseProps()} />)

    const p = panes()
    // List visible, conversation hidden.
    expect(p.listClass).toContain('flex')
    expect(p.listClass).not.toContain('hidden')
    expect(p.conversationClass).toContain('hidden')
    // Players column is desktop-only.
    expect(p.playersClass).toContain('hidden md:flex')
  })

  it('from md up, the list and the conversation are visible together', () => {
    setWidth(1024)
    render(<GMatchDMs {...baseProps()} />)

    const p = panes()
    // Both panes carry an md: escape hatch, so neither is hidden at desktop.
    expect(p.listClass).toContain('md:flex')
    expect(p.conversationClass).toContain('flex')
  })
})