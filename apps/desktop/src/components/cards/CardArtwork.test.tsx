// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('react-holo-card-effect/dist/index.js', () => ({
  HoloCard: ({ url, children }: { url: string; children?: ReactNode }) => (
    <div data-testid="holo" data-url={url}>{children}</div>
  ),
}))
vi.mock('../../hooks/useObjectImage', () => ({ useObjectImage: vi.fn() }))

import { useObjectImage } from '../../hooks/useObjectImage'
import { CardArtwork } from './CardArtwork'

const identity = { orbitId: 'me-1', publicKeyHex: 'p', privateKeyHex: 'k' } as never
const result = (over: Record<string, unknown> = {}) => ({
  url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false,
  ...over,
}) as never

beforeEach(() => vi.mocked(useObjectImage).mockReset())

describe('CardArtwork (holo never blanks)', () => {
  it('uses a real placeholder URL and shows a state while bytes resolve', () => {
    vi.mocked(useObjectImage).mockReturnValue(result())
    render(<CardArtwork objectId="m-1" identity={identity} width={150} height={210} />)
    const holo = screen.getByTestId('holo')
    expect(holo.getAttribute('data-url')).toMatch(/^data:image\/svg\+xml,/)
    expect(holo.getAttribute('data-url')!.length).toBeGreaterThan(30)
    expect(screen.getByText(/loading card art/i)).toBeTruthy()
  })

  it('reports a terminal miss instead of a blank card', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ failed: true }))
    render(<CardArtwork objectId="m-1" identity={identity} width={150} height={210} />)
    expect(screen.getByText('No preview')).toBeTruthy()
  })

  it('paints video bytes in a video element, not an unpaintable CSS background', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:video', isVideo: true }))
    render(<CardArtwork objectId="m-1" identity={identity} width={150} height={210} isVideo />)
    expect(screen.getByLabelText('Card video').getAttribute('src')).toBe('blob:video')
    // The Pokemon HoloCard wrapper is still the surface.
    expect(screen.getByTestId('holo')).toBeTruthy()
  })

  it('hands a resolved image URL to HoloCard unchanged', () => {
    vi.mocked(useObjectImage).mockReturnValue(result({ url: 'blob:image' }))
    render(<CardArtwork objectId="m-1" identity={identity} width={150} height={210} />)
    expect(screen.getByTestId('holo').getAttribute('data-url')).toBe('blob:image')
  })
})
