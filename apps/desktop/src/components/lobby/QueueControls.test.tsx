// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueueControls } from './QueueControls'

const base = {
  state: null, match: null, matchRoundInfo: null, autoQueueEnabled: false,
  soundEnabled: false, queuedSinceMs: 0, showLeagueTab: false,
  onToggleAutoQueue: vi.fn().mockResolvedValue({ ok: true }),
  onOpenCreateCard: vi.fn(), onOpenDeckBuilder: vi.fn(),
  onShowLeagueTab: vi.fn(), onOpenCardChat: vi.fn(),
  toast: vi.fn(), now: Date.now(),
} as const

describe('QueueControls deck gate', () => {
  it('without a chosen deck the queue action is a CTA into Deck Builder', () => {
    render(<QueueControls {...base} myCardsCount={5} hasActiveDeck={false} />)
    fireEvent.click(screen.getByText(/choose deck/i))
    expect(base.onOpenDeckBuilder).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /queue for/i })).toBeNull()
  })

  it('with a chosen deck, queueing joins the hopper', () => {
    render(<QueueControls {...base} myCardsCount={5} hasActiveDeck={true} />)
    fireEvent.click(screen.getByRole('button', { name: /queue/i }))
    expect(base.onToggleAutoQueue).toHaveBeenCalledWith(true)
  })

  it('a too-small library still offers Build Deck (count CTA)', () => {
    render(<QueueControls {...base} myCardsCount={2} hasActiveDeck={false} />)
    expect(screen.getByText(/2\/5/)).toBeInTheDocument()
  })
})
