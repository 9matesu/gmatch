// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('vaultPin negative cache', () => {
  const bridge = { vaultGet: vi.fn(async () => ({ local: null })), vaultPin: vi.fn(async () => ({ local: null })) }
  const storage: Record<string, string> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    storage['goonmatch-settings'] = JSON.stringify({ localVault: true })
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => { storage[k] = v },
        removeItem: (k: string) => { delete storage[k] },
        clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
        length: 1,
        key: () => null,
      },
      configurable: true,
      writable: true,
    })
    ;(window as unknown as { gmatch: unknown }).gmatch = bridge
    const mod = await import('./vault')
    mod._resetSessionGuards?.()
  })

  it('does not re-call the bridge for a URL that already failed', async () => {
    const { vaultPin } = await import('./vault')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    expect(bridge.vaultPin).toHaveBeenCalledTimes(1)
  })

  it('defaults to opt-in when localVault setting is missing', async () => {
    delete storage['goonmatch-settings']
    const { vaultOptIn } = await import('./vault')
    expect(vaultOptIn()).toBe(true)
  })

  it('saves MP4s and media to localStorage by default when bridge is absent', async () => {
    delete (window as any).gmatch
    delete storage['goonmatch-settings']
    const { vaultPin, vaultGet } = await import('./vault')
    const mp4Url = 'https://example.com/clips/video.mp4'
    const pinned = await vaultPin(mp4Url)
    expect(pinned).toBe(mp4Url)
    const stored = await vaultGet(mp4Url)
    expect(stored).toBe(mp4Url)
    expect(storage['gmatch_vault_v1']).toContain(mp4Url)
  })
})
