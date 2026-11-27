// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import * as api from '../utils/api'
import { StoreTab } from './StoreTab'

vi.mock('./ObjectImage', () => ({ ObjectImage: () => null }))
vi.mock('../ui/format', () => ({ formatCount: (n: number) => String(n) }))

const identity = { orbitId: 'me-1', privateKeyHex: 'k', publicKeyHex: 'p' } as never

/**
 * Store cards never credited their owner. Two causes, both fixed here:
 *  - the API's card queries never joined Users, so `ownerName` did not exist;
 *  - StoreTab typed the listing card as `any` and printed only name/rarity/price.
 *
 * The server supplies the name now, so these lock the client half: it must
 * PRINT it, and must never fall back to the local `users` roster (which is
 * capped at 100 rows and 24h-filtered, so it cannot name a stranger).
 */
function mockApi(cards: unknown[], listings: unknown[]) {
  return (url: string) => {
    if (url.startsWith('/api/cards/market')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ listings }) } as Response)
    }
    if (url.startsWith('/api/cards')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards }) } as Response)
    }
    if (url.startsWith('/api/users/store/items')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) } as Response)
    }
    if (url.startsWith('/api/economy/cashout-rate')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rateBps: 5000 }) } as Response)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }
}

const marketCard = (over: Record<string, unknown> = {}) => ({
  id: 'card-9',
  creatorId: 'creator-1',
  mediaObjectId: 'obj-9',
  name: 'Rare Find',
  tags: [],
  description: null,
  frame: 'chrome',
  accentColor: '#fff',
  rarity: 'gold',
  value: 900,
  likeCount: 0,
  marketStatus: 'listed',
  moderationState: 'active',
  ownerId: 'seller-1',
  ownerName: 'Ada',
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('StoreTab credits card owners', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the seller name on a market listing', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    // The seller is credited by name, and the control is labelled for a11y.
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open profile of Ada' })).toBeTruthy()
    // The profile link is a SIBLING of the view-card button: a button inside a
    // button is invalid HTML and React warns about it on hydration.
    expect(document.querySelector('button button')).toBeNull()
  })

  it('falls back to a readable handle when the owner has no display name', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [
        {
          listingId: 'l2',
          cardId: 'card-9',
          price: 500,
          sellerId: 'abcdef0123456789',
          card: marketCard({ ownerName: null }),
        },
      ]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    // Never an empty "by" with nothing after it.
    expect(screen.getByText('User_abcdef')).toBeTruthy()
  })

  it('labels your own listing "you" instead of crediting yourself', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi(
        [],
        [
          {
            listingId: 'l3',
            cardId: 'card-9',
            price: 500,
            sellerId: 'me-1',
            card: marketCard({ ownerId: 'me-1', ownerName: 'Me Myself' }),
          },
        ],
      ) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    expect(screen.getByText('you')).toBeTruthy()
    expect(screen.queryByText('Me Myself')).toBeNull()
  })

  it('credits a stranger on a portfolio row using the server-resolved name', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi(
        [{ ...marketCard(), marketStatus: 'none', ownerId: 'other-1', ownerName: 'Bo' }],
        [],
      ) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    expect(screen.getByText('by Bo')).toBeTruthy()
  })

  it('shows the shop floor with a clear price, a buy action and a collection route', async () => {
    const onOpenCardCollection = vi.fn()
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l-shop', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} onOpenCardCollection={onOpenCardCollection} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Community Market' })).toBeTruthy()
    // One asking price per product, and the real buy path is still wired.
    expect(screen.getByText('g$ 500')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Buy' })).toBeTruthy()
    // The collection route lives on the shop floor, not buried in a dashboard.
    fireEvent.click(screen.getByRole('button', { name: 'View collection' }))
    expect(onOpenCardCollection).toHaveBeenCalledOnce()
  })

  it('estimates cash-out value only for the cards cash-out-all actually pays', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi(
        [
          { ...marketCard(), id: 'card-a', name: 'Cashable', ownerId: 'me-1', marketStatus: 'none', value: 1000 },
          { ...marketCard(), id: 'card-b', name: 'Listed', ownerId: 'me-1', marketStatus: 'listed', value: 1000 },
        ],
        [],
      ) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    // 50% rate: only the unlisted card's 1000 is payable; 2000 would promise
    // money the confirm step explicitly skips.
    await waitFor(() => {
      const panel = screen.getByText('Cashout Value').parentElement
      expect(panel?.textContent).toContain('g$ 500')
      expect(panel?.textContent).not.toContain('g$ 1,000')
    })
  })
})
