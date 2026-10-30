/**
 * Community / support invite.
 *
 * The invite lives in the node's public settings (`SystemMeta.discord_invite_url`,
 * served by `GET /api/discord-invite` without auth) so an admin can rotate it
 * without shipping a build. A local node that never set one still needs a way
 * to reach people, so a constant fallback is used — nobody should have to dig
 * through old chat messages for it.
 */
import { useEffect, useState } from 'react'
import { getApiBaseUrl } from '../utils/api'

export const COMMUNITY_FALLBACK_URL = 'https://discord.gg/Xkqb6U4Na'

const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i
let cached: string | null = null

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && HTTP_URL_RE.test(value.trim())
}

/** Node setting first, fallback last. Never throws, never returns empty. */
export async function loadCommunityInvite(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached) return cached
  try {
    const base = getApiBaseUrl().replace(/\/+$/, '')
    const res = await fetchImpl(`${base}/api/discord-invite`, {
      headers: { accept: 'application/json' },
    })
    if (res.ok) {
      const data = await res.json().catch(() => null) as { url?: unknown } | null
      if (isHttpUrl(data?.url)) {
        cached = data.url.trim()
        return cached
      }
    }
  } catch {
    /* offline / courier: the community is still reachable by fallback */
  }
  cached = COMMUNITY_FALLBACK_URL
  return cached
}

export function useCommunityInvite(): string {
  const [url, setUrl] = useState<string>(cached ?? COMMUNITY_FALLBACK_URL)
  useEffect(() => {
    let alive = true
    if (!cached) {
      void loadCommunityInvite().then((next) => { if (alive) setUrl(next) })
    }
    return () => { alive = false }
  }, [])
  return url
}

export function openCommunityInvite(url: string): void {
  if (!isHttpUrl(url)) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Test seam: forget the cached invite between cases. */
export function resetCommunityInviteCache(): void {
  cached = null
}
