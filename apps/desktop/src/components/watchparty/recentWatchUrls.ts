'use client'

// Quick-launch session URLs. The watch rooms themselves are remembered in
// watchPartyStore; these are the plain links a player pasted into the URL
// modal. Keeping them locally (one small bounded list) makes a session one
// click to restart, with no node or account involved.

const KEY = 'gmatch_watch_urls_v1'
const MAX = 8

export interface RecentWatchUrl {
  url: string
  /** When the link was last launched, epoch ms. */
  at: number
}

export function isWatchUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** jsdom and the renderer both expose the box on `window`; a bare global is
 *  not reliable in every test host, so all access goes through this one seam. */
function store(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readRecentWatchUrls(): RecentWatchUrl[] {
  try {
    const box = store()
    if (!box) return []
    const raw = box.getItem(KEY)
    const rows = raw ? JSON.parse(raw) : []
    if (!Array.isArray(rows)) return []
    return rows
      .filter((r: any) => r && isWatchUrl(r.url))
      .map((r: any) => ({ url: String(r.url), at: Number(r.at) || 0 }))
      .slice(0, MAX)
  } catch {
    return []
  }
}

/** Move the launched links to the front, drop duplicates, cap the list. */
export function rememberWatchUrls(urls: string[], now: number = Date.now()): RecentWatchUrl[] {
  const added = [...new Set(urls.filter(isWatchUrl))]
  const rows = [
    ...added.map((url) => ({ url, at: now })),
    ...readRecentWatchUrls().filter((r) => !added.includes(r.url)),
  ].slice(0, MAX)
  try {
    store()?.setItem(KEY, JSON.stringify(rows))
  } catch {
    /* private mode: the chips still work for this session */
  }
  return rows
}
