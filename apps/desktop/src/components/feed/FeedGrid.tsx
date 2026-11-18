import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import type { FeedPost } from './GMatchFeed'
import { justifyRows, type JustifiedInput } from './justifyRows'
import { ObjectImage } from '../ObjectImage'
import { isVideoPost, resolveMediaUrl } from '../../utils/media'
import type { OrbitIdentity } from '@orbit/crypto'

/**
 * Session cache of width/height per post (and per media object). A re-render
 * must not re-probe a picture it already measured.
 */
const ratios = new Map<string, number>()
/** A text-only post has no pixels, so the row math gives it a card shape. */
const TEXT_TILE_RATIO = 1.5

function hasMedia(post: FeedPost): boolean {
  return Boolean(post.media?.[0]?.url || post.url)
}

function ratioOf(post: FeedPost): number | undefined {
  return ratios.get(post.id) ?? ratios.get(post.media?.[0]?.id || '') ?? (hasMedia(post) ? undefined : TEXT_TILE_RATIO)
}

function remember(post: FeedPost, w: number, h: number) {
  if (!w || !h) return false
  const ratio = w / h
  const known = ratios.get(post.id)
  if (known && Math.abs(known - ratio) < 0.001) return false
  ratios.set(post.id, ratio)
  const m = post.media?.[0]
  if (m?.id) ratios.set(m.id, ratio)
  return true
}

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
      if (ratios.has(post.id)) continue
      const url = post.media?.[0]?.url || post.url
      if (!/^https?:/i.test(url)) continue // signed/descriptor rows: no bytes, no ratio
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        if (!live) return
        if (remember(post, img.naturalWidth, img.naturalHeight)) bump((n) => n + 1)
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
        <div
          key={row.ids.join('-')}
          className="flex w-full"
          style={{ gap: 4, height: row.height, marginBottom: 4 }}
        >
          {row.ids.map((id) => {
            const post = byId.get(id)
            if (!post) return null
            const url = post.media?.[0]?.url || post.url
            const mime = post.media?.[0]?.mime_type || post.mime_type
            const isObject = !url || url.includes('/api/objects/') || url.startsWith('vault://') || url.startsWith('magnet:') || url.startsWith('urn:') || url.startsWith('p2p-')
            const video = isVideoPost(mime, url, (post.media || []).map((m) => m.mime_type))
            const liked = !!likedPosts[post.id]
            const likes = likeCounts[post.id] ?? post.like_count ?? 0
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpen(post)}
                title={post.caption || undefined}
                aria-label={post.caption ? `Open post: ${post.caption.slice(0, 60)}` : 'Open post'}
                className="cv-row group relative min-w-0 overflow-hidden bg-surface-raised border border-edge rounded-lg cursor-pointer"
                style={{ flexGrow: ratioOf(post) || 1, flexBasis: 0 }}
              >
                {hasMedia(post) ? (
                  isObject ? (
                    <ObjectImage
                      objectId={post.media?.[0]?.id}
                      contentUrl={url}
                      identity={identity}
                      mimeType={mime}
                      className="w-full h-full object-cover"
                      videoClassName="w-full h-full object-cover"
                      hideUnavailable
                    />
                  ) : (
                    <img
                      src={resolveMediaUrl(url)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  )
                ) : null}
                {!hasMedia(post) ? (
                  // Text-only post: the words are the tile, not a hole.
                  <span className="flex h-full w-full flex-col justify-between gap-2 p-3 text-left">
                    <span className="line-clamp-6 text-[13px] leading-snug text-retro-body">
                      {post.caption?.trim() || '(no caption)'}
                    </span>
                    <span className="text-2xs text-retro-faint">{post.author_name}</span>
                  </span>
                ) : null}
                {video && (
                  <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded bg-black/60 text-2xs text-white">
                    video
                  </span>
                )}
                {(post.media?.length ?? 0) > 1 && (
                  <span
                    className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-2xs text-white"
                    aria-label={`${post.media!.length} images`}
                  >
                    <Layers className="h-3 w-3" />
                    {post.media!.length}
                  </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[12px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="truncate font-medium">{post.author_name}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={liked ? 'Unlike post' : 'Like post'}
                    aria-pressed={liked}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleLike(post)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        e.preventDefault()
                        onToggleLike(post)
                      }
                    }}
                    className="pointer-events-auto shrink-0 tabular-nums"
                  >
                    {likes > 0 ? likes.toLocaleString() : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
      {rows.length === 0 && <p className="py-8 text-center text-xs text-retro-faint">Nothing to lay out yet.</p>}
    </div>
  )
}