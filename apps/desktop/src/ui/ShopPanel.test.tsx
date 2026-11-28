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
    render(<ShopPanel />)

    const realBtn = screen.getByRole('button', { name: /real/i })
    const hentaiBtn = screen.getByRole('button', { name: /hentai/i })
    expect(realBtn).toBeInTheDocument()
    expect(hentaiBtn).toBeInTheDocument()
    expect(screen.getByText('Feed Pool')).toBeInTheDocument()
  })

  it('clicking REAL and HENTAI toggles their active states in the game store', async () => {
    useGame.setState({ allowReal: true, allowHentai: true, tags: [] })
    render(<ShopPanel />)

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

  it('keeps the custom tag box a compact single-line field', async () => {
    useGame.setState({ allowReal: true, allowHentai: true, tags: [] })
    render(<ShopPanel />)

    await userEvent.click(screen.getByRole('button', { name: /Add Tag/i }))
    const input = screen.getByLabelText('Search a custom tag')
    expect(input.tagName).toBe('INPUT')
    expect(input.className).toContain('py-1.5')
    expect(input.className).toContain('text-xs')
    expect(input.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)
  })

  it('renders an owned tag as sibling buttons, never a button inside a button', () => {
    useGame.setState({
      allowReal: true,
      allowHentai: true,
      points: 1000,
      tags: [{ name: 'gangbang', level: 1, base: 10, income: 1, weight: 1, selected: true }],
    })
    const { container } = render(<ShopPanel />)

    // The pill is a container with two REAL sibling buttons (the tag action
    // and its delete). Nesting a <button> in a <button> is invalid HTML and
    // React logs a hydration error for it — which the network guard treats as
    // a failure.
    expect(container.querySelector('button button')).toBeNull()
    expect(screen.getByRole('button', { name: 'gangbang' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete gangbang' })).toBeInTheDocument()
  })
})
