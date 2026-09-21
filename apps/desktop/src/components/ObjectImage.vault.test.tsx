// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { ObjectImage } from './ObjectImage'

const VAULT_URL = 'vault://f/abc123'
const VAULT_HTTP = 'http://127.0.0.1:9/v/vault%3A%2F%2Ff%2Fabc123'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) }))
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  (window as unknown as { gmatch: unknown }).gmatch = {
    vaultGet: vi.fn(async () => ({ local: null })),
    vaultHttpUrl: vi.fn(async (url: string) => ({ local: url.startsWith('vault://') ? VAULT_HTTP : null })),
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  window.HTMLMediaElement.prototype.load = vi.fn()
})

describe('ObjectImage with vault:// content', () => {
  const identity = { orbitId: 'u1', publicKeyHex: 'a', privateKeyHex: 'b' }

  it('does NOT signed-fetch /api/objects/<postId> when contentUrl is vault://, even with objectId set', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch)
    let container: HTMLElement
    await act(async () => {
      const res = render(
        <ObjectImage
          contentUrl={VAULT_URL}
          objectId="post_123"
          identity={identity}
          mimeType="video/mp4"
          loading="eager"
        />,
      )
      container = res.container
    })
    await waitFor(() => expect(container!.querySelector('video')).toBeInTheDocument())
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(calls.some((u) => u.includes('/api/objects/post_123'))).toBe(false)
  })

  it('resolves vault:// to the localhost http URL for playback', async () => {
    let container: HTMLElement
    await act(async () => {
      const res = render(
        <ObjectImage
          contentUrl={VAULT_URL}
          objectId="post_123"
          identity={identity}
          mimeType="video/mp4"
          loading="eager"
        />,
      )
      container = res.container
    })
    await waitFor(() => expect(container!.querySelector('video')).toBeInTheDocument())
    expect(container!.querySelector('video')).toHaveAttribute('src', VAULT_HTTP)
  })
})
