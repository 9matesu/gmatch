// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

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

  it('refuses to self-map URLs when the bridge is absent (no fake local)', async () => {
    delete (window as any).gmatch
    delete storage['goonmatch-settings']
    const { vaultPin, vaultGet } = await import('./vault')
    const mp4Url = 'https://example.com/clips/video.mp4'
    // No bridge means no durable byte store behind the vault: pinning must
    // NOT record url->url (that self-mapping sent opens to the provider).
    const pinned = await vaultPin(mp4Url)
    expect(pinned).toBeNull()
    expect(await vaultGet(mp4Url)).toBeNull()
    expect(storage['gmatch_vault_v1'] || '').not.toContain(mp4Url)
  })
})

describe('useVaultHttpUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps vault:// URLs to localhost http URLs and ignores anything else', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ local: null })),
      vaultHttpUrl: vi.fn(async (url: string) => ({
        local: url.startsWith('vault://') ? `http://127.0.0.1:9/v/${encodeURIComponent(url)}` : null,
      })),
    }
    const { useVaultHttpUrls } = await import('./vault')
    const { result } = renderHook(() =>
      useVaultHttpUrls(['vault://f/abc123', 'https://x/y.jpg', '/api/objects/abc', null, undefined]),
    )
    await waitFor(() =>
      expect(result.current['vault://f/abc123']).toMatch(/^http:\/\/127\.0\.0\.1/),
    )
    expect(result.current['https://x/y.jpg']).toBeUndefined()
    expect(result.current['/api/objects/abc']).toBeUndefined()
  })

  it('leaves vault:// URLs unmapped when the bridge has no bytes for them', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ local: null })),
      vaultHttpUrl: vi.fn(async () => ({ local: null })),
    }
    const { useVaultHttpUrls } = await import('./vault')
    const { result } = renderHook(() => useVaultHttpUrls(['vault://f/missing']))
    // Settles without a mapping (callers fall back to the raw vault:// URL).
    await waitFor(() =>
      expect((window as any).gmatch.vaultHttpUrl).toHaveBeenCalled(),
    )
    expect(result.current['vault://f/missing']).toBeUndefined()
  })
})
