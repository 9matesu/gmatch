// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Signed objects render from a fetched blob; the placeholder must not claim
// "No preview" while that fetch is simply still in flight (T-W3).
const hookState = {
  url: null as string | null,
  failed: false,
  isVideo: false,
  isLink: false,
  linkUrl: null as string | null,
  awaitingSeeder: false,
}
// Records the cardId the component hands to the hook. The point of the
// objectId-only and bare-uuid cases is whether the id REACHES the signed
// fetch at all — the blank placeholder looks identical either way.
const rec = { cardId: null as string | null }
vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: (cardId: string | null) => {
    rec.cardId = cardId
    return hookState
  },
}))
vi.mock('../services/vault', () => ({
  useVaultUrl: () => null,
}))

import { ObjectImage } from './ObjectImage'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

beforeEach(() => {
  hookState.url = null
  hookState.failed = false
  hookState.awaitingSeeder = false
})

describe('ObjectImage placeholder (T-W3)', () => {
  it('does not flash "No preview" while a signed image is still loading', () => {
    render(<ObjectImage contentUrl="/api/objects/abc" identity={identity} />)
    expect(screen.queryByText('No preview')).toBeNull()
  })

  it('shows "No preview" only once the signed fetch has failed', () => {
    hookState.failed = true
    render(<ObjectImage contentUrl="/api/objects/abc" identity={identity} />)
    expect(screen.getByText('No preview')).toBeInTheDocument()
  })

  it('says "Waiting for poster…" (not "No preview") when no seeder answered', () => {
    hookState.failed = true
    hookState.awaitingSeeder = true
    render(<ObjectImage contentUrl="/api/objects/abc" identity={identity} />)
    expect(screen.getByText('Waiting for poster…')).toBeInTheDocument()
    expect(screen.queryByText('No preview')).toBeNull()
  })

  it('renders the fetched blob once the signed image resolves', () => {
    hookState.url = 'blob:resolved'
    render(<ObjectImage contentUrl="/api/objects/abc" identity={identity} alt="shot" />)
    expect(screen.getByAltText('shot')).toHaveAttribute('src', 'blob:resolved')
  })

  it('feeds the objectId to the signed fetch when contentUrl is empty (T-W3b)', () => {
    rec.cardId = null
    render(<ObjectImage objectId="abc-123" identity={identity} />)
    expect(rec.cardId).toBe('abc-123')
  })

  it('treats a bare uuid contentUrl as signed object media, never a raw img src (T-W3c)', () => {
    const uuid = 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f'
    rec.cardId = null
    hookState.url = null
    hookState.failed = false
    const { container } = render(<ObjectImage contentUrl={uuid} identity={identity} />)
    // A raw <img> would carry the unauthenticated /api/objects/<uuid> url.
    expect(container.querySelector('img')).toBeNull()
    expect(rec.cardId).toBe(uuid)
  })

  it('does not apply crossOrigin="anonymous" on direct external images', () => {
    const { container } = render(<ObjectImage contentUrl="https://cdn.example.com/art.jpg" identity={identity} alt="art" />)
    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img).not.toHaveAttribute('crossorigin')
  })

  it('hides component cleanly when hideUnavailable is true and image failed', () => {
    hookState.failed = true
    const { container } = render(
      <ObjectImage contentUrl="/api/objects/missing" identity={identity} hideUnavailable />
    )
    expect(screen.queryByText('No preview')).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})