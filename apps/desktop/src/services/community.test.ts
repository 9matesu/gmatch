import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_FALLBACK_URL,
  loadCommunityInvite,
  openCommunityInvite,
  resetCommunityInviteCache,
} from './community'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    async json() { return body },
  } as unknown as Response
}

describe('community invite', () => {
  beforeEach(() => {
    resetCommunityInviteCache()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the node setting when the node exposes one', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ url: 'https://discord.gg/rotated' })) as unknown as typeof fetch
    expect(await loadCommunityInvite(fetchImpl)).toBe('https://discord.gg/rotated')
  })

  it('falls back to the constant when the node has no invite', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ url: null })) as unknown as typeof fetch
    expect(await loadCommunityInvite(fetchImpl)).toBe(COMMUNITY_FALLBACK_URL)
  })

  it('falls back when the node is unreachable, never returns an empty link', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await loadCommunityInvite(fetchImpl)).toBe(COMMUNITY_FALLBACK_URL)
  })

  it('ignores a non-http invite (no javascript: URLs) and caches the answer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ url: 'javascript:alert(1)' })) as unknown as typeof fetch
    expect(await loadCommunityInvite(fetchImpl)).toBe(COMMUNITY_FALLBACK_URL)
    // Cached: a second call must not hit the node again.
    await loadCommunityInvite(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('only opens http(s) links', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    openCommunityInvite('https://discord.gg/Xkqb6U4Na')
    openCommunityInvite('javascript:alert(1)')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://discord.gg/Xkqb6U4Na', '_blank', 'noopener,noreferrer')
    vi.unstubAllGlobals()
  })
})
