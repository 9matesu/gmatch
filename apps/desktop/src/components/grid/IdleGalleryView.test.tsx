// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IdleGalleryView, { resolveGalleryTileUrl } from './IdleGalleryView'
import { useGame } from '../../game/store'
import type { GalleryImage } from '../../game/types'

vi.mock('../../utils/p2pSwarm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils/p2pSwarm')>()
  return { ...mod, getLocalObject: vi.fn(async () => null) }
})

let vaultMap: Record<string, string> = {}
vi.mock('../../services/vault', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/vault')>()
  return { ...mod, useVaultUrls: () => vaultMap, useVaultUrl: () => null }
})

// Ownership spies only: resolution stays real, so the tests assert when the
// component claims/releases a minted URL (the semantics live in keepsake.test).
vi.mock('../../services/keepsake', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/keepsake')>()
  return { ...mod, releaseLocalUrl: vi.fn(), retainLocalUrl: vi.fn() }
})

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
    vaultMap = {}
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

    const videoFilterBtn = screen.getByRole('button', { name: /^Filter: video$/i })
    await userEvent.click(videoFilterBtn)

    const videoItems = screen.getAllByRole('button', { name: /^View /i })
    expect(videoItems.length).toBe(1)

    const imageFilterBtn = screen.getByRole('button', { name: /^Filter: image$/i })
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

  it('carries video kind + mime when reposting a video keepsake', async () => {
    // jsdom has no media playback: stub play() so the viewer video mounts.
    const playStub = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: playStub,
    });
    const images = makeGalleryImages(5) // img-4 is video
    useGame.setState({ gallery: images })

    const onRepost = vi.fn()
    render(<IdleGalleryView onRepostImage={onRepost} />)

    // Open the viewer on the video tile (img-4 renders 2nd in desc order) and hit Repost there.
    const tileBtns = screen.getAllByRole('button', { name: /^View /i })
    await userEvent.click(tileBtns[1])
    const modalRepostBtn = screen.getByRole('button', { name: /^Repost$/i })
    await userEvent.click(modalRepostBtn)

    expect(onRepost).toHaveBeenCalledTimes(1)
    expect(onRepost).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'video', mimeType: 'video/mp4' })
    )
  })

  it('slideshow plays verified local bytes only (skips remote-only keeps)', async () => {
    const images = makeGalleryImages(5)
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)

    // Click Slideshow in header toolbar
    const headerSlideshowBtn = screen.getByRole('button', { name: /Slideshow/i })
    await userEvent.click(headerSlideshowBtn)

    // Nothing local: no overlay, explicit notice instead of remote playback.
    expect(screen.queryByLabelText(/Close slideshow/i)).not.toBeInTheDocument()
    expect(screen.getByText(/nothing local to play yet/i)).toBeInTheDocument()
  })

  it('viewer opens verified local bytes and gates Browser on local-only', async () => {
    const blob = new Blob(['local-bytes'], { type: 'image/jpeg' })
    URL.createObjectURL = vi.fn(() => 'blob:local-test')
    URL.revokeObjectURL = vi.fn()
    const { getLocalObject } = await import('../../utils/p2pSwarm')
    // IDB has bytes only for the verified keep.
    vi.mocked(getLocalObject).mockImplementation(async (id: string) =>
      id === 'https://provider/x.jpg' ? blob : null,
    )
    const images = [
      {
        id: 'k-local', url: 'https://provider/x.jpg', tags: ['e2e'], rarityBase: 1,
        clicks: 1, rarity: 'Common', boughtAt: 1, kind: 'image', localStatus: 'local',
      },
      {
        id: 'k-failed', url: 'https://provider/y.jpg', tags: ['e2e'], rarityBase: 1,
        clicks: 1, rarity: 'Common', boughtAt: 2, kind: 'image', localStatus: 'failed',
      },
    ] as GalleryImage[]
    useGame.setState({ gallery: images })
    render(<IdleGalleryView />)

    // Local keep: viewer renders blob:, Browser enabled.
    const tiles = screen.getAllByRole('button', { name: /^View /i })
    await userEvent.click(tiles[tiles.length - 1])
    await waitFor(() => {
      const blobImgs = document.querySelectorAll('img[src="blob:local-test"]')
      expect(blobImgs.length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('button', { name: /^Browser$/i })).toBeEnabled()
  })

  it('slideshow renders vault bytes, never the provider URL', async () => {
    const images = makeGalleryImages(3)
    vaultMap = {
      'https://example.com/img-1.jpg': 'vault://f/a1',
      'https://example.com/img-2.jpg': 'vault://f/a2',
    }
    useGame.setState({ gallery: images })

    render(<IdleGalleryView />)
    await userEvent.click(screen.getByRole('button', { name: /Slideshow/i }))

    expect(screen.getByLabelText(/Close slideshow/i)).toBeInTheDocument()
    const media = document.querySelector('.slideshow-player img, .slideshow-player video, [role="dialog"] img, [role="dialog"] video')
      || document.querySelector('img[src^="vault://"], video[src^="vault://"]')
    expect(media).not.toBeNull()
    expect(media?.getAttribute('src')).toMatch(/^vault:\/\//)
  })

  it('resolveGalleryTileUrl prefers vault SSD url, then preview, then inferred thumbnail', () => {
    const baseImg: GalleryImage = {
      id: 'test-1',
      url: 'https://img.booru.org/blacked//images/105/abcdef123456.png',
      tags: ['test'],
      rarityBase: 1,
      clicks: 0,
      rarity: 'Common',
    }

    // 1. Vault URL takes precedence when stored locally
    expect(resolveGalleryTileUrl(baseImg, 'vault://f/stored.png')).toBe('vault://f/stored.png')

    // 2. Pre-computed preview thumbnail is preferred over full remote URL
    const withPreview = { ...baseImg, preview: 'https://preview.com/thumb.jpg' }
    expect(resolveGalleryTileUrl(withPreview)).toBe('https://preview.com/thumb.jpg')

    // 3. booru.org full URLs infer the 18KB thumbnail to prevent multi-MB stalls
    expect(resolveGalleryTileUrl(baseImg)).toBe(
      'https://thumbs.booru.org/blacked/thumbnails//105/thumbnail_abcdef123456.png',
    )

    // 4. realbooru URLs infer the thumbnail
    const rbImg: GalleryImage = {
      ...baseImg,
      url: 'https://realbooru.com/images/38/f9/38f9dd17899412d912bc38fbe6916d35.jpeg',
    }
    expect(resolveGalleryTileUrl(rbImg)).toBe(
      'https://realbooru.com/thumbnails/38/f9/thumbnail_38f9dd17899412d912bc38fbe6916d35.jpg',
    )
  })

  it('shows live vault pin progress on a pending keep, then nothing when it lands', async () => {
    const img: GalleryImage = {
      id: 'k-pending',
      url: 'https://provider/clip.mp4',
      tags: ['e2e'],
      rarityBase: 1,
      clicks: 0,
      rarity: 'Common',
      boughtAt: 1,
      kind: 'video',
      localStatus: 'pending',
    }
    useGame.setState({ gallery: [img] })

    type ProgressCb = (p: { url: string; bytes: number; total: number }) => void
    let emit: ProgressCb | null = null
    const g = window as unknown as { gmatch?: unknown }
    const prevBridge = g.gmatch
    g.gmatch = { onVaultPinProgress: (cb: ProgressCb) => { emit = cb; return () => { emit = null } } }

    try {
      render(<IdleGalleryView />)
      expect(screen.getByText(/Caching…$/)).toBeInTheDocument()

      // Mid-stream progress from the main process drives the badge.
      await act(async () => { emit?.({ url: img.url, bytes: 512, total: 1024 }) })
      expect(screen.getByText(/Caching… 50%/)).toBeInTheDocument()
    } finally {
      g.gmatch = prevBridge
    }
  })

  it('releases each freshly minted local URL after a batch download (success and failure)', async () => {
    const blob = new Blob(['local-bytes'], { type: 'image/jpeg' })
    URL.createObjectURL = vi.fn(() => 'blob:fresh')
    URL.revokeObjectURL = vi.fn()
    const { getLocalObject } = await import('../../utils/p2pSwarm')
    vi.mocked(getLocalObject).mockImplementation(async () => blob)
    const { releaseLocalUrl } = await import('../../services/keepsake')
    vi.mocked(releaseLocalUrl).mockClear()
    useGame.setState({
      gallery: makeGalleryImages(2).map((img) => ({ ...img, localStatus: 'local' as const })),
    })
    const fetchMock = vi.fn<() => Promise<{ ok: boolean; blob?: () => Promise<Blob> }>>(
      async () => ({ ok: true, blob: async () => blob }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<IdleGalleryView />)
    await userEvent.click(screen.getByRole('button', { name: /Select all on page/i }))
    await userEvent.click(screen.getByRole('button', { name: /Download Selected/i }))
    await waitFor(() => expect(vi.mocked(releaseLocalUrl)).toHaveBeenCalledTimes(2))

    // Source refuses: the URL is still released, so nothing is leaked.
    fetchMock.mockImplementation(async () => ({ ok: false }))
    vi.mocked(releaseLocalUrl).mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Download Selected/i }))
    await waitFor(() => expect(vi.mocked(releaseLocalUrl)).toHaveBeenCalledTimes(2))
    vi.unstubAllGlobals()
  })

  it('claims the blob URL when a keepsake opens in a new tab (never releases it)', async () => {
    const blob = new Blob(['local-bytes'], { type: 'image/jpeg' })
    URL.createObjectURL = vi.fn(() => 'blob:fresh')
    URL.revokeObjectURL = vi.fn()
    const { getLocalObject } = await import('../../utils/p2pSwarm')
    vi.mocked(getLocalObject).mockImplementation(async () => blob)
    const { releaseLocalUrl, retainLocalUrl } = await import('../../services/keepsake')
    vi.mocked(releaseLocalUrl).mockClear()
    vi.mocked(retainLocalUrl).mockClear()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    useGame.setState({
      gallery: makeGalleryImages(1).map((img) => ({ ...img, localStatus: 'local' as const })),
    })

    render(<IdleGalleryView />)
    await act(async () => {
      window.dispatchEvent(new CustomEvent('gmatch:open-keepsake', { detail: { keepsakeId: 'img-1' } }))
    })

    await waitFor(() => expect(vi.mocked(retainLocalUrl)).toHaveBeenCalledWith('blob:fresh'))
    // The tab keeps requesting the URL: no premature revoke.
    expect(vi.mocked(releaseLocalUrl)).not.toHaveBeenCalled()
    expect(openSpy).toHaveBeenCalledWith('blob:fresh', '_blank', 'noopener,noreferrer')
  })

  it('viewer Browser prefers the vault loopback URL and releases the orphaned blob', async () => {
    const blob = new Blob(['local-bytes'], { type: 'image/jpeg' })
    URL.createObjectURL = vi.fn(() => 'blob:fresh')
    URL.revokeObjectURL = vi.fn()
    const { getLocalObject } = await import('../../utils/p2pSwarm')
    vi.mocked(getLocalObject).mockImplementation(async () => blob)
    const { releaseLocalUrl, retainLocalUrl } = await import('../../services/keepsake')
    vi.mocked(releaseLocalUrl).mockClear()
    vi.mocked(retainLocalUrl).mockClear()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const g = window as unknown as { gmatch?: unknown }
    const prevBridge = g.gmatch
    g.gmatch = { vaultHttpUrl: async () => ({ local: 'http://127.0.0.1:9/v/x' }) }
    useGame.setState({
      gallery: makeGalleryImages(1).map((img) => ({ ...img, localStatus: 'local' as const })),
    })

    try {
      render(<IdleGalleryView />)
      await userEvent.click(screen.getAllByRole('button', { name: /^View /i })[0])
      await userEvent.click(screen.getByRole('button', { name: /^Browser$/i }))

      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:9/v/x', '_blank', 'noopener,noreferrer'))
      // The minted blob lost to the loopback URL: released, not leaked.
      expect(vi.mocked(releaseLocalUrl)).toHaveBeenCalledWith('blob:fresh')
      expect(vi.mocked(retainLocalUrl)).not.toHaveBeenCalled()
    } finally {
      g.gmatch = prevBridge
    }
  })

  it('never hotlinks the provider for a keep verified local whose bytes are gone', () => {
    // A keep verified local is supposed to have bytes on disk; a remote
    // hotlink would hide a broken or evicted vault entry behind a working tile.
    const gone: GalleryImage = {
      id: 'local-gone',
      url: 'https://tbib.org/images/1/2/def.jpg',
      tags: ['t'],
      rarityBase: 1,
      clicks: 0,
      rarity: 'Common',
      preview: 'https://preview.example/thumb.jpg',
      localStatus: 'local',
    }
    expect(resolveGalleryTileUrl(gone)).toBe('')
  })
})
