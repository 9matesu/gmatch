// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'

/**
 * A justified row is a *derived* group, not an identity. Keying the row by its
 * full member list remounts every tile whenever a ratio arrives or the window
 * resizes — each <img> reloads, which reads as a grid-wide flash. The anchor
 * (first id) is stable in the common append case.
 */
const mounts = vi.hoisted(() => ({ count: new Map<string, number>() }))

vi.mock('./tileMetrics', () => ({
  ratioOf: (post: { id: string }) => (post.id === 'unmeasured' ? undefined : 1),
  rememberRatio: () => false,
}))
vi.mock('./FeedTile', () => ({
  FeedTile: ({ post }: { post: { id: string } }) => {
    // Count MOUNTS, not renders: every tile re-renders when the parent does.
    const counted = useRef(false)
    if (!counted.current) {
      counted.current = true
      mounts.count.set(post.id, (mounts.count.get(post.id) ?? 0) + 1)
    }
    return <div data-testid="tile" data-id={post.id} />
  },
}))
vi.mock('../../utils/p2pSwarm', () => ({ getLocalObject: async () => null }))

import { FeedGrid } from './FeedGrid'

const post = (id: string) => ({ id, url: 'https://cdn.example.com/x.jpg' }) as never

beforeEach(() => {
  mounts.count.clear()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: (entries: Array<{ contentRect: { width: number } }>) => void) {}
    observe() { this.cb([{ contentRect: { width: 1000 } }]) }
    unobserve() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
})

describe('FeedGrid (no remount jank)', () => {
  it('draws one tile per post id and never drops the text row', () => {
    // A node row and a local mirror can both carry the same id; two justified
    // rows with one id drew the tile twice and collided on their React key,
    // which made the neighbouring text card vanish. Dedupe before layout.
    const textPost = { id: 'words', caption: 'just words' } as never
    const { container } = render(
      <FeedGrid
        posts={[post('a'), post('a'), textPost]}
        identity={null}
        onOpen={() => {}}
        likedPosts={{}}
        likeCounts={{}}
        onToggleLike={() => {}}
      />,
    )
    expect(screenIds()).toEqual(['a', 'words'])
    expect(container.querySelector('[data-testid="feed-grid"]')?.children).toHaveLength(1)
  })

  it('keeps existing tiles mounted when a new ratio extends the last row', () => {
    const { rerender } = render(
      <FeedGrid posts={[post('a'), post('b'), post('c')]} identity={null} onOpen={() => {}} likedPosts={{}} likeCounts={{}} onToggleLike={() => {}} />,
    )
    expect(screenIds()).toEqual(['a', 'b', 'c'])
    expect([...mounts.count.values()]).toEqual([1, 1, 1])

    rerender(
      <FeedGrid posts={[post('a'), post('b'), post('c'), post('d')]} identity={null} onOpen={() => {}} likedPosts={{}} likeCounts={{}} onToggleLike={() => {}} />,
    )
    expect(screenIds()).toEqual(['a', 'b', 'c', 'd'])
    // The old key (all row ids) changed a-b-c -> a-b-c-d and remounted all three.
    expect(mounts.count.get('a')).toBe(1)
    expect(mounts.count.get('b')).toBe(1)
    expect(mounts.count.get('c')).toBe(1)
  })
})

function screenIds(): string[] {
  return Array.from(globalThis.document.querySelectorAll('[data-testid="tile"]'))
    .map((el) => (el as HTMLElement).dataset.id!)
}
