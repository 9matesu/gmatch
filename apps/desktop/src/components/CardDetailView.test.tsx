// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrbitIdentity } from '@orbit/crypto'

vi.mock('../utils/api', () => ({ orbitFetch: vi.fn() }))
vi.mock('../utils/sounds', () => ({ playPress: vi.fn() }))
vi.mock('./ObjectImage', () => ({ ObjectImage: ({ alt }: { alt?: string }) => <img alt={alt || 'card'} /> }))

import { orbitFetch } from '../utils/api'
import { CardDetailView } from './CardDetailView'

const identity = { orbitId: 'me-1' } as OrbitIdentity
const card = {
  id: 'c-1', creatorId: 'me-1', ownerId: 'me-1', mediaObjectId: 'm-1',
  name: 'Card One', rarity: 'gold', value: 1000, likeCount: 0,
  marketStatus: 'none', moderationState: 'active',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

const json = (v: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => v }) as unknown as Response

function mockFetch(handlers: Record<string, () => Response> = {}) {
  vi.mocked(orbitFetch).mockImplementation(async (url: string) => {
    for (const [pattern, fn] of Object.entries(handlers)) {
      if (url.includes(pattern)) return fn()
    }
    if (url.includes('/api/cards/c-1/history')) return json({ history: [] })
    if (url.includes('/api/cards/c-1')) return json({ card })
    if (url.includes('/api/economy/cashout-rate')) return json({ rate_bps: 5000 })
    if (url.includes('/api/users')) return json([{ id: 'bob', display_name: 'Bob', online: true }])
    return json({})
  })
}

beforeEach(() => mockFetch())

describe('CardDetailView marketplace actions (P3.1–3.3)', () => {
  it('lists for sale: POSTs /api/cards/:id/list with the price, no coming-soon toast', async () => {
    const toast = vi.fn()
    render(<CardDetailView cardId="c-1" identity={identity} onClose={() => {}} toast={toast} />)
    const input = await screen.findByRole('spinbutton', { name: /list price/i })
    await userEvent.type(input, '500')
    await userEvent.click(screen.getByRole('button', { name: /list for sale/i }))
    await waitFor(() => {
      expect(orbitFetch).toHaveBeenCalledWith(
        '/api/cards/c-1/list',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ price: 500 }) }),
        identity,
      )
    })
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/listed/i), 'success')
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/coming soon/i), expect.anything())
  })

  it('cancel listing: POSTs /api/cards/:id/cancel', async () => {
    mockFetch({ '/api/cards/c-1': () => json({ card: { ...card, marketStatus: 'listed' } }) })
    render(<CardDetailView cardId="c-1" identity={identity} onClose={() => {}} toast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /cancel listing/i }))
    await waitFor(() => {
      expect(orbitFetch).toHaveBeenCalledWith(
        '/api/cards/c-1/cancel',
        expect.objectContaining({ method: 'POST' }),
        identity,
      )
    })
  })

  it('buy: non-owner sees market price and POSTs /api/cards/:id/buy with idempotency key', async () => {
    mockFetch({
      '/api/cards/c-1': () => json({ card: { ...card, ownerId: 'bob', creatorId: 'bob', marketStatus: 'listed' } }),
      '/api/cards/market': () => json({ listings: [{ listingId: 'l-1', cardId: 'c-1', price: 750, sellerId: 'bob', listedAt: '2026-01-01T00:00:00Z' }] }),
    })
    const toast = vi.fn()
    render(<CardDetailView cardId="c-1" identity={identity} onClose={() => {}} toast={toast} />)
    const buy = await screen.findByRole('button', { name: /buy now/i })
    await userEvent.click(buy)
    await waitFor(() => {
      expect(orbitFetch).toHaveBeenCalledWith(
        '/api/cards/c-1/buy',
        expect.objectContaining({ method: 'POST', body: expect.stringMatching(/idempotency_key/) }),
        identity,
      )
    })
  })

  it('owners get list/cancel/cash-out — no transfer picker anymore', async () => {
    render(<CardDetailView cardId="c-1" identity={identity} onClose={() => {}} toast={vi.fn()} />)
    await screen.findByRole('button', { name: /list for sale/i })
    expect(screen.queryByRole('button', { name: /^transfer$/i })).toBeNull()
  })

  it('server error surfaces an error toast and does NOT fake success', async () => {
    mockFetch({ '/list': () => json({ error: 'you do not own this card' }, false) })
    const toast = vi.fn()
    render(<CardDetailView cardId="c-1" identity={identity} onClose={() => {}} toast={toast} />)
    const input = await screen.findByRole('spinbutton', { name: /list price/i })
    await userEvent.type(input, '500')
    await userEvent.click(screen.getByRole('button', { name: /list for sale/i }))
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not allowed|do not own/i), 'error')
    })
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/listed/i), 'success')
  })
})
