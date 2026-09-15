// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GMatchStories } from './GMatchStories'
import { ToastProvider } from './Toast'
import type { OrbitObject } from '@orbit/shared'

// Pin the API base so relative avatar refs resolve to absolute URLs exactly
// as they do in the packaged app (Electron preload __API_BASE__).
vi.mock('../utils/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/api')>()
  return { ...mod, getApiBaseUrl: () => 'https://api.test' }
})

const story = (over: Partial<OrbitObject> = {}): OrbitObject =>
  ({
    id: 'story-1',
    owner_id: 'user-9',
    display_name: 'Story Gal',
    pfp_url: '/api/objects/avatar-uuid-1',
    content_url: 'https://cdn.example/s1.jpg',
    mime_type: 'image/jpeg',
    created_at: new Date().toISOString(),
    ...over,
  }) as OrbitObject

const renderStories = (stories: OrbitObject[]) =>
  render(
    <ToastProvider>
      <GMatchStories stories={stories} currentUserId="me" profilePics={{}} />
    </ToastProvider>,
  )

describe('GMatchStories avatars', () => {
  it('resolves relative pfp refs to absolute API URLs in story rings', () => {
    renderStories([story()])
    const img = screen.getByAltText('Story Gal') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://api.test/api/objects/avatar-uuid-1')
  })

  it('falls back to initials when the avatar URL fails to load', () => {
    renderStories([story()])
    const img = screen.getByAltText('Story Gal')
    fireEvent.error(img)
    expect(screen.queryByAltText('Story Gal')).toBeNull()
    // initial-letter fallback renders instead
    expect(screen.getByText('S')).toBeDefined()
  })

  it('shows initials by design when no avatar is set', () => {
    renderStories([story({ pfp_url: null })])
    expect(screen.queryByAltText('Story Gal')).toBeNull()
    expect(screen.getByText('S')).toBeDefined()
  })
});
