// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaqSetupModal } from './MediaqSetupModal'
import { useMediaqInstall } from '../../services/mediaqInstall'

// Manual storage stub (repo convention): the jsdom pragma is unreliable for
// localStorage when vitest runs from the workspace root.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})

function stubGmatch() {
  const g = {
    mediaqStatus: vi.fn(async () => ({ installed: false, running: false, base: 'x' })),
    mediaqInstall: vi.fn(async () => ({ ok: true, bin: 'mediaq' })),
    mediaqCancel: vi.fn(async () => ({ ok: true })),
    onMediaqProgress: vi.fn(() => () => {}),
  }
  ;(window as unknown as { gmatch: typeof g }).gmatch = g
  return g
}

describe('MediaqSetupModal', () => {
  beforeEach(() => {
    mem.clear()
    useMediaqInstall.setState({ open: false, status: 'idle', percent: null, message: '' })
  })

  it('offers the install action when idle and installs on click', async () => {
    const g = stubGmatch()
    useMediaqInstall.setState({ open: true, status: 'idle' })
    render(<MediaqSetupModal />)
    const btn = await screen.findByRole('button', { name: /install media suite/i })
    fireEvent.click(btn)
    await waitFor(() => expect(g.mediaqInstall).toHaveBeenCalledTimes(1))
  })

  it('shows a progress bar while installing and can cancel', async () => {
    stubGmatch()
    useMediaqInstall.setState({ open: true, status: 'installing', percent: 42, message: 'Downloading uv…' })
    render(<MediaqSetupModal />)
    expect(screen.getByText('42%')).toBeTruthy()
    const cancel = screen.getByRole('button', { name: /cancel/i })
    expect(cancel).toBeTruthy()
  })

  it('shows done and hides the install button when done', () => {
    stubGmatch()
    useMediaqInstall.setState({ open: true, status: 'done', percent: 100, message: 'mediaq is ready' })
    render(<MediaqSetupModal />)
    expect(screen.getByText(/mediaq is ready/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /install media suite/i })).toBeNull()
  })

  it('renders nothing when closed', () => {
    stubGmatch()
    useMediaqInstall.setState({ open: false })
    const { container } = render(<MediaqSetupModal />)
    expect(container.firstChild).toBeNull()
  })
})