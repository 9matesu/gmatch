import type { BooruPost } from '../game/types'

/**
 * Babesource.com adapter (real porn photo galleries: pornstars like
 * Kenzie Reeves, Shrooms Q). No JSON API — scrape HTML:
 *   search page  -> gallery hrefs (/galleries/<slug>-<id>.html, skip /video/)
 *   gallery page -> full images (<a class="slideshowGalleryImage" href=FULL>
 *                   with thumb <img src> inside) + tags from meta keywords.
 * Full lives on babesource.com/media/galleries/<hash>/<file>.jpg,
 * thumbs on media.babesource.com/galleries/<hash>/thumbs/<file>.jpg.
 * NEVER serve a thumb as `url` — url=FULL, preview=thumb.
 */

export const BABESOURCE_ROOT = 'https://babesource.com'

/** `shrooms q` -> `shrooms-q` (babesource slug shape). */
export function babesourceSlug(query: string): string {
  return query
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function babesourceSearchUrl(query: string, page = 1): string {
  const slug = babesourceSlug(query)
  const p = Math.max(1, Math.floor(page) || 1)
  return `${BABESOURCE_ROOT}/search/${encodeURIComponent(slug)}/page${p}.html`
}

export interface BabesourceImage {
  url: string
  preview: string
}

/** Rewrite a thumb URL to its full-res equivalent (fallback when <a href> is missing). */
export function babesourceThumbToFull(thumb: string): string | null {
  try {
    const m = /^https:\/\/media\.babesource\.com\/galleries\/([0-9a-f]+)\/thumbs\/(?:300x406\/)?(.+\.(?:jpe?g|png|webp|gif))$/i.exec(
      thumb.trim(),
    )
    if (!m) return null
    return `https://babesource.com/media/galleries/${m[1]}/${m[2]}`
  } catch {
    return null
  }
}

function isFullUrl(u: string): boolean {
  return /^https:\/\/babesource\.com\/media\/galleries\/[0-9a-f]+\/.+\.(?:jpe?g|png|webp|gif)$/i.test(u)
}

function isThumbUrl(u: string): boolean {
  return /^https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\//i.test(u)
}

/** Highest search-result page linked from a search page (1 when single-page).
 *  Never throws. Used to bound random page picks so we never fetch
 *  nonexistent page2+/page3+ URLs (404 noise + wasted cooldowns). */
export function parseBabesourceMaxPage(html: unknown): number {
  try {
    if (typeof html !== 'string') return 1;
    let max = 1;
    const re = /href=["']page(\d+)\.html["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = Math.min(n, 50);
    }
    return Math.max(1, max);
  } catch {
    return 1;
  }
}
/** Gallery page URLs from a search page. Skips /video/ entries. Deduped, capped. Never throws. */
export function parseBabesourceSearch(html: unknown, limit = 5): string[] {
  try {
    if (typeof html !== 'string') return []
    const out: string[] = []
    const re = /href="(https:\/\/babesource\.com\/galleries\/[^"]+?-(\d+)\.html)"/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const href = m[1]
      if (href.includes('/video/')) continue
      if (!out.includes(href)) out.push(href)
      if (out.length >= Math.max(1, limit)) break
    }
    return out
  } catch {
    return []
  }
}

/**
 * Full-res images from a gallery page. Primary: <a class="slideshowGalleryImage"
 * href=FULL> + inner thumb <img src>. Fallbacks: PhotoSwipe items JSON,
 * ld+json contentUrl, thumb-rewrite. Returns url=FULL + preview=thumb pairs.
 * Never throws; never returns a thumb as `url`.
 */
