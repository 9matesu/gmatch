// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { RARITY_TIERS } from '@orbit/shared'

vi.mock('react-holo-card-effect/dist/index.js', () => ({
  HoloCard: ({ url, children }: { url: string; children?: ReactNode }) => (
    <div data-testid="holo" data-url={url}>{children}</div>
  ),
}))
vi.mock('../../hooks/useObjectImage', () => ({ useObjectImage: vi.fn() }))

import { useObjectImage } from '../../hooks/useObjectImage'
import { GameCard } from './GameCard'

const identity = { orbitId: 'me-1', publicKeyHex: 'p', privateKeyHex: 'k' } as never
const result = (over: Record<string, unknown> = {}) => ({
  url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false,
  ...over,
}) as never

describe('GameCard (one premium TCG card)', () => {
  it('builds a real card: embossed title, rarity gem, stat row and rarity frame', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    const { container } = render(<GameCard objectId="m-1" identity={identity} width={150} height={210} name="Dragon" value={2500} />)
    expect(screen.getByText('Dragon')).toBeTruthy()
    expect(screen.getByText(RARITY_TIERS.gold.label)).toBeTruthy()
    const card = container.querySelector('[data-card]') as HTMLElement
    expect(card.getAttribute('data-rarity')).toBe('gold')
    // Rarity colour is runtime card data, never a second palette in the source.
    expect(card.style.getPropertyValue('--card-accent')).toBe(RARITY_TIERS.gold.accentColor)
    expect(card.querySelector('.tcg-title-plate')).toBeTruthy()
    expect(card.querySelector('.tcg-art-window')).toBeTruthy()
    expect(card.querySelector('.tcg-foil')).toBeTruthy()
    expect(screen.getByText('Value')).toBeTruthy()
    expect(screen.getAllByText(/g\$ 2,500/).length).toBeGreaterThan(0)
  })

  it('derives the rarity from the value when none is given', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    render(<GameCard objectId="m-1" identity={identity} width={150} height={210} value={6000} />)
    expect(screen.getByText(RARITY_TIERS.diamond.label)).toBeTruthy()
  })

  it('shows an empty stat, not a zero value, for a card with no value', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    const { container } = render(<GameCard objectId="m-1" identity={identity} width={150} height={210} name="Plain" />)
    expect(container.textContent).not.toMatch(/g\$ 0/)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Plain')).toBeTruthy()
  })

  it('keeps the Pokemon HoloCard art surface (signed bytes resolved)', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    render(<GameCard objectId="m-1" identity={identity} width={150} height={210} name="X" />)
    expect(screen.getByTestId('holo').getAttribute('data-url')).toBe('blob:image')
  })

  it('uses the direct snapshot URL leg when signed bytes have no url yet', () => {
    vi.mocked(useObjectImage).mockReturnValue(result())
    render(<GameCard objectId="m-1" src="https://example.test/art.png" identity={identity} width={150} height={210} name="X" />)
    expect(screen.getByTestId('holo').getAttribute('data-url')).toBe('https://example.test/art.png')
    expect(screen.queryByRole('status', { name: /card back/i })).toBeNull()
  })

  it('paints the card-back texture when no bytes exist anywhere', () => {
    vi.mocked(useObjectImage).mockReturnValue(result())
    const { container } = render(<GameCard objectId="m-1" identity={identity} width={150} height={210} name="X" />)
    const card = container.querySelector('[data-card]') as HTMLElement
    expect(card.getAttribute('data-card-back')).toBe('')
    expect(card.querySelector('.tcg-card-back')).toBeTruthy()
    expect(screen.getByRole('status', { name: /card back/i })).toBeTruthy()
    expect(screen.queryByTestId('holo')).toBeNull()
  })

  it('paints surface children over the art (zoom, stamps)', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    render(
      <GameCard objectId="m-1" identity={identity} width={150} height={210} name="X">
        <span>Zoom</span>
      </GameCard>,
    )
    expect(screen.getByText('Zoom')).toBeTruthy()
  })

  it('shows the small clicker! badge only when the card came from the clicker', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    const { container, rerender } = render(
      <GameCard objectId="m-1" identity={identity} width={150} height={210} name="X" clicker />,
    )
    const badge = container.querySelector('[data-clicker-badge]') as HTMLElement
    expect(badge).toBeTruthy()
    expect(badge).toHaveTextContent('clicker!')
    rerender(<GameCard objectId="m-1" identity={identity} width={150} height={210} name="X" />)
    expect(container.querySelector('[data-clicker-badge]')).toBeNull()
  })
})
