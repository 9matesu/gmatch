// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueueControls, type QueueControlsProps } from './QueueControls'
import { MIN_GAME_CARDS } from '@orbit/shared'

function props(over: Record<string, unknown> = {}): QueueControlsProps {
  return {
    state: null,
    match: null,
    matchRoundInfo: null,
    autoQueueEnabled: false,
    soundEnabled: false,
    queuedSinceMs: 0,
    showLeagueTab: false,
    onToggleAutoQueue: async () => ({ ok: true }),
    onShowLeagueTab: () => {},
    toast: () => {},
    now: Date.now(),
    ...over,
  } as unknown as QueueControlsProps
}

describe('QueueControls', () => {
  it('shows a disabled Quick Play grouped with an enabled Build Deck when under threshold', () => {
    render(<QueueControls {...props({ myCardsCount: MIN_GAME_CARDS - 1, onOpenDeckBuilder: vi.fn() })} />)
    const quick = screen.getByRole('button', { name: /quick play/i })
    expect(quick).toBeDisabled()
    const build = screen.getByRole('button', { name: /build deck/i })
    expect(build).toBeEnabled()
    expect(build).toHaveTextContent(`${MIN_GAME_CARDS - 1}/${MIN_GAME_CARDS}`)
  })

  it('shows an enabled queue button once the deck threshold is met', () => {
    render(<QueueControls {...props({ myCardsCount: MIN_GAME_CARDS })} />)
    expect(screen.queryByRole('button', { name: /quick play/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /queue for perverts/i })).toBeEnabled()
  })
})
