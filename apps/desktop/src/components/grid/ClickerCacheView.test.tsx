// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClickerCacheView } from './ClickerCacheView'
import { listCachedPictures } from '../../services/imageCache'
import { useGame } from '../../game/store'
import type { CachedPicture } from '../../types/gmatch-bridge'

vi.mock('../../services/imageCache', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/imageCache')>()
  return { ...mod, listCachedPictures: vi.fn(async () => []) }
})

const mockedList = vi.mocked(listCachedPictures)

function pic(url: string, mime = 'image/jpeg'): CachedPicture {
  return { url, local: `gmcache://f/${url.slice(-8)}`, mime, bytes: 1024, ts: Date.now() }
}

describe('ClickerCacheView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedList.mockReset()
    mockedList.mockResolvedValue([])
    useGame.setState({ gallery: [] })
  })

  it('says the temporary cache is empty without implying keepsakes are missing', async () => {
    render(<ClickerCacheView />)
    await waitFor(() => expect(screen.getByText(/Nothing in the temporary picture cache/i)).toBeTruthy())
    expect(screen.getByText(/keepsakes you saved are in the Gallery/i)).toBeTruthy()
  })

  it('lists the cached pictures', async () => {
    mockedList.mockResolvedValue([pic('https://x/a.jpg'), pic('https://x/b.jpg')])
    render(<ClickerCacheView />)
    await waitFor(() => expect(screen.getByText(/Temporary picture cache/)).toBeTruthy())
    expect(screen.getByLabelText('Save to gallery: https://x/a.jpg')).toBeTruthy()
    expect(screen.getByLabelText('Save to gallery: https://x/b.jpg')).toBeTruthy()
  })

  it('saves a clicked picture to the gallery', async () => {
    mockedList.mockResolvedValue([pic('https://x/a.jpg')])
    const addGalleryImage = vi.fn(() => true)
    useGame.setState({ addGalleryImage } as never)
    render(<ClickerCacheView />)
    await waitFor(() => expect(screen.getByLabelText('Save to gallery: https://x/a.jpg')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Save to gallery: https://x/a.jpg'))
    expect(addGalleryImage).toHaveBeenCalledWith('https://x/a.jpg')
  })

  it('renders a video as a video tile', async () => {
    mockedList.mockResolvedValue([pic('https://x/a.mp4', 'video/mp4')])
    const { container } = render(<ClickerCacheView />)
    await waitFor(() => expect(container.querySelector('video')).toBeTruthy())
  })

  it('refreshes the list on demand', async () => {
    mockedList.mockResolvedValue([pic('https://x/a.jpg')])
    render(<ClickerCacheView />)
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Refresh cache list'))
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })
})
