/**
 * The one post model every feed surface reads.
 *
 * A post is CONTENT: words (`text`) plus optional bytes (`media`). The storage
 * shape is older and messier — a single `url`, a `media[]` array, legacy
 * `mediaUrls`, a session-only `localPreviewUrl`, and `caption` under several
 * names — but that is a wire detail, not a second concept. `readPostContent`
 * folds all of it into `{ text, media? }` once, and the renderer branches on
 * that single value: text posts get a text card, media posts get a picture.
 *
 * Text is always content. A row with words is renderable even with no bytes;
 * only a row whose MEDIA bytes cannot be resolved is hidden (and that hide is
 * reversible). See `isRenderable.ts` and `GMatchFeed`'s `deadPosts` gate.
 */

/** One piece of media, addressed either by a URL or by an object id. */
export interface PostMedia {
  /** Object id for local/swarm media; absent for a plain http(s) URL. */
  id?: string;
  url: string;
  mimeType?: string;
}

/** The abstract post: words, and bytes only when the post actually has them. */
export interface PostContent {
  text: string;
  media?: PostMedia[];
}

/** The structural subset of `FeedPost` (and of a local object row) we read. */
export interface PostLike {
  id?: string;
  caption?: string | null;
  url?: string | null;
  mime_type?: string | null;
  localPreviewUrl?: string | null;
  mediaUrls?: readonly (string | null | undefined)[] | null;
  media?: readonly {
    id?: string;
    url?: string | null;
    mime_type?: string | null;
  }[] | null;
}

function usableUrl(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Fold a stored row into the model. Media precedence mirrors the renderer:
 * per-item `media[]` (each item keeps its own mime), then legacy `mediaUrls`,
 * then the single `url` / `localPreviewUrl`. A single URL is addressed by the
 * POST id — the id the node and the swarm know — not by an invented object id.
 */
export function readPostContent(post: PostLike | null | undefined): PostContent {
  const text = typeof post?.caption === 'string' ? post.caption : '';
  const media: PostMedia[] = [];
  const seen = new Set<string>();
  if (!post) return { text, media: undefined };

  const add = (item: PostMedia) => {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    media.push(item);
  };

  if (Array.isArray(post.media)) {
    for (const m of post.media) {
      const url = m?.url;
      if (!usableUrl(url)) continue;
      add({ id: m?.id, url, mimeType: m?.mime_type ?? undefined });
    }
  }
  if (Array.isArray(post.mediaUrls)) {
    for (const u of post.mediaUrls) {
      if (!usableUrl(u)) continue;
      const matching = Array.isArray(post.media)
        ? post.media.find((m) => m?.url === u)
        : undefined;
      add({ url: u, mimeType: matching?.mime_type ?? post.mime_type ?? undefined });
    }
  }
  if (media.length === 0) {
    const url = post.localPreviewUrl || post.url;
    if (usableUrl(url)) {
      add({ id: post.id, url, mimeType: post.mime_type ?? undefined });
    }
  }

  return { text, media: media.length ? media : undefined };
}

/** One helper for "does this row carry bytes?" — no field-by-field checks. */
export function hasMedia(post: PostLike | null | undefined): boolean {
  return Boolean(readPostContent(post).media?.length);
}

/** A text-only post has words and no media at all. */
export function isTextOnlyPost(post: PostLike | null | undefined): boolean {
  return !hasMedia(post);
}

/**
 * The media item a single-media card renders. A single item is addressed by
 * the post itself (`localPreviewUrl || url`, object id `post.id`), exactly as
 * the node and the fullscreen resolver address it. Carousels keep each item's
 * own id and url.
 */
export function displayMedia(post: PostLike, content: PostContent): PostMedia | null {
  const items = content.media;
  if (!items?.length) return null;
  const item = items[0];
  if (items.length > 1) return item;
  const url = post.localPreviewUrl || post.url || item.url;
  return { id: post.id, url, mimeType: item.mimeType ?? post.mime_type ?? undefined };
}
