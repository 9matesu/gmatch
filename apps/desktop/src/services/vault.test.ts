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
})
