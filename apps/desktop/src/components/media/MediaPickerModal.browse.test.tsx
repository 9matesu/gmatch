// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GalleryImage } from '../../game/types'
import { MediaPickerPanel } from './MediaPickerModal'

const localKeep: GalleryImage = {
  id: 'k-local', url: 'https://provider.test/p.jpg', tags: ['t'], rarityBase: 1,
  clicks: 0, rarity: 'Common', boughtAt: 1, kind: 'image',
  saveState: 'persisted', localRef: 'a'.repeat(64),
}
const missingKeep: GalleryImage = {
  id: 'k-missing', url: 'https://provider.test/m.jpg', tags: ['t'], rarityBase: 1,
  clicks: 0, rarity: 'Common', boughtAt: 1, kind: 'image',
  saveState: 'persisted', localRef: 'b'.repeat(64),
}

const heal = vi.fn(async (_url: string, _kind?: 'image' | 'video') => ({
  state: 'permanent' as const, ref: 'b'.repeat(64), via: 'vault' as const, reused: false,
}))

vi.mock('../../game/store', () => ({
  useGame: (selector: (s: unknown) => unknown) => selector({ gallery: [localKeep, missingKeep] }),
}))
vi.mock('../../services/vault', () => ({ useVaultUrls: () => ({}), useVaultHttpUrls: () => ({}) }))
vi.mock('../../services/keepsake', () => ({
  releaseLocalUrl: vi.fn(), resolveFreshLocalUrl: vi.fn(), persistKeepsake: vi.fn(),
}))
vi.mock('../../utils/mediaVault', () => ({
  ensurePermanentMedia: (url: string, kind?: 'image' | 'video') => heal(url, kind),
}))
vi.mock('../grid/IdleGalleryView', async () => {
  const actual = await vi.importActual<typeof import('../grid/IdleGalleryView')>('../grid/IdleGalleryView')
  return {
    ...actual,
    // The gallery already resolved this keep's bytes to an IndexedDB blob.
    useKeepsakeLocalUrls: () => ({ [localKeep.url]: 'blob:local-bytes' }),
  }
})

describe('MediaPicker Browse keepsake tiles', () => {
  it('renders a persisted keep from local bytes, never the provider URL', () => {
    render(<MediaPickerPanel options={{ sources: ['browse'] }} onPick={vi.fn()} onClose={vi.fn()} />)
    const img = screen.getByAltText('t') as HTMLImageElement
    expect(img.src).toBe('blob:local-bytes')
    expect(img.src).not.toContain('provider.test')
  })

  it('heals a missing keep once in the background and shows an honest empty tile', async () => {
    heal.mockClear()
    render(<MediaPickerPanel options={{ sources: ['browse'] }} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('No local copy')).toBeTruthy()
    await waitFor(() => expect(heal).toHaveBeenCalledTimes(1))
    expect(heal).toHaveBeenCalledWith(missingKeep.url, missingKeep.kind)
  })
})
