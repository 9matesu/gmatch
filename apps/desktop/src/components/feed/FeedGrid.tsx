import { useEffect, useRef, useState } from 'react'
import type { FeedPost } from './GMatchFeed'
import { justifyRows, type JustifiedInput } from './justifyRows'
import { ratioOf, rememberRatio } from './tileMetrics'
import { FeedTile } from './FeedTile'
import { resolveMediaUrl } from '../../utils/media'
import type { OrbitIdentity } from '@orbit/crypto'

interface FeedGridProps {
  posts: FeedPost[]
  identity: OrbitIdentity | null
  profilePics?: Record<string, string | undefined>
  onOpen: (post: FeedPost) => void
  likedPosts: Record<string, boolean>
  likeCounts: Record<string, number>
  onToggleLike: (post: FeedPost) => void
}

/**
 * Tumblr-style grid: justified rows, measured BEFORE a row is positioned, so a
 * row never reflows. A post whose dimensions are unknown contributes no slot at
 * all (it stays hidden, per the visibility rule), so the grid fills in as
 * pictures resolve instead of jumping.
 *
 * Dimensions come from a probe (the same bytes the tile is about to show), not
 * from the model: `FeedPost` carries no width/height and adding it would be a
 * data-format change.
 */
export function FeedGrid({ posts, identity, onOpen, likedPosts, likeCounts, onToggleLike }: FeedGridProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [, bump] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // ResizeObserver + rAF: one write per frame, never a layout read in a loop.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      requestAnimationFrame(() => setWidth(Math.floor(w)))
    })
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  // Probe the pictures we still cannot measure.
  useEffect(() => {
    let live = true
    for (const post of posts) {
      if (ratioOf(post) !== undefined) continue
      const url = post.media?.[0]?.url || post.url
      if (!/^https?:/i.test(url)) continue // signed/descriptor rows: no bytes, no ratio
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        if (!live) return
        if (rememberRatio(post, img.naturalWidth, img.naturalHeight)) bump((n) => n + 1)
      }
      img.src = resolveMediaUrl(url)
    }
    return () => {
      live = false
    }
  }, [posts])

  const items: JustifiedInput[] = []
  for (const p of posts) {
    const r = ratioOf(p)
    if (r) items.push({ id: p.id, ratio: r })
  }

  const { rows } = justifyRows(items, { containerWidth: width, targetHeight: 260, maxCrop: 0.12, gap: 4 })
  const byId = new Map(posts.map((p) => [p.id, p]))

  return (
    <div ref={ref} className="w-full" data-testid="feed-grid">
      {rows.map((row) => (
        <div key={row.ids.join('-')} className="flex w-full" style={{ gap: 4, height: row.height, marginBottom: 4 }}>
          {row.ids.map((id) => {
            const post = byId.get(id)
            if (!post) return null
            return (
              <FeedTile
                key={id}
                post={post}
                identity={identity}
                liked={!!likedPosts[post.id]}
                likes={likeCounts[post.id] ?? post.like_count ?? 0}
                onOpen={onOpen}
                onToggleLike={onToggleLike}
              />
            )
          })}
        </div>
      ))}
      {rows.length === 0 && <p className="py-8 text-center text-xs text-retro-faint">Nothing to lay out yet.</p>}
    </div>
  )
}