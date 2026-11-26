import { memo } from 'react'
import { Layers } from 'lucide-react'
import type { FeedPost } from './GMatchFeed'
import { hasMedia, ratioOf } from './tileMetrics'
import { ObjectImage } from '../ObjectImage'
import { isVideoPost, resolveMediaUrl } from '../../utils/media'
import type { OrbitIdentity } from '@orbit/crypto'

export interface FeedTileProps {
  post: FeedPost
  identity: OrbitIdentity | null
  liked: boolean
  likes: number
  onOpen: (post: FeedPost) => void
  onToggleLike: (post: FeedPost) => void
  /** Grid only: report the rendered media's natural size so the tile can be
   *  measured (a descriptor/vault post has no http URL to probe). */
  onMediaLoad?: (w: number, h: number) => void
  /** Grid only: the media could not be resolved (reversible hide). */
  onMediaUnavailable?: () => void
}

/**
 * ONE tile. Memoized on purpose: the timeline holds dozens of these, and a like
 * changes exactly one — the old inline version re-rendered every tile because
 * the list owned the whole block.
 *
 * The card is a BOX with a click button layered over the media (not a button):
 * it also carries a like button, and interactive content must never nest inside
 * a button. The open button is the card's accessible name; the like sits above
 * it in the stacking order so it stays clickable.
 */
export const FeedTile = memo(function FeedTile({ post, identity, liked, likes, onOpen, onToggleLike, onMediaLoad, onMediaUnavailable }: FeedTileProps) {
  const url = post.media?.[0]?.url || post.url
  const mime = post.media?.[0]?.mime_type || post.mime_type
  const isObject =
    !url ||
    url.includes('/api/objects/') ||
    url.startsWith('vault://') ||
    url.startsWith('magnet:') ||
    url.startsWith('urn:') ||
    url.startsWith('p2p-')
  const video = isVideoPost(mime, url, (post.media || []).map((m) => m.mime_type))
  const label = post.caption ? `Open post: ${post.caption.slice(0, 60)}` : 'Open post'

  return (
    <div
      className="cv-row group relative min-w-0 overflow-hidden bg-surface-raised border border-edge rounded-lg"
      style={{ flexGrow: ratioOf(post) || 1, flexBasis: 0 }}
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        title={post.caption || undefined}
        aria-label={label}
        className="absolute inset-0 z-[1] cursor-pointer"
      />
      {hasMedia(post) ? (
        isObject ? (
          <ObjectImage
            objectId={post.media?.[0]?.id}
            contentUrl={url}
            contentHash={post.content_hash}
            identity={identity}
            mimeType={mime}
            className="h-full w-full object-cover"
            videoClassName="h-full w-full object-cover"
            hideUnavailable
            onLoadSize={onMediaLoad}
            onMediaUnavailable={onMediaUnavailable}
            // Grid tile: a bounded thumbnail, never the full-size bitmap.
            thumb
          />
        ) : (
          <img
            src={resolveMediaUrl(url)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onLoad={(e) => onMediaLoad?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            onError={() => onMediaUnavailable?.()}
          />
        )
      ) : null}
      {!hasMedia(post) ? (
        // Text-only post: the words are the tile, not a hole.
        <span className="flex h-full w-full flex-col justify-between gap-2 p-3 text-left">
          <span className="line-clamp-6 text-field leading-snug text-retro-body">{post.caption?.trim() || '(no caption)'}</span>
          <span className="text-2xs text-retro-faint">{post.author_name}</span>
        </span>
      ) : null}
      {video && (
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs text-white">video</span>
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
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[12px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <span className="truncate font-medium">{post.author_name}</span>
        <button
          type="button"
          aria-label={liked ? 'Unlike post' : 'Like post'}
          aria-pressed={liked}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLike(post)
          }}
          className="pointer-events-auto shrink-0 cursor-pointer tabular-nums"
        >
          {likes > 0 ? likes.toLocaleString() : ''}
        </button>
      </span>
    </div>
  )
})