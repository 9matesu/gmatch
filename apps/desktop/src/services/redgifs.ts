import type { BooruPost } from '../game/types'

/**
 * Redgifs adapter (real/hardcore porn: pornstars, BBC, mp4s/gifs).
 * Public v2 API: temporary token (per-device, same-UA) → niche-targeted
 * gif fetch when the query matches a niche, else the generic trending feed.
 * NOTE (verified live 2026-09-15): /v2/gifs/search IGNORES search_text —
 * every query returns the same global trending feed with empty item tags.
 * Tag-targeted results therefore go through /v2/niches/search +
 * /v2/niches/<id>/gifs. Shape verified live: gifs[] with urls.hd (.mp4),
 * urls.poster (.jpg), id, tags[], niches[], width, height.
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

/** GIF search URL (caller attaches `Authorization: Bearer <token>`).
 *  Generic trending fallback — search_text is currently ignored upstream,
 *  so prefer the niche-targeted fetch below whenever a niche matches. */
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

/** Normalized query tokens (feed-tag style) for niche matching + tagging. */
export function redgifsQueryTags(query: string): string[] {
  const out: string[] = []
  for (const part of redgifsQuery(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    const n = normTag(part)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

export interface RedgifsNiche {
  id: string
  name: string
  tags: string[]
  subscribers: number
}

/** Niche search URL (caller attaches `Authorization: Bearer <token>`). */
export function redgifsNicheSearchUrl(query: string): string {
  return `${REDGIFS_API}/v2/niches/search?query=${encodeURIComponent(redgifsQuery(query))}`
}

/** Niche gif-list URL (caller attaches `Authorization: Bearer <token>`). */
export function redgifsNicheGifsUrl(nicheId: string, count: number, page = 1): string {
  const n = Math.min(Math.max(Math.floor(count) || 10, 1), 100)
  const p = Math.max(1, Math.floor(page) || 1)
  return `${REDGIFS_API}/v2/niches/${encodeURIComponent(nicheId)}/gifs?count=${n}&page=${p}`
}

/** Parse a /v2/niches/search payload. Never throws. */
export function parseRedgifsNiches(data: unknown): RedgifsNiche[] {
  try {
    const root = data as { niches?: unknown }
    const list = Array.isArray(root?.niches) ? root.niches : []
    const out: RedgifsNiche[] = []
    for (const n of list) {
      if (typeof n !== 'object' || n === null) continue
      const r = n as Record<string, unknown>
      if (typeof r.id !== 'string' || !r.id) continue
      const tags: string[] = []
      if (Array.isArray(r.tags)) {
        for (const t of r.tags) {
          const norm = normTag(t)
          if (norm && !tags.includes(norm)) tags.push(norm)
        }
      }
      out.push({
        id: r.id,
        name: typeof r.name === 'string' ? r.name : r.id,
        tags,
        subscribers: typeof r.subscribers === 'number' ? r.subscribers : 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Best niche for a query by token overlap with the niche id, name and tags.
 * Null when nothing overlaps (e.g. pornstar names) — caller falls back to
 * the generic trending feed. Ties break toward more subscribers.
 */
export function pickRedgifsNiche(query: string, niches: RedgifsNiche[]): RedgifsNiche | null {
  const tokens = redgifsQueryTags(query).filter((t) => t.replace(/_/g, '').length >= 3)
  if (tokens.length === 0 || niches.length === 0) return null
  const hayFor = (n: RedgifsNiche): Set<string> => {
    const hay = new Set<string>()
    const add = (s: string): void => {
      for (const part of s.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 3) hay.add(part)
      }
    }
    add(n.id)
    add(n.name)
    for (const t of n.tags) for (const part of t.split('_')) {
      if (part.length >= 3) hay.add(part)
    }
    return hay
  }
  let best: RedgifsNiche | null = null
  let bestScore = 0
  for (const n of niches) {
    const hay = hayFor(n)
    let score = 0
    for (const tok of tokens) {
      const flat = tok.replace(/_/g, '')
      for (const h of hay) {
        if (h === flat || h.includes(flat) || flat.includes(h)) {
          score += 1
          break
        }
      }
    }
    if (score > bestScore || (score === bestScore && score > 0 && n.subscribers > (best?.subscribers ?? 0))) {
      best = n
      bestScore = score
    }
  }
  return bestScore > 0 ? best : null
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
