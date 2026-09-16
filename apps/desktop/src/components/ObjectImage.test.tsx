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
}
vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: () => hookState,
}))
vi.mock('../services/vault', () => ({
  useVaultUrl: () => null,
}))

import { ObjectImage } from './ObjectImage'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

beforeEach(() => {
  hookState.url = null
  hookState.failed = false
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

  it('renders the fetched blob once the signed image resolves', () => {
    hookState.url = 'blob:resolved'
    render(<ObjectImage contentUrl="/api/objects/abc" identity={identity} alt="shot" />)
    expect(screen.getByAltText('shot')).toHaveAttribute('src', 'blob:resolved')
  })
})