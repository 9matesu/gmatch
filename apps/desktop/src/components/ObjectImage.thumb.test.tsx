// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MediaThumbState } from '../hooks/useMediaThumb'

/**
 * Dense-grid mode: a tile must render a BOUNDED thumbnail instead of decoding
 * the full-size original, and must never paint the full original "just while
 * the thumbnail loads" — that is the exact decode this mode exists to avoid.
 */
const thumbState: MediaThumbState = { url: null, pending: false }
vi.mock('../hooks/useMediaThumb', () => ({
  useMediaThumb: () => thumbState,
}))

vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: () => ({ url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false }),
  evictObjectImage: vi.fn(),
}))
vi.mock('../services/vault', () => ({
  useVaultUrl: () => null,
  useVaultLookup: () => ({ local: null, settled: true }),
  useVaultHttpUrls: () => ({}),
  vaultGet: async () => null,
  vaultOptIn: () => false,
}))
vi.mock('../services/imageCache', () => ({
  resolveImage: async () => null,
  devFetchable: () => null,
  cachedImageFor: () => null,
}))

import { ObjectImage } from './ObjectImage'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

beforeEach(() => {
  thumbState.url = null
  thumbState.pending = false
})

describe('ObjectImage thumbnails (dense grids)', () => {
  it('uses the main-process thumbnail route for gmcache media', () => {
    render(<ObjectImage contentUrl="gmcache://f/abc.jpg" identity={identity} alt="a" thumb />)
    expect(screen.getByAltText('a')).toHaveAttribute('src', 'gmcache://thumb/abc.jpg')
  })

  it('never paints the full-size blob while its thumbnail is being generated', () => {
    thumbState.pending = true
    const { rerender } = render(<ObjectImage contentUrl="blob:full" identity={identity} alt="b" thumb />)
    // No src at all: the full-size bitmap is never decoded.
    expect(screen.getByAltText('b')).not.toHaveAttribute('src')

    thumbState.url = 'blob:small'
    thumbState.pending = false
    rerender(<ObjectImage contentUrl="blob:full" identity={identity} alt="b" thumb />)
    expect(screen.getByAltText('b')).toHaveAttribute('src', 'blob:small')
  })

  it('falls back to the full original when the thumbnail itself fails', () => {
    thumbState.url = 'blob:small'
    const { rerender } = render(<ObjectImage contentUrl="blob:full" identity={identity} alt="c" thumb />)
    fireEvent.error(screen.getByAltText('c'))
    rerender(<ObjectImage contentUrl="blob:full" identity={identity} alt="c" thumb />)
    // A broken thumbnail is not a broken picture.
    expect(screen.getByAltText('c')).toHaveAttribute('src', 'blob:full')
    expect(screen.queryByText('Image unavailable')).toBeNull()
  })

  it('leaves non-grid consumers on the full-size source', () => {
    render(<ObjectImage contentUrl="blob:full" identity={identity} alt="d" />)
    expect(screen.getByAltText('d')).toHaveAttribute('src', 'blob:full')
  })
})