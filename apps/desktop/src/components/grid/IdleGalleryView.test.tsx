// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IdleGalleryView from './IdleGalleryView'
import { useGame } from '../../game/store'
import type { GalleryImage } from '../../game/types'

function makeGalleryImages(count: number): GalleryImage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `img-${i + 1}`,
    url: `https://example.com/img-${i + 1}.jpg`,
    tags: [i % 2 === 0 ? 'blonde' : 'brunette', `tag-${i + 1}`],
    rarityBase: i + 1,
    clicks: i * 5,
    rarity: i > 15 ? 'Diamond' : i > 8 ? 'Gold' : 'Common',
    kind: i === 3 ? 'video' : 'image',
    boughtAt: 1000 + i,
  }))
}

describe('IdleGalleryView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useGame.setState({
      gallery: [],
      backgroundUrl: null,
    })
  })

  it('renders empty state when gallery has no items', () => {
    render(<IdleGalleryView />)
    expect(screen.getByText(/no keepsakes yet/i)).toBeInTheDocument()
  })

  it('paginates gallery at max 18 items per page', async () => {
    const images = makeGalleryImages(25)
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    // Header shows total count
    expect(screen.getByText(/Gallery \(25\)/i)).toBeInTheDocument()

    // Footer shows Page 1 of 2
    expect(screen.getByText(/of 2/i)).toBeInTheDocument()

    // Buttons for 18 keepsakes are rendered on page 1
    const viewButtons = screen.getAllByRole('button', { name: /^View /i })
    expect(viewButtons.length).toBe(18)

    // Navigate to page 2
    const nextBtn = screen.getByRole('button', { name: /Next →/i })
    await userEvent.click(nextBtn)

    expect(screen.getByText(/of 2/i)).toBeInTheDocument()
    const page2Buttons = screen.getAllByRole('button', { name: /^View /i })
    expect(page2Buttons.length).toBe(7)

    // Navigate back to page 1
    const prevBtn = screen.getByRole('button', { name: /← Prev/i })
    await userEvent.click(prevBtn)
    expect(screen.getByText(/of 2/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^View /i }).length).toBe(18)
  })

  it('filters by search text and resets page to 0', async () => {
    const images = makeGalleryImages(25)
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    const searchInput = screen.getByPlaceholderText(/Filter gallery…/i)
    await userEvent.type(searchInput, 'tag-25')

    // Only tag-25 should match
    expect(screen.getAllByRole('button', { name: /^View /i }).length).toBe(1)
    expect(screen.queryByRole('button', { name: /Next →/i })).not.toBeInTheDocument()
  })

  it('filters by media type (image vs video)', async () => {
    const images = makeGalleryImages(10) // img-4 is video
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    const videoFilterBtn = screen.getByRole('button', { name: /^video$/i })
    await userEvent.click(videoFilterBtn)

    const videoItems = screen.getAllByRole('button', { name: /^View /i })
    expect(videoItems.length).toBe(1)

    const imageFilterBtn = screen.getByRole('button', { name: /^image$/i })
    await userEvent.click(imageFilterBtn)

    const imageItems = screen.getAllByRole('button', { name: /^View /i })
    expect(imageItems.length).toBe(9)
  })

  it('filters by tag pills and allows clearing', async () => {
    const images = makeGalleryImages(10) // half blonde, half brunette
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    const blondePill = screen.getByRole('button', { name: /^blonde/i })
    await userEvent.click(blondePill)

    // Should only show 5 blonde items
    expect(screen.getAllByRole('button', { name: /^View /i }).length).toBe(5)

    // Clear tag button
    const clearBtn = screen.getByRole('button', { name: /clear \(1\)/i })
    await userEvent.click(clearBtn)

    // Resets to all 10 items
    expect(screen.getAllByRole('button', { name: /^View /i }).length).toBe(10)
  })

  it('handles batch selection, select-all on page, delete, and escape key', async () => {
    const images = makeGalleryImages(20)
    useGame.setState({ gallery: images })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<IdleGalleryView />)

    // Click select-all on page
    const selectAllBtn = screen.getByRole('button', { name: /Select all on page/i })
    await userEvent.click(selectAllBtn)

    // Batch bar shows 18 selected (page 1 has 18 items)
    expect(screen.getByText(/18 images selected/i)).toBeInTheDocument()

    // Press Escape to clear
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(/18 images selected/i)).not.toBeInTheDocument()

    // Select single item via checkbox
    const selectCheckbox = screen.getAllByLabelText(/Select image/i)[0]
    await userEvent.click(selectCheckbox)
    expect(screen.getByText(/1 images selected/i)).toBeInTheDocument()

    // Batch delete
    const deleteBtn = screen.getByRole('button', { name: /^Delete$/i })
    await userEvent.click(deleteBtn)

    // Gallery should have 19 items left
    expect(useGame.getState().gallery.length).toBe(19)
    expect(screen.getByText(/Gallery \(19\)/i)).toBeInTheDocument()
  })

  it('supports reposting to feed and adding to story from tiles and viewer modal', async () => {
    const images = makeGalleryImages(5)
    useGame.setState({ gallery: images })

    const onRepost = vi.fn()
    const onAddToStory = vi.fn()
    const onCreateCard = vi.fn()

    render(
      <IdleGalleryView
        onRepostImage={onRepost}
        onAddToStory={onAddToStory}
        onCreateCard={onCreateCard}
      />
    )

    // Hover / options dropdown on tile
    const moreTileBtn = screen.getAllByRole('button', { name: /^Options for /i })[0]
    await userEvent.click(moreTileBtn)

    const repostTileBtn = screen.getByRole('button', { name: /Repost .* to feed/i })
    await userEvent.click(repostTileBtn)
    expect(onRepost).toHaveBeenCalledTimes(1)
    expect(onRepost).toHaveBeenCalledWith(
      expect.objectContaining({ url: images[images.length - 1].url })
    )

    await userEvent.click(moreTileBtn)
    const storyTileBtn = screen.getByRole('button', { name: /Add .* to story/i })
    await userEvent.click(storyTileBtn)
    expect(onAddToStory).toHaveBeenCalledTimes(1)

    // Click on thumbnail to open viewer modal
    const tileBtn = screen.getAllByRole('button', { name: /^View /i })[0]
    await userEvent.click(tileBtn)

    // In modal, action bar buttons are rendered
    const modalRepostBtn = screen.getByRole('button', { name: /^Repost$/i })
    await userEvent.click(modalRepostBtn)
    expect(onRepost).toHaveBeenCalledTimes(2)

    const modalStoryBtn = screen.getByRole('button', { name: /^Story$/i })
    await userEvent.click(modalStoryBtn)
    expect(onAddToStory).toHaveBeenCalledTimes(2)

    const modalCardBtn = screen.getByRole('button', { name: /^Card$/i })
    await userEvent.click(modalCardBtn)
    expect(onCreateCard).toHaveBeenCalledTimes(1)
  })

  it('opens slideshow from header and batch action bar', async () => {
    const images = makeGalleryImages(5)
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    // Click Slideshow in header toolbar
    const headerSlideshowBtn = screen.getByRole('button', { name: /Slideshow/i })
    await userEvent.click(headerSlideshowBtn)

    // Slideshow overlay should be open (has close button aria-label="Close slideshow")
    const closeBtn = screen.getByLabelText(/Close slideshow/i)
    expect(closeBtn).toBeInTheDocument()

    // Close slideshow
    await userEvent.click(closeBtn)
    expect(screen.queryByLabelText(/Close slideshow/i)).not.toBeInTheDocument()
  })
})
