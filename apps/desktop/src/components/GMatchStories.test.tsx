// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GMatchStories } from './GMatchStories'
import { ToastProvider } from './Toast'
import type { OrbitObject } from '@orbit/shared'

// Node 22 ships an experimental localStorage global that is undefined unless
// --localstorage-file is passed, and it shadows jsdom's own storage. Install a
// real in-memory one so the seen-story persistence path is exercisable.
const mem = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  },
})

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

describe('GMatchStories segment bar (T-W3)', () => {
  beforeEach(() => localStorage.clear())

  it('fills the running segment white, not the near-black surface token', () => {
    renderStories([story({ id: 's1' })])
    fireEvent.click(screen.getByAltText('Story Gal'))
    const fill = screen.getByTestId('seg-fill-0')
    expect(fill.className).toContain('bg-retro-accent')
    expect(fill.className).not.toContain('bg-surface-raised')
  })

  it('dims the segment of a story that was already seen before this run', () => {
    localStorage.setItem('orbit_seen_stories', JSON.stringify(['s2']))
    renderStories([story({ id: 's1' }), story({ id: 's2' })])
    fireEvent.click(screen.getByAltText('Story Gal'))
    expect(screen.getByTestId('seg-track-1').className).toContain('bg-white/25')
  })

  it('treats a server-reported viewed=1 as already seen (cross-device)', () => {
    renderStories([story({ id: 's1' }), story({ id: 's2', viewed: 1 })])
    fireEvent.click(screen.getByAltText('Story Gal'))
    expect(screen.getByTestId('seg-track-1').className).toContain('bg-white/25')
  })
});
