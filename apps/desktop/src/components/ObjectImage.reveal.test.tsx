// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * Media reveal is a state machine: a source must not be PAINTED until it is the
 * one that actually decoded. The old implementation wrote the new url straight
 * into the DOM (blank frame) and, worse, froze `shownSrc` after the first load
 * so the local vault copy could never swap in at all.
 */
const vault = vi.hoisted(() => ({ local: null as string | null, settled: false }))
const thumb = vi.hoisted(() => ({ url: null as string | null, pending: false }))
const preloads: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = []

vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: () => ({ url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false }),
  evictObjectImage: vi.fn(),
}))
vi.mock('../services/vault', () => ({
  useVaultLookup: () => ({ local: vault.local, settled: vault.settled }),
  useVaultHttpUrls: () => ({}),
  vaultOptIn: () => true,
}))
vi.mock('../services/imageCache', () => ({
  resolveImage: async () => null,
  devFetchable: () => null,
  cachedImageFor: () => null,
}))
vi.mock('../hooks/useMediaThumb', () => ({ useMediaThumb: () => ({ url: thumb.url, pending: thumb.pending }) }))

import { ObjectImage } from './ObjectImage'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }
const REMOTE = 'https://cdn.example.com/picture.jpg'
const LOCAL = 'vault://f/hash123'

beforeEach(() => {
  vault.local = null
  vault.settled = false
  thumb.url = null
  thumb.pending = false
  preloads.length = 0
  vi.stubGlobal('Image', class {
    decoding = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    _src = ''
    set src(value: string) {
      this._src = value
      preloads.push(this as never)
    }
    get src() { return this._src }
  })
})

function settlePreload(src: string) {
  const probe = preloads.find((p) => p.src === src)
  expect(probe, `no preload was started for ${src}`).toBeTruthy()
  act(() => { probe!.onload?.() })
}

describe('ObjectImage reveal (no flash, no blank)', () => {
  it('swaps to the local vault copy once its bytes decode, not before', () => {
    const { rerender } = render(<ObjectImage contentUrl={REMOTE} identity={identity} alt="shot" />)
    const img = () => screen.getByAltText('shot')
    // The remote frame is held back while the vault lookup is in flight.
    expect(img()).toHaveAttribute('src', REMOTE)
    expect(img().style.opacity).toBe('0')
    fireEvent.load(img())

    // The lookup found local bytes. The gate alone is not permission to reveal:
    // until those bytes are painted, the remote frame must stay hidden.
    vault.local = LOCAL
    vault.settled = true
    rerender(<ObjectImage contentUrl={REMOTE} identity={identity} alt="shot" />)
    expect(img().style.opacity).toBe('0')
    expect(img()).toHaveAttribute('src', REMOTE)

    settlePreload(LOCAL)
    expect(img()).toHaveAttribute('src', LOCAL)
    expect(img().style.opacity).toBe('')
  })

  it('keeps the last thumbnail on screen while the replacement is generated', () => {
    thumb.url = 'blob:thumb-one'
    const { rerender } = render(<ObjectImage contentUrl="blob:full" identity={identity} alt="grid" thumb />)
    const img = () => screen.getByAltText('grid')
    expect(img()).toHaveAttribute('src', 'blob:thumb-one')
    fireEvent.load(img())

    // Same tile, new bytes: a fresh thumbnail is owed. Showing nothing here is
    // the "blank then reload" flicker; showing the full original would decode
    // the bitmap the grid thumbnail exists to avoid.
    thumb.url = null
    thumb.pending = true
    rerender(<ObjectImage contentUrl="blob:full" identity={identity} alt="grid" thumb />)
    expect(img()).toHaveAttribute('src', 'blob:thumb-one')

    thumb.url = 'blob:thumb-two'
    thumb.pending = false
    rerender(<ObjectImage contentUrl="blob:full" identity={identity} alt="grid" thumb />)
    expect(img()).toHaveAttribute('src', 'blob:thumb-one')
    settlePreload('blob:thumb-two')
    expect(img()).toHaveAttribute('src', 'blob:thumb-two')
  })
})
