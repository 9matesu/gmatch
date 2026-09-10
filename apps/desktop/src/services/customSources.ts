// Player-owned idle-clicker sources (custom URLs / local folders).
// Sampling only — CRUD + persistence live in game/store.ts (per-identity
// save). Custom URLs are used as-is: only add sources you trust. The 18+
// gate still applies (the feed only runs age-verified); the tag blocklist
// cannot apply to tagless direct links, so no filtering is pretended here.
import type { BooruPost, CustomSource } from '../game/types'

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)(\?|#|$)/i
const VIDEO_EXT = /\.(mp4|webm|mov)(\?|#|$)/i

/** Direct http(s) media link only — no pages, no scripts, no data URIs. */
export function isCustomMediaUrl(raw: string): boolean {
  const u = raw.trim()
  if (!/^https?:\/\//i.test(u)) return false
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  } catch {
    return false
  }
  return MEDIA_EXT.test(u)
}

export function customKindOf(url: string): 'image' | 'video' {
  return VIDEO_EXT.test(url) ? 'video' : 'image'
}

function slug(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return s || 'custom'
}

// No-repeat memory for custom posts (ids only), separate from the booru
// seen-sets in services/booru.ts.
const SEEN_KEY = 'gmatch.seen.custom.v1'
const SEEN_CAP = 500
const seen = new Set<string>()
let seenLoaded = false

function loadSeen(): void {
  if (seenLoaded) return
  seenLoaded = true
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as { ids?: unknown }
    if (Array.isArray(d.ids)) for (const id of d.ids) seen.add(String(id))
  } catch {
    /* corrupt cache — start fresh */
  }
}

function rememberIds(ids: string[]): void {
  loadSeen()
  let fresh = false
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    fresh = true
  }
  while (seen.size > SEEN_CAP) {
    const oldest = seen.values().next().value as string
    seen.delete(oldest)
  }
  if (fresh) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: [...seen] }))
    } catch {
      /* storage unavailable — memory still works for this session */
    }
  }
}

/** Test hook. */
export function __resetCustomSeen(): void {
  seen.clear()
  seenLoaded = false
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function folderPosts(source: CustomSource): Promise<BooruPost[]> {
  if (!source.folderId || typeof window === 'undefined') return []
  const bridge = window.gmatch?.customListFolder
  if (!bridge) return []
  try {
    const res = await bridge(source.folderId)
    if (!res?.ok || !Array.isArray(res.files)) return []
    const tag = slug(source.label)
    return res.files
      .filter((f) => typeof f?.url === 'string' && typeof f?.name === 'string')
      .map((f) => ({
        id: `custom:${source.id}:${f.name}`,
        url: f.url,
        tags: [tag, 'custom', 'local'],
        kind: customKindOf(f.name),
      }))
  } catch {
    return []
  }
}

function urlPosts(source: CustomSource): BooruPost[] {
  const tag = slug(source.label)
  return source.urls.filter(isCustomMediaUrl).map((u) => {
    const url = u.trim()
    return {
      id: `custom:${source.id}:${url}`,
      url,
      tags: [tag, 'custom'],
      kind: customKindOf(url),
    }
  })
}

/**
 * Sample up to `limit` fresh posts across enabled sources (round-robin
 * over shuffled sources so one big list can't starve the others).
 */
export async function sampleCustomSources(sources: CustomSource[], limit: number): Promise<BooruPost[]> {
  loadSeen()
  const enabled = sources.filter(
    (s) => s.enabled && (s.kind === 'urls' ? s.urls.length > 0 : Boolean(s.folderId)),
  )
  if (enabled.length === 0) return []
  const perSource: BooruPost[][] = []
  for (const s of shuffle(enabled)) {
    const posts = (s.kind === 'folder' ? await folderPosts(s) : urlPosts(s)).filter((p) => !seen.has(p.id))
    if (posts.length > 0) perSource.push(shuffle(posts))
  }
  const out: BooruPost[] = []
  let ri = 0
  while (out.length < limit && perSource.length > 0) {
    const bucket = perSource[ri % perSource.length]
    const post = bucket.pop()
    if (post) out.push(post)
    else perSource.splice(ri % perSource.length, 1)
    ri++
    if (ri > limit * enabled.length + enabled.length) break
  }
  rememberIds(out.map((p) => p.id))
  return out
}
