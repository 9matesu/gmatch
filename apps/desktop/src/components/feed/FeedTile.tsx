import { memo } from 'react'
import { FolderPlus, Layers } from 'lucide-react'
import type { FeedPost } from './GMatchFeed'
import { ratioOf } from './tileMetrics'
import { displayMedia, readPostContent } from './postModel'
import { ObjectImage } from '../ObjectImage'
import { isVideoPost, resolveMediaUrl } from '../../utils/media'
import type { OrbitIdentity } from '@orbit/crypto'
import { CHROME, classes, COLOR, ICON, MONO, PADDING, STATUS, TYPE, WEIGHT } from '../../ui/tokens'
import { formatCount } from '../../utils/formatDate'

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
  /** Save the tile's media bytes to the local Vault (desktop only). */
  onSaveToVault?: (post: FeedPost) => void
  /** Bytes already pinned in the Vault. */
  vaultSaved?: boolean
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
 *
 * Surface + type drink from ui/tokens: `CHROME.tile` is the one raised card,
 * `CHROME.mediaChip` the only label-on-media, and TYPE/WEIGHT/MONO the text
 * steps. The `hideUnavailable` contract (a row with no bytes is hidden
 * reversibly) is untouched.
 */
export const FeedTile = memo(function FeedTile({ post, identity, liked, likes, onOpen, onToggleLike, onMediaLoad, onMediaUnavailable, onSaveToVault, vaultSaved }: FeedTileProps) {
  // One model for both kinds of post: words, plus bytes only when they exist.
  const content = readPostContent(post)
  const media = displayMedia(post, content)
  const url = media?.url || ''
  const mime = media?.mimeType
  const isObject =
    !url ||
    url.includes('/api/objects/') ||
    url.startsWith('vault://') ||
    url.startsWith('magnet:') ||
    url.startsWith('urn:') ||
    url.startsWith('p2p-')
  const video = isVideoPost(mime, url, (content.media || []).map((m) => m.mimeType || ''))
  const label = content.text ? `Open post: ${content.text.slice(0, 60)}` : 'Open post'

  return (
    <div
      className={classes('cv-row group relative min-w-0 overflow-hidden', CHROME.tile)}
      style={{ flexGrow: ratioOf(post) || 1, flexBasis: 0 }}
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        title={content.text || undefined}
        aria-label={label}
        className="absolute inset-0 z-[1] cursor-pointer"
      />
      {media ? (
        isObject ? (
          <ObjectImage
            objectId={media.id}
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
      {!media ? (
        // Text-only post: the words are the tile. No image panel, no
        // placeholder, no media probe — and never hidden for missing bytes.
        <span className={classes('flex h-full w-full flex-col justify-between gap-2 text-left', PADDING[3])}>
          <span className={classes('line-clamp-6 leading-snug', TYPE.field, COLOR.body)}>{content.text.trim() || '(no caption)'}</span>
          <span className={classes(TYPE.caption, COLOR.faint)}>{post.author_name}</span>
        </span>
      ) : null}
      {video && (
        <span className={classes('absolute left-2 top-2 px-1.5 py-0.5', CHROME.mediaChip)}>video</span>
      )}
      {(content.media?.length ?? 0) > 1 && (
        <span
          className={classes('absolute right-2 top-2 flex items-center gap-1 px-1.5 py-0.5', CHROME.mediaChip)}
          aria-label={`${content.media!.length} images`}
        >
          <Layers className="h-3 w-3" />
          {content.media!.length}
        </span>
      )}
      <span className={classes(
        'pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-center justify-between gap-2',
        'bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6',
        TYPE.body, COLOR.onMedia, 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
      )}>
        <span className={classes('truncate', WEIGHT.medium)}>{post.author_name}</span>
        <button
          type="button"
          aria-label={liked ? 'Unlike post' : 'Like post'}
          aria-pressed={liked}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLike(post)
          }}
          className={classes('pointer-events-auto shrink-0 cursor-pointer', MONO)}
        >
          {likes > 0 ? formatCount(likes) : ''}
        </button>
        {onSaveToVault && media && (
          <button
            type="button"
            aria-label="Save to Vault"
            title="Save the media to your Vault (offline copy)"
            onClick={(e) => {
              e.stopPropagation()
              onSaveToVault(post)
            }}
            className={classes('pointer-events-auto shrink-0 cursor-pointer', MONO, vaultSaved && STATUS.success)}
          >
            <FolderPlus className={ICON.sm} />
          </button>
        )}
      </span>
    </div>
  )
})