export function parseBabesourceGallery(html: unknown, limit = 20): BabesourceImage[] {
  try {
    if (typeof html !== 'string') return []
    const out: BabesourceImage[] = []
    const seen = new Set<string>()
    const push = (url: string, preview: string): void => {
      if (!isFullUrl(url) || seen.has(url)) return
      seen.add(url)
      out.push({ url, preview: isThumbUrl(preview) ? preview : url })
    }
    // 1. Primary: viewer anchors.
    const anchorRe =
      /<a[^>]*class="[^"]*slideshowGalleryImage"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = anchorRe.exec(html))) {
      push(m[1], m[2])
      if (out.length >= Math.max(1, limit)) return out
    }
    // Anchor hrefs without inner img (same shape, img elsewhere).
    if (out.length === 0) {
      const hrefRe = /<a[^>]*class="[^"]*slideshowGalleryImage"[^>]*href="([^"]+)"[^>]*>/gi
      while ((m = hrefRe.exec(html))) {
        const href = m[1]
        if (!isFullUrl(href) || seen.has(href)) continue
        // Pair with the same-file thumb if present anywhere on the page.
        const file = href.slice(href.lastIndexOf('/') + 1)
        const thumbHit = new RegExp(
          `https://media\\.babesource\\.com/galleries/[0-9a-f]+/thumbs/(?:300x406/)?${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'i',
        ).exec(html)
        push(href, thumbHit ? thumbHit[0] : href)
        if (out.length >= Math.max(1, limit)) return out
      }
    }
    // 2. PhotoSwipe items JSON fallback.
    if (out.length === 0) {
      const jsRe = /"src"\s*:\s*"(https:\\\/\\\/babesource\.com\\\/media\\\/galleries\\\/[^"]+?\.jpe?g)"/gi
      while ((m = jsRe.exec(html))) {
        const full = m[1].replace(/\\\//g, '/')
        if (!seen.has(full)) {
          const file = full.slice(full.lastIndexOf('/') + 1)
          push(full, full.replace(/^https:\/\/babesource\.com\/media\//, 'https://media.babesource.com/').replace(/\/galleries\/([0-9a-f]+)\//, '/galleries/$1/thumbs/').replace(file, file))
        }
        if (out.length >= Math.max(1, limit)) return out
      }
    }
    // 3. Thumb-rewrite fallback (thumbs only on page — reconstruct fulls).
    if (out.length === 0) {
      const thumbRe = /https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\/(?:300x406\/)?[^"'\s]+\.(?:jpe?g|png|webp|gif)/gi
      while ((m = thumbRe.exec(html))) {
        const full = babesourceThumbToFull(m[0])
        if (full) push(full, m[0])
        if (out.length >= Math.max(1, limit)) return out
      }
    }
    return out
  } catch {
    return []
  }
}

/** Tags from a gallery page (<meta keywords> + category/pornstar links). Never throws. */
export function parseBabesourceTags(html: unknown): string[] {
  try {
    if (typeof html !== 'string') return []
    const tags = new Set<string>()
    const norm = (t: string): string | null => {
      const n = t
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
      return n.length >= 2 ? n : null
    }
    const meta = /<meta\s+name="keywords"\s+content="([^"]*)"/i.exec(html)
    if (meta) {
      for (const part of meta[1].split(',')) {
        const n = norm(part.trim())
        if (n) tags.add(n)
      }
    }
    const linkRe = /href="https:\/\/babesource\.com\/(?:search|pornstars)\/([^"/]+)(?:\/|\.html)?"/gi
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(html))) {
      const slug = decodeURIComponent(m[1]).split('/')[0]
      for (const part of slug.split('-')) {
        const n = norm(part)
        if (n) tags.add(n)
      }
    }
    return [...tags]
  } catch {
    return []
  }
}

/** Feed posts for a gallery's images. Full-res url, thumb preview, kind image. */
export function toBabesourcePosts(
  galleryUrl: string,
  images: BabesourceImage[],
  query: string,
  galleryTags: string[] = [],
): BooruPost[] {
  const idMatch = /-(\d+)\.html?(?:[?#]|$)/.exec(galleryUrl)
  const gid = idMatch ? idMatch[1] : String(Math.abs(hashCode(galleryUrl)))
  const queryTags = query
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
  const tags = [...new Set([...queryTags, ...galleryTags])]
  return images.map((img, i) => ({
    id: `bs-${gid}-${i}`,
    url: img.url,
    preview: img.preview,
    tags,
    rating: 'e',
    kind: 'image' as const,
  }))
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}
