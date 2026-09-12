// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GamesHub } from './GamesHub'

// The Arena pills are controlled: the parent owns the tab (GamesView remounts
// per sub-tab), GamesHub reports clicks via onSubTabChange. Local state here
// was the source-fight introduced by 08aa78b.
describe('GamesHub arena pills (controlled)', () => {
  it('clicking a pill calls onSubTabChange, never holds its own tab state', () => {
    const onSubTabChange = vi.fn()
    render(
      <GamesHub
        identity={null}
        subTab="duel"
        onSubTabChange={onSubTabChange}
        renderDuelContent={() => null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rankings' }))
    expect(onSubTabChange).toHaveBeenCalledWith('ranks')
  })
})
