/**
 * Media whose bytes are already in hand: an inline `data:`/`blob:` URL needs no
 * probe and no wait, because there is nothing to fetch. A remote url is the
 * opposite: the row must not appear until the bytes arrive.
 */
export type InlineMediaPost = {
  url?: string | null
  localPreviewUrl?: string | null
  media?: { url?: string | null }[] | null
}

const INLINE = /^(data|blob|vault|idle-file|gmcache):/i

export function hasInlineMedia(post: InlineMediaPost): boolean {
  if (post.localPreviewUrl) return true
  const url = post.media?.[0]?.url || post.url
  return !!url && INLINE.test(url)
}