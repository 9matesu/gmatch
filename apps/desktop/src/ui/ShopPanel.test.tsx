// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShopPanel from './ShopPanel'
import { useGame } from '../game/store'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
}))

describe('ShopPanel category separation tags (REAL / HENTAI)', () => {
  it('renders REAL and HENTAI category tags above all tags', () => {
    useGame.setState({ allowReal: true, allowHentai: true, tags: [] })
    render(<ShopPanel onClose={() => {}} />)

    const realBtn = screen.getByRole('button', { name: /real/i })
    const hentaiBtn = screen.getByRole('button', { name: /hentai/i })
    expect(realBtn).toBeInTheDocument()
    expect(hentaiBtn).toBeInTheDocument()
    expect(screen.getByText('Feed Pool')).toBeInTheDocument()
  })

  it('clicking REAL and HENTAI toggles their active states in the game store', async () => {
    useGame.setState({ allowReal: true, allowHentai: true, tags: [] })
    render(<ShopPanel onClose={() => {}} />)

    const realBtn = screen.getByRole('button', { name: /real/i })
    await userEvent.click(realBtn)
    expect(useGame.getState().allowReal).toBe(false)
    expect(useGame.getState().allowHentai).toBe(true)

    const hentaiBtn = screen.getByRole('button', { name: /hentai/i })
    // With real disabled, clicking hentai should preserve hentai (cannot disable both)
    await userEvent.click(hentaiBtn)
    expect(useGame.getState().allowHentai).toBe(true)

    // Re-enable real
    await userEvent.click(realBtn)
    expect(useGame.getState().allowReal).toBe(true)
  })
})
