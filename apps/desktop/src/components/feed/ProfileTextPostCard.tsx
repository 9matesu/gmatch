import { useEffect, useRef, useState } from 'react'
import { Bookmark, Heart, MessageCircle, Play, Repeat, Send } from 'lucide-react'
import type { OrbitIdentity } from '@orbit/crypto'
import type { FeedPost } from './GMatchFeed'
import { PostBody } from './PostBody'
import { PostTimestamp } from './PostTimestamp'
import { displayMedia, readPostContent } from './postModel'
import { ObjectImage } from '../ObjectImage'
import { formatCount } from '../../utils/formatDate'
import { isVideoPost, resolveMediaUrl } from '../../utils/media'
import { classes, COLOR, GAP, ICON, PADDING, RADIUS, STATUS, TRANSITION, TYPE, WEIGHT } from '../../ui/tokens'

const ACTION = classes(
  'p-1.5 cursor-pointer active:scale-(--scale-press)',
  TRANSITION.micro, RADIUS.chip, COLOR.hoverW10,
)
const OBJECT_URL = /^(?:\/api\/objects\/|vault:|magnet:|urn:|p2p-)/

/**
 * ONE card for every post on a profile. A post is words plus optional bytes —
 * the same `postModel` the feed reads — so the card renders either a thumbnail
 * or just the words, and the author + action row below is identical in both
 * cases. There is no second post shape and no media probe for a text-only post,
 * so a text card can never show "No preview" and a media card with dead bytes
 * never leaves an empty picture panel.
 */
