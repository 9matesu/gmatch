// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GMatchFeed, type FeedPost } from './GMatchFeed'
import { saveMediaAsKeepsake } from '../../services/keepsake'

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(), playLike: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn(),
}))
vi.mock('../../services/vault', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/vault')>(),
  vaultBridge: () => ({}),
  vaultPin: vi.fn(async () => 'vault://f/abc'),
}))
vi.mock('../../services/keepsake', () => ({
  saveMediaAsKeepsake: vi.fn(async () => ({ ok: true, ref: 'abc' })),
}))

const CAPTION = 'one body, one card'

beforeEach(() => {
  vi.mocked(saveMediaAsKeepsake).mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }))
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  })
})

const captionedPost = {
  id: 'post-body-1',
  author_id: 'user-alice',
  author_name: 'Alice Wonder',
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675'%3E%3C/svg%3E",
  mime_type: 'image/svg+xml',
  caption: CAPTION,
  created_at: new Date().toISOString(),
  like_count: 0,
  comment_count: 0,
} as unknown as FeedPost

function renderFeed() {
  return render(
    <GMatchFeed
      identity={{ orbitId: 'me', publicKeyHex: '1', privateKeyHex: '2' } as never}
      posts={[captionedPost]}
      stories={[]}
      users={[]}
    />,
  )
}

describe('GMatchFeed · one body, one card', () => {
  it('shows the body inline when collapsed and only in the expanded card when open', () => {
    const { container } = renderFeed()
    expect(screen.getAllByText(CAPTION)).toHaveLength(1)

    const card = container.querySelector('article[data-post-id]') as HTMLElement
    const media = card.querySelector('.group\\/post div[role="button"]') as HTMLElement
    fireEvent.click(media)

    // The expanded text is the only copy: the inline duplicate is not rendered.
    expect(screen.getAllByText(CAPTION)).toHaveLength(1)
    expect(document.querySelector('[data-expanded-post]')).toBeTruthy()
    expect(card.querySelector('[data-testid="post-author-overlay"]')).toBeNull()

    // One card, centred in the feed column — not a card inside a card.
    expect(card.className).toContain('mx-auto')
    expect(card.className).toContain('max-w-lg')
    const expanded = document.querySelector('[data-expanded-post]') as HTMLElement
    expect(expanded.className).not.toMatch(/solid-panel|bg-surface-raised|border-edge/)

    // Collapse restores the inline body, still exactly once.
    fireEvent.click(document.querySelector('[aria-label="Collapse post"]') as HTMLElement)
    expect(screen.getAllByText(CAPTION)).toHaveLength(1)
  })

  it('offers save-to-Vault on the inline card, not only in the expanded view', () => {
    renderFeed()
    expect(screen.getAllByLabelText('Save to Vault').length).toBeGreaterThan(0)
  })

  it('routes an explicit Save to Vault through the verified keepsake helper', async () => {
    renderFeed()
    fireEvent.click(screen.getAllByLabelText('Save to Vault')[0])
    await waitFor(() => expect(saveMediaAsKeepsake).toHaveBeenCalledWith(
      captionedPost.url,
      expect.objectContaining({ kind: 'image' }),
    ))
  })
})
