// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import * as api from '../utils/api'
import { CHROME } from '../ui/tokens'
import { StoreTab } from './StoreTab'

vi.mock('./ObjectImage', () => ({ ObjectImage: () => null }))
vi.mock('../ui/format', () => ({ formatCount: (n: number) => String(n) }))
vi.mock('react-holo-card-effect/dist/index.js', () => ({
  HoloCard: ({ children }: { children?: ReactNode }) => <div data-testid="holo">{children}</div>,
}))
vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: () => ({ url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false }),
}))

const identity = { orbitId: 'me-1', privateKeyHex: 'k', publicKeyHex: 'p' } as never

/**
 * The store credits card owners, and the whole shop reads from THREE real
 * sources — the shared gear catalogue, the node's community listings and the
 * player's own canonical cards. These lock the client half: it must fold them
 * into one grid, print the seller name the server resolved, and never fall back
 * to the local `users` roster (capped at 100 rows and 24h-filtered, so it cannot
 * name a stranger).
 */
function mockApi(cards: unknown[], listings: unknown[], items: unknown[] = []) {
  return (url: string) => {
    if (url.startsWith('/api/cards/market')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ listings }) } as Response)
    }
    if (url.startsWith('/api/cards')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards }) } as Response)
    }
    if (url.startsWith('/api/users/store/items')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) } as Response)
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

const gearItem = {
  id: 'item-flash-drop',
  name: 'Flash Drop Broadcast',
  desc: 'Instantly broadcasts your chosen photo.',
  category: 'hack',
  cost: 1000,
  icon: 'Zap',
  badge: 'ABILITY',
  consumable: true,
}

