import { Bookmark, Heart, MessageCircle, Repeat, Send } from 'lucide-react'
import type { FeedPost } from './GMatchFeed'
import { PostBody } from './PostBody'
import { PostTimestamp } from './PostTimestamp'
import { formatCount } from '../../utils/formatDate'
import { resolveMediaUrl } from '../../utils/media'
import { classes, COLOR, GAP, ICON, PADDING, RADIUS, STATUS, TRANSITION, TYPE, WEIGHT } from '../../ui/tokens'

const ACTION = classes(
  'p-1.5 cursor-pointer active:scale-(--scale-press)',
  TRANSITION.micro, RADIUS.chip, COLOR.hoverW10,
)

/**
 * A text-only post on a profile: the Twitter/Tumblr-shaped sibling of the
 * media grid tile. Words are the content — there is no image panel and no
 * media probe here, so a text post can never show "No preview". The action
 * row is wired to the SAME handlers as the expanded post; a surface with no
 * handler simply does not offer that action.
 */
export function ProfileTextPostCard({
  post,
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
  return (
    <article
      data-testid="profile-text-post"
      data-post-id={post.id}
      data-profile-post-kind="text"
      className={classes('w-full', COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.control, PADDING[4])}
    >
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
          <PostBody text={readBody(post)} className="pt-2" />
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
    </article>
  )
}

/** One body per card: captions are the only text field on a post row. */
function readBody(post: FeedPost): string {
  return typeof post.caption === 'string' ? post.caption : ''
}
