import type { BooruPost } from '../game/types'

/**
 * imhentai adapter (hentai galleries: captions, hardcore doujins).
 * No JSON API exists — scrape HTML like gallery-dl does:
 *   search/tag page → gallery IDs (href="/gallery/<id>")
 *   gallery page   → cover image (data-src base + $.parseJSON ext map)
 * Every parser is pure and never throws.
 */

export const IMHENTAI_ROOT = 'https://imhentai.xxx'

/** `key=` takes plain words (`/search/?key=...`, gallery-dl shape). */
export function imhentaiSearchUrl(query: string): string {
  const key = query.replace(/_/g, ' ').trim().replace(/\s+/g, ' ')
  return `${IMHENTAI_ROOT}/search/?key=${encodeURIComponent(key)}`
}

export function imhentaiGalleryUrl(id: string): string {
  return `${IMHENTAI_ROOT}/gallery/${encodeURIComponent(id)}/`
}

/** Gallery IDs from a search/tag page, deduped, capped. Never throws. */
export function parseImhentaiSearch(html: unknown, limit = 5): string[] {
  try {
    if (typeof html !== 'string') return []
    const out: string[] = []
    const re = /href="\/gallery\/(\d+)\/?"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      if (!out.includes(m[1])) out.push(m[1])
      if (out.length >= Math.max(1, limit)) break
    }
    return out
  } catch {
    return []
  }
}

export interface ImhentaiSearchResult {
  id: string
  coverUrl: string
}

/**
 * Direct search result parsing: extracts both gallery ID and cover thumbnail
 * directly from search results HTML in one pass. Avoids secondary /gallery/<id>
 * requests that trigger Cloudflare WAF challenges.
 */
export function parseImhentaiSearchResults(html: unknown, limit = 5): ImhentaiSearchResult[] {
  try {
    if (typeof html !== 'string') return []
    const out: ImhentaiSearchResult[] = []
    const seen = new Set<string>()
    const thumbRe = /<div class="thumb"[\s\S]*?href="\/gallery\/(\d+)\/?"[\s\S]*?<img[^>]+data-src="([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = thumbRe.exec(html))) {
      const [, id, coverUrl] = m
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ id, coverUrl })
        if (out.length >= Math.max(1, limit)) break
      }
    }
    if (out.length === 0) {
      const linkRe = /href="\/gallery\/(\d+)\/?"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/g
      while ((m = linkRe.exec(html))) {
        const [, id, coverUrl] = m
        if (!seen.has(id)) {
          seen.add(id)
          out.push({ id, coverUrl })
          if (out.length >= Math.max(1, limit)) break
        }
      }
    }
    return out
  } catch {
    return []
  }
}

export interface ImhentaiCover {
  url: string
  width: number
  height: number
}

const IMH_EXTS: Record<string, string> = { j: 'jpg', p: 'png', g: 'gif', w: 'webp', a: 'avif' }

/**
 * Cover (page 1) image from a gallery page. Prefers the $.parseJSON
 * dimension map; falls back to the raw data-src URL when the map is
 * missing (gallery-dl's alternate strategy). Null when no image found.
 */
export function parseImhentaiCover(html: unknown): ImhentaiCover | null {
  try {
    if (typeof html !== 'string') return null
    const srcTag = 'data-src="'
    const srcStart = html.indexOf(srcTag)
    if (srcStart === -1) return null
    const urlStart = srcStart + srcTag.length
    const urlEnd = html.indexOf('"', urlStart)
    if (urlEnd === -1) return null
    const src = html.slice(urlStart, urlEnd)
    if (!src) return null
    // $.parseJSON('...') ext map — string-scan, no regex escapes needed.
    const marker = 'parseJSON('
    const mStart = html.indexOf(marker)
    if (mStart !== -1) {
      const q1 = html.indexOf("'", mStart + marker.length)
      const q2 = q1 === -1 ? -1 : html.indexOf("'", q1 + 1)
      if (q1 !== -1 && q2 !== -1) {
        try {
          // Pages embed the map in a JS string — drop stray backslashes first.
          const raw = html.slice(q1 + 1, q2).split(String.fromCharCode(92)).join('')
          const data = JSON.parse(raw) as Record<string, string>
          const first = data['1']
          if (typeof first === 'string') {
            const parts = first.split(',')
            const suffix = IMH_EXTS[parts[0]]
            if (suffix) {
              const slash = src.lastIndexOf('/')
              const root = slash === -1 ? '' : src.slice(0, slash + 1)
              return {
                url: root + '1.' + suffix,
                width: Number(parts[1]) || 0,
                height: Number(parts[2]) || 0,
              }
            }
          }
        } catch {
          /* fall through to raw data-src */
        }
      }
    }
    return { url: src, width: 0, height: 0 }
  } catch {
    return null
  }
}

/** Feed post for a gallery cover. Tags come from the query (gallery-dl fetches metadata separately — too slow per feed round). */
export function toImhentaiPost(galleryId: string, cover: ImhentaiCover, query: string): BooruPost {
  return {
    id: `imh-${galleryId}`,
    url: cover.url,
    tags: query
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
    rating: 'e',
    kind: 'image',
  }
}
