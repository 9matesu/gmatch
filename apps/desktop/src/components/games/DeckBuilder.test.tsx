// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { deck, cardTileProps, orbitFetch } = vi.hoisted(() => ({
  deck: {
    id: 'd1', ownerId: 'u1', name: 'Test', gameId: 'card-duel', cards: ['c1'],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  },
  cardTileProps: [] as any[],
  orbitFetch: vi.fn(),
}))

vi.mock('../../utils/api', () => ({ orbitFetch }))
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('../home/CardTile', () => ({
  CardTile: (props: any) => {
    cardTileProps.push(props)
    return <div data-testid="card-tile">{props.item.id}</div>
  },
}))

import { DeckBuilder } from './DeckBuilder'

const identity = { orbitId: 'u1', publicKeyHex: 'pub', privateKeyHex: 'priv' }
const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))

const cards = [
  { id: 'm1', card_id: 'c1', owner_id: 'u1', size_bytes: 1, mime_type: 'image/jpeg', created_at: deck.createdAt },
  { id: 'm2', card_id: 'c2', owner_id: 'u1', size_bytes: 1, mime_type: 'image/jpeg', created_at: deck.createdAt },
]

describe('DeckBuilder', () => {
  beforeEach(() => {
    cardTileProps.length = 0
    orbitFetch.mockReset()
    orbitFetch.mockImplementation(() => json({ decks: [deck] }))
  })

  function renderBuilder() {
    return render(
      // @ts-expect-error test fixtures are structurally compatible
      <DeckBuilder identity={identity} cards={cards} toast={vi.fn()} />,
    )
  }

  it('auto-opens the single deck and passes identity to CardTile so signed images load', async () => {
    renderBuilder()
    await waitFor(() => expect(screen.getAllByTestId('card-tile').length).toBeGreaterThan(0))
    expect(cardTileProps[0].identity).toBe(identity)
  })
})
