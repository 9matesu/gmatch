// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

describe('vaultPin negative cache', () => {
  const bridge = { vaultGet: vi.fn(async () => ({ local: null as string | null })), vaultPin: vi.fn(async () => ({ local: null as string | null })) }
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

  it('suppresses retries briefly after a failure', async () => {
    const { vaultPin } = await import('./vault')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    await vaultPin('https://x/dead.jpg')
    expect(bridge.vaultPin).toHaveBeenCalledTimes(1)
  })

  it('retries a failed pin after the short cooldown', async () => {
    vi.useFakeTimers()
    bridge.vaultPin.mockResolvedValueOnce({ local: null }).mockResolvedValueOnce({ local: 'vault://f/recovered' })
    const { vaultPin } = await import('./vault')
    await vaultPin('https://x/flaky.jpg')
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await vaultPin('https://x/flaky.jpg')).toBe('vault://f/recovered')
    expect(bridge.vaultPin).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
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

describe('vaultGet — media kind comes from the stored row, not the URL', () => {
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
    const mod = await import('./vault')
    mod._resetSessionGuards?.()
    mod._resetVaultLookups?.()
  })

  it('serves an extensionless VIDEO row through the Range-capable localhost URL', async () => {
    // Vault rows are named by bare content hash (<uuid> / <sha256>), so the
    // extension test never fired and <video> got a raw vault:// URL that cannot
    // seek or stream. The row's own mime decides.
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ state: 'local', local: 'vault://f/deadbeef', mime: 'video/mp4' })),
      vaultHttpUrl: vi.fn(async () => ({ local: 'http://127.0.0.1:9/f/deadbeef' })),
    }
    const { vaultGet } = await import('./vault')
    await expect(vaultGet('https://x/clip')).resolves.toBe('http://127.0.0.1:9/f/deadbeef')
    expect((window as any).gmatch.vaultHttpUrl).toHaveBeenCalledWith('vault://f/deadbeef')
  })

  it('leaves an IMAGE row on its vault:// URL', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ state: 'local', local: 'vault://f/cafe', mime: 'image/jpeg' })),
      vaultHttpUrl: vi.fn(async () => ({ local: 'http://127.0.0.1:9/f/cafe' })),
    }
    const { vaultGet } = await import('./vault')
    await expect(vaultGet('https://x/pic.jpg')).resolves.toBe('vault://f/cafe')
    expect((window as any).gmatch.vaultHttpUrl).not.toHaveBeenCalled()
  })

  it('reports the lookup as settled for hits AND misses (never for a disabled vault)', async () => {
    const { vaultGet, vaultLookupSettled } = await import('./vault')
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ state: 'local', local: 'vault://f/cafe', mime: 'image/jpeg' })),
    }
    await vaultGet('https://x/hit.jpg')
    expect(vaultLookupSettled('https://x/hit.jpg')).toBe(true)

    ;(window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ state: 'absent' })),
    }
    await vaultGet('https://x/miss.jpg')
    expect(vaultLookupSettled('https://x/miss.jpg')).toBe(true)

    storage['goonmatch-settings'] = JSON.stringify({ localVault: false })
    expect(await vaultGet('https://x/off.jpg')).toBeNull()
    expect(vaultLookupSettled('https://x/off.jpg')).toBe(false)
    // Restore: a disabled vault must not leak into the next suite's settings.
    storage['goonmatch-settings'] = JSON.stringify({ localVault: true })
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
