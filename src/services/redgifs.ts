import type { BooruPost } from '../game/types'

/**
 * Redgifs adapter (real/hardcore porn: pornstars, BBC, mp4s/gifs).
 * Public v2 API: temporary token (per-device, same-UA) → gif search.
 * Shape verified live: gifs[] with urls.hd (.mp4), urls.poster (.jpg),
 * id, tags[], niches[], width, height.
 */

/** Feed tags use underscores; redgifs search takes plain words. */
export function redgifsQuery(tag: string): string {
  return tag.replace(/_/g, ' ').trim().replace(/\s+/g, ' ')
}

export const REDGIFS_API = 'https://api.redgifs.com'

/** Binary host for mp4s + posters (single host, verified live). */
export const REDGIFS_MEDIA = 'https://media.redgifs.com'

/**
 * Dev-playable URL for RedGifs bytes: vite dev serves them same-origin via
 * the /rg-media proxy (dodges host-based adblock ERR_FAILEDs). Pass-through
 * everywhere else (packaged Electron loads file://, no DEV flag). Pure.
 */
export function redgifsPlayable(url: string): string {
  try {
    if (import.meta.env.DEV && typeof url === 'string' && url.startsWith(`${REDGIFS_MEDIA}/`)) {
      return `/rg-media/${url.slice(REDGIFS_MEDIA.length + 1)}`
    }
  } catch {
    /* env unavailable (tests without vite) — passthrough */
  }
  return url
}

/** Temporary-token endpoint (no credentials — per-device token). */
export function redgifsAuthUrl(): string {
  return `${REDGIFS_API}/v2/auth/temporary`
}

/** Pull the bearer token out of an auth response. Null when absent. */
export function parseRedgifsToken(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const t = (data as Record<string, unknown>).token
  return typeof t === 'string' && t.length > 0 ? t : null
}

/** GIF search URL (caller attaches `Authorization: Bearer <token>`). */
export function redgifsSearchUrl(query: string, count: number, page = 1): string {
  const n = Math.min(Math.max(Math.floor(count) || 10, 1), 100)
  const p = Math.max(1, Math.floor(page) || 1)
  return (
    `${REDGIFS_API}/v2/gifs/search?search_text=${encodeURIComponent(redgifsQuery(query))}` +
    `&order=trending&count=${n}&page=${p}`
  )
}

function normTag(t: unknown): string | null {
  if (typeof t !== 'string') return null
  const n = t
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return n.length >= 2 ? n : null
}

/** Parse a /v2/gifs/search payload into feed posts. Never throws. */
export function parseRedgifs(data: unknown): BooruPost[] {
  try {
    const root = data as { gifs?: unknown }
    const list = Array.isArray(root?.gifs) ? root.gifs : []
    const out: BooruPost[] = []
    for (const g of list) {
      if (typeof g !== 'object' || g === null) continue
      const r = g as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const urls = r.urls as Record<string, unknown> | undefined
      const hd = urls && typeof urls.hd === 'string' ? urls.hd : ''
      if (!id || !hd) continue
      const rawTags = [
        ...(Array.isArray(r.tags) ? r.tags : []),
        ...(Array.isArray(r.niches) ? r.niches : []),
      ]
      const tags: string[] = []
      for (const t of rawTags) {
        const n = normTag(t)
        if (n && !tags.includes(n)) tags.push(n)
      }
      const poster = urls && typeof urls.poster === 'string' ? urls.poster : undefined
      out.push({
        id: `rg-${id}`,
        url: hd,
        tags,
        rating: 'e',
        preview: poster,
        kind: 'video',
      })
    }
    return out
  } catch {
    return []
  }
}