export function ProfilePostCard({
  post,
  identity = null,
  liked = false,
  saved = false,
  likes = 0,
  onOpen,
  onToggleLike,
  onToggleSave,
  onRepost,
  onShare,
  onAuthorClick,
}: {
  post: FeedPost
  identity?: OrbitIdentity | null
  liked?: boolean
  saved?: boolean
  likes?: number
  onOpen?: (post: FeedPost) => void
  onToggleLike?: (post: FeedPost) => void
  onToggleSave?: (post: FeedPost) => void
  onRepost?: (post: FeedPost) => void
  onShare?: (post: FeedPost) => void
  onAuthorClick?: (userId: string) => void
}) {
  const content = readPostContent(post)
  const media = displayMedia(post, content)
  const url = media?.url || ''
  const isObject = !!media && (!url || OBJECT_URL.test(url))
  const video = !!media && isVideoPost(media.mimeType, url, content.media?.map((m) => m.mimeType || '') || [])
  // A media row whose bytes nobody holds must not leave an empty picture
  // panel. The post itself stays (author + words + actions); a new url starts
  // a fresh lookup, so this is a hide, never a permanent tombstone.
  const [deadUrl, setDeadUrl] = useState<string | null>(null)
  const lastUrl = useRef(url)
  useEffect(() => {
    if (lastUrl.current === url) return
    lastUrl.current = url
    setDeadUrl(null)
  }, [url])
  const showMedia = !!media && deadUrl !== url

  return (
    <article
      data-testid={media ? 'profile-media-post' : 'profile-text-post'}
      data-post-id={post.id}
      data-profile-post-kind={media ? 'media' : 'text'}
      className={classes('w-full', COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.control, 'overflow-hidden')}
    >
      {showMedia && (
        <button
          type="button"
          onClick={() => onOpen?.(post)}
          aria-label={content.text ? `Open post: ${content.text.slice(0, 60)}` : 'Open post'}
          className={classes('relative block w-full aspect-[4/3] overflow-hidden cursor-pointer', COLOR.canvasSurface)}
        >
          {isObject ? (
            <ObjectImage
              objectId={media.id}
              contentUrl={url}
              contentHash={post.content_hash}
              identity={identity}
              mimeType={media.mimeType}
              alt=""
              className="h-full w-full object-cover"
              videoClassName="h-full w-full object-cover"
              muted
              autoPlay={false}
              playsInline
              hideUnavailable
              thumb
              onMediaUnavailable={() => setDeadUrl(url)}
            />
          ) : video ? (
            <video
              src={resolveMediaUrl(url)}
              className="h-full w-full object-cover"
              preload="metadata"
              muted
              playsInline
              onError={() => setDeadUrl(url)}
            />
          ) : (
            <img src={resolveMediaUrl(url)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setDeadUrl(url)} />
          )}
          {video && (
            <span className={classes('absolute right-2 top-2 p-1 pointer-events-none z-[var(--z-dropdown)]', COLOR.scrim, RADIUS.chip, COLOR.fg)}>
              <Play className={ICON.sm} />
            </span>
          )}
        </button>
      )}

      <div className={PADDING[4]}>
        {post.is_reposted && (
          <div className={classes('flex items-center', GAP[1.5], TYPE.caption, COLOR.muted, 'pb-2')}>
            <Repeat className={classes(ICON.sm, COLOR.fg)} />
            <span>Reposted by <strong className={classes(WEIGHT.medium, COLOR.fg)}>@{post.reposted_by || 'Peer'}</strong></span>
          </div>
        )}

        <div className={classes('flex items-start', GAP[3])}>
          <button
            type="button"
            onClick={() => onAuthorClick?.(post.author_id)}
            aria-label={`View profile of ${post.author_name}`}
            className={classes('w-9 h-9 shrink-0 flex items-center justify-center overflow-hidden cursor-pointer', RADIUS.pill, COLOR.glassW12, TYPE.body, WEIGHT.semibold, COLOR.fg)}
          >
            {post.author_avatar
              ? <img src={resolveMediaUrl(post.author_avatar)} alt="" className="w-full h-full object-cover" />
              : (post.author_name || '?').charAt(0).toUpperCase()}
          </button>
          <div className="min-w-0 flex-1">
            <div className={classes('flex min-w-0 flex-wrap items-baseline', GAP[1.5])}>
              <button type="button" onClick={() => onAuthorClick?.(post.author_id)} className={classes('truncate cursor-pointer', TYPE.body, WEIGHT.semibold, COLOR.fg, 'hover:underline')}>
                {post.author_name}
              </button>
              <span className={classes(TYPE.caption, COLOR.muted)}>@{post.author_id.slice(0, 8)}</span>
              <PostTimestamp createdAt={post.created_at} className={classes(TYPE.caption, COLOR.muted)} />
            </div>
            <PostBody text={content.text} className="pt-2" />
          </div>
        </div>

        <div className={classes('flex items-center justify-between', GAP[2], 'pt-3')}>
          <div className={classes('flex items-center', GAP[1])}>
            <button type="button" onClick={() => onToggleLike?.(post)} aria-label={liked ? 'Unlike post' : 'Like post'} aria-pressed={liked} className={ACTION}>
              <Heart className={classes(ICON.md, 'stroke-[1.75] transition-colors', liked ? classes(STATUS.dangerFg, 'fill-danger') : COLOR.muted)} />
            </button>
            <button type="button" onClick={() => onOpen?.(post)} aria-label="Comment" className={classes(ACTION, COLOR.muted)}>
              <MessageCircle className={classes(ICON.md, 'stroke-[1.75]')} />
            </button>
            <button type="button" onClick={() => onShare?.(post)} aria-label="Share post" className={classes(ACTION, COLOR.muted)}>
              <Send className={classes(ICON.md, 'stroke-[1.75]')} />
            </button>
            {onRepost && (
              <button type="button" onClick={() => onRepost(post)} aria-label="Repost to Profile" className={classes(ACTION, COLOR.muted)}>
                <Repeat className={classes(ICON.md, 'stroke-[1.75]')} />
              </button>
            )}
          </div>
          <div className={classes('flex items-center', GAP[1])}>
            {likes > 0 && <span className={classes(TYPE.caption, COLOR.muted)}>{formatCount(likes)}</span>}
            <button type="button" onClick={() => onToggleSave?.(post)} aria-label={saved ? 'Remove from saved' : 'Save post'} aria-pressed={saved} className={ACTION}>
              <Bookmark className={classes(ICON.md, 'stroke-[1.75] transition-colors', saved ? classes(COLOR.fg, 'fill-retro-fg') : COLOR.muted)} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** Legacy import name: the text card and the media card are the same card. */
export const ProfileTextPostCard = ProfilePostCard