describe('StoreTab shop floor', () => {
  beforeEach(() => {
    // Node 22's experimental `localStorage` global shadows jsdom's, so a bare
    // `localStorage` is undefined here — the same reason AgeGateModal.test.tsx
    // stubs it. The store reads/writes the scoped key through this global.
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    } as Storage)
    vi.restoreAllMocks()
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('prints the seller name on a market listing', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open profile of Ada' })).toBeTruthy()
    // The profile link is a SIBLING of the buy/quick-view controls: a button
    // inside a button is invalid HTML and React warns about it on hydration.
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
    // Own listing is not buyable.
    expect(screen.getByText('Yours')).toBeTruthy()
  })

  it('credits a stranger on a collection card using the server-resolved name', async () => {
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
    expect(screen.getByRole('heading', { name: 'Store' })).toBeTruthy()
    // One asking price per product, and the real buy path is still wired.
    expect(screen.getByText('g$ 500')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Buy' })).toBeTruthy()
    // The collection route lives on the shop floor, not buried in a dashboard.
    fireEvent.click(screen.getByRole('button', { name: 'View collection' }))
    expect(onOpenCardCollection).toHaveBeenCalledOnce()
  })

  it('shows gear from the shared catalogue and filters the grid by category', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([{ ...marketCard(), marketStatus: 'none', ownerId: 'me-1' }], [], [gearItem]) as never,
    )

    render(<StoreTab points={5000} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Flash Drop Broadcast')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    // The Community chip shows only market listings (none in this fixture),
    // so both the gear and the collection card are hidden.
    fireEvent.click(screen.getByRole('button', { name: /^Community/ }))
    expect(screen.queryByText('Flash Drop Broadcast')).toBeNull()
    expect(screen.queryByText('Rare Find')).toBeNull()

    // Collection shows the player's own card, not the gear.
    fireEvent.click(screen.getByRole('button', { name: /^Collection/ }))
    expect(screen.getByText('Rare Find')).toBeTruthy()
    expect(screen.queryByText('Flash Drop Broadcast')).toBeNull()

    // Gear shows the shop item, not the card.
    fireEvent.click(screen.getByRole('button', { name: /^Gear/ }))
    expect(screen.getByText('Flash Drop Broadcast')).toBeTruthy()
    expect(screen.queryByText('Rare Find')).toBeNull()
  })

  it('filters the grid by the search query', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi(
        [{ ...marketCard(), id: 'card-d', name: 'Delta', marketStatus: 'none', ownerId: 'me-1' }],
        [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }],
      ) as never,
    )

    render(<StoreTab points={1000} identity={identity} />)

    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search the store'), { target: { value: 'delta' } })
    expect(screen.getByText('Delta')).toBeTruthy()
    expect(screen.queryByText('Rare Find')).toBeNull()
  })

  it('toggles a wishlist entry and persists it under the identity scope', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    const heart = screen.getByRole('button', { name: 'Add Rare Find to wishlist' })
    expect(heart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(heart)
    expect(screen.getByRole('button', { name: 'Remove Rare Find from wishlist' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('gmatch_store_wishlist_v1:me-1')).toContain('market:l1')
  })

  it('opens a quick view from a tile and records it in Recently viewed', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    expect(screen.queryByText('Recently viewed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rare Find' }))
    expect(screen.getByText('Recently viewed')).toBeTruthy()
    // The sheet carries the honest buy price.
    expect(screen.getByRole('button', { name: 'Buy for g$ 500' })).toBeTruthy()
  })

  it('lays the shop out as one dense, aligned tile grid (density contract)', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi(
        [{ ...marketCard(), id: 'card-x', name: 'X', marketStatus: 'none', ownerId: 'me-1' }],
        [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }],
        [gearItem],
      ) as never,
    )

    render(<StoreTab points={5000} identity={identity} />)
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    const grid = screen.getByTestId('store-grid')
    // A real CSS grid with equal columns (aligned tiles), never a flex sprawl.
    expect(grid.className).toMatch(/\bgrid\b/)
    expect(grid.className).toMatch(/grid-cols-/)
    // No horizontal overflow: the grid never forces a min-width wider than its track.
    expect(grid.className).not.toMatch(/min-w-\[/)
    // Tiles stretch to equal height so the footer actions line up.
    expect(grid.className).toMatch(/items-stretch/)
  })

  it('uses the raised card recipe on products and a compact, non-glass search', async () => {
    vi.spyOn(api, 'orbitFetch').mockImplementation(
      mockApi([], [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }]) as never,
    )

    render(<StoreTab points={100} identity={identity} />)
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    // Search is one compact line (chat's py-1.5), with readable placeholder.
    const search = screen.getByLabelText('Search the store')
    const shell = Array.from(search.parentElement!.classList)
    expect(shell).toContain('py-1.5')
    expect(shell).not.toContain('py-2')
    expect(shell.some((c) => c.startsWith('bg-glass-'))).toBe(false)
    expect(search.className).toContain('placeholder:text-retro-muted')

    // One card recipe, reused: the raised plate, never a translucent glass tier.
    const tiles = screen.getByTestId('store-grid').querySelectorAll('article')
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) {
      const card = Array.from(tile.classList)
      for (const token of CHROME.tile.split(' ')) expect(card).toContain(token)
      expect(card.some((c) => c.startsWith('bg-glass-'))).toBe(false)
    }
  })

  it('reports an honest network error when a market buy cannot reach the node', async () => {
    const toast = vi.fn()
    vi.spyOn(api, 'orbitFetch').mockImplementation(((url: string) => {
      if (url.startsWith('/api/cards/market')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ listings: [{ listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', card: marketCard() }] }) } as Response)
      }
      if (url.startsWith('/api/users/store/items')) {
        // Empty gear so the market tile is the only thing with a Buy button.
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) } as Response)
      }
      if (url.endsWith('/buy')) return Promise.reject(new Error('boom'))
      if (url.startsWith('/api/cards')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [] }) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    }) as never)

    render(<StoreTab points={1000} identity={identity} toast={toast} />)
    await waitFor(() => expect(screen.getByText('Rare Find')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Buy' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Network error while buying', 'error'))
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
