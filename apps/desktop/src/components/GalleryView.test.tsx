// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GalleryView, type GalleryViewProps } from './GalleryView'
import type { OrbitObject, User } from '@orbit/shared'
import type { OrbitIdentity } from '@orbit/crypto'

function makeTestCards(count: number): OrbitObject[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i + 1}`,
    owner_id: 'user-1',
    content_url: `https://example.com/card-${i + 1}.jpg`,
    created_at: new Date(2026, 0, i + 1).toISOString(),
    caption: `Card ${i + 1}`,
    tags: [i % 2 === 0 ? 'cyber' : 'retro', `tag-${i + 1}`],
  } as unknown as OrbitObject))
}

const mockIdentity = { orbitId: 'user-1' } as OrbitIdentity

describe('GalleryView cards pagination and tag filtering', () => {
  it('paginates cards at max 18 items per page and respects tag filter pagination', async () => {
    const allCards = makeTestCards(25) // 13 cyber, 12 retro
    const paginatedItems = allCards.slice(0, 18)

    const setGalleryPage = vi.fn()
    const setSelectedGalleryIds = vi.fn()

    const props: GalleryViewProps = {
      filteredItems: allCards,
      itemsLoading: false,
      galleryFilter: 'all',
      setGalleryFilter: vi.fn(),
      gallerySort: 'newest',
      setGallerySort: vi.fn(),
      cardSearch: '',
      setCardSearch: vi.fn(),
      cardTypeFilter: 'all',
      setCardTypeFilter: vi.fn(),
      galleryPage: 0,
      setGalleryPage,
      selectedGalleryIds: new Set(),
      setSelectedGalleryIds,
      totalPages: 2,
      paginatedItems,
      batchDownloading: false,
      handleDownloadAll: vi.fn(),
      handleBatchDownload: vi.fn(),
      handleBatchDelete: vi.fn(),
      dragActive: false,
      setDragActive: vi.fn(),
      dragAnchorId: null,
      setDragAnchorId: vi.fn(),
      users: [] as User[],
      identity: mockIdentity,
      setExpandedItemId: vi.fn(),
    }

    render(<GalleryView {...props} />)

    // Collection title shows 25
    expect(screen.getByText(/Cards Collection \(25\)/i)).toBeInTheDocument()

    // The top tags 'cyber' and 'retro' are rendered as filter pills
    expect(screen.getAllByRole('button', { name: /^cyber|^retro/i })).toHaveLength(2)

    // Select all on page button is rendered
    expect(screen.getByRole('button', { name: /Select all on page/i })).toBeInTheDocument()

    // Click cyber tag pill
    const cyberTag = screen.getByRole('button', { name: /^cyber/i })
    await userEvent.click(cyberTag)

    // setGalleryPage should be called with 0
    expect(setGalleryPage).toHaveBeenCalledWith(0)
  })
})
