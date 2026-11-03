// @vitest-environment jsdom
// Phase 4 — the zoom modal's "open original" must prefer bytes this device
// already holds over the signed node stream (which dies with the author's
// node), and only fall back to the network when nothing is held locally.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const localHeldMediaUrl = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null))
const orbitFetch = vi.hoisted(() => vi.fn())

vi.mock('../utils/localMedia', () => ({ localHeldMediaUrl }))
vi.mock('../utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/api')>()),
  orbitFetch,
}))

const { CardZoomModal } = await import('./CardZoomModal') as unknown as { CardZoomModal: (props: Record<string, unknown>) => ReactElement }

const IDENTITY = {
  orbitId: 'a'.repeat(64),
  publicKeyHex: 'b'.repeat(64),
  privateKeyHex: 'c'.repeat(64),
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localHeldMediaUrl.mockReset().mockResolvedValue(null)
  orbitFetch.mockReset()
})

/** The mounted ObjectImage child also signs node streams ({method:'GET'});
 *  the open-original button alone calls orbitFetch with `{}` — attribution
 *  by call signature, so the assertion says what the button did. */
const buttonFetchCalls = (): unknown[][] =>
  orbitFetch.mock.calls.filter((call) => Object.keys(call[1] as object).length === 0)

/** jsdom has no URL.createObjectURL (the node-fallback opens a blob URL). */
function stubObjectUrls() {
  let n = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => `blob:fake-${++n}`,
    revokeObjectURL: () => {},
  }))
}

describe('CardZoomModal — open original prefers locally held bytes', () => {
  it('opens the local URL and does not sign a node stream for it', async () => {
    const opened: string[] = []
    vi.stubGlobal('open', vi.fn((url: string) => { opened.push(url) }))
    stubObjectUrls()
    orbitFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['node bytes']) })
    localHeldMediaUrl.mockResolvedValue('http://127.0.0.1:8791/vault/held.mp4')
    render(
      <CardZoomModal
        isOpen
        onClose={() => {}}
        imageUrl={`/api/objects/${'d'.repeat(8)}-1111-4222-8333-444444444444`}
        identity={IDENTITY}
      />,
    )
    fireEvent.click(screen.getByTitle('Open original image in new tab'))
    await waitFor(() => {
      expect(opened).toEqual(['http://127.0.0.1:8791/vault/held.mp4'])
    })
    expect(buttonFetchCalls()).toHaveLength(0)
  })

  it('falls back to the signed node stream on an honest local miss', async () => {
    const opened: string[] = []
    vi.stubGlobal('open', vi.fn((url: string) => { opened.push(url) }))
    stubObjectUrls()
    orbitFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['node bytes']) })
    render(
      <CardZoomModal
        isOpen
        onClose={() => {}}
        imageUrl={`/api/objects/${'e'.repeat(8)}-1111-4222-8333-444444444444`}
        identity={IDENTITY}
      />,
    )
    fireEvent.click(screen.getByTitle('Open original image in new tab'))
    await waitFor(() => {
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatch(/^blob:/)
    })
    expect(buttonFetchCalls()).toHaveLength(1)
  })
})
