// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaqSetupModal } from './MediaqSetupModal'

// Manual storage stub (repo convention): the jsdom pragma is unreliable for
// localStorage when vitest runs from the workspace root.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})

type GmatchStub = {
  mediaqStatus: ReturnType<typeof vi.fn>
  mediaqInstall: ReturnType<typeof vi.fn>
  onMediaqProgress: ReturnType<typeof vi.fn>
}

function stubGmatch(over: Partial<GmatchStub> = {}) {
  const g: GmatchStub = {
    mediaqStatus: vi.fn(async () => ({ installed: false, running: false, base: 'http://127.0.0.1:8765' })),
    mediaqInstall: vi.fn(async () => ({ ok: true, bin: 'mediaq' })),
    onMediaqProgress: vi.fn(() => () => {}),
    ...over,
  }
  ;(window as unknown as { gmatch: GmatchStub }).gmatch = g
  return g
}

describe('MediaqSetupModal', () => {
  beforeEach(() => {
    mem.clear()
  })

  it('offers the install action when mediaq is absent and installs on click', async () => {
    const g = stubGmatch()
    render(<MediaqSetupModal open onClose={() => {}} />)
    const btn = await screen.findByRole('button', { name: /install media suite/i })
    fireEvent.click(btn)
    await waitFor(() => expect(g.mediaqInstall).toHaveBeenCalledTimes(1))
  })

  it('reports already-installed and hides the install button', async () => {
    stubGmatch({ mediaqStatus: vi.fn(async () => ({ installed: true, running: true, base: 'x' })) })
    render(<MediaqSetupModal open onClose={() => {}} />)
    await screen.findByText(/already installed/i)
    expect(screen.queryByRole('button', { name: /install media suite/i })).toBeNull()
  })

  it('renders nothing when closed', () => {
    stubGmatch()
    const { container } = render(<MediaqSetupModal open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})