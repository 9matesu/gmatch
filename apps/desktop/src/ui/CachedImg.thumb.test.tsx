// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { MediaThumbState } from '../hooks/useMediaThumb'

const thumbState: MediaThumbState = { url: null, pending: false }
vi.mock('../hooks/useMediaThumb', () => ({
  useMediaThumb: () => thumbState,
}))
vi.mock('../services/imageCache', () => ({
  cachedImageFor: () => null,
  resolveImage: async () => null,
}))

import CachedImg from './CachedImg'

beforeEach(() => {
  thumbState.url = null
  thumbState.pending = false
})

describe('CachedImg thumbnails', () => {
  it('asks the main-process route for gmcache media', () => {
    const { container } = render(<CachedImg src="gmcache://f/k.jpg" alt="a" thumb />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'gmcache://thumb/k.jpg')
  })

  it('does not paint the full blob while its thumbnail is generated', () => {
    thumbState.pending = true
    const { container, rerender } = render(<CachedImg src="blob:full" alt="b" thumb />)
    expect(container.querySelector('img')).not.toHaveAttribute('src')

    thumbState.url = 'blob:small'
    thumbState.pending = false
    rerender(<CachedImg src="blob:full" alt="b" thumb />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:small')
  })

  it('drops to the full original when the thumbnail fails', () => {
    thumbState.url = 'blob:small'
    const { container, rerender } = render(<CachedImg src="blob:full" alt="c" thumb />)
    fireEvent.error(container.querySelector('img')!)
    rerender(<CachedImg src="blob:full" alt="c" thumb />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:full')
  })

  it('leaves ordinary consumers on the original source', () => {
    const { container } = render(<CachedImg src="blob:full" alt="d" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:full')
  })
})