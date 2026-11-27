// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaqSection } from './MediaqSection'
import { useMediaqInstall } from '../../services/mediaqInstall'

type Props = Parameters<typeof MediaqSection>[0]

/** The status probe is async IPC; let it settle inside act so no test races it. */
async function renderSection(props: Props = {}) {
  await act(async () => { render(<MediaqSection {...props} />) })
}

function stubBridge(over: Record<string, unknown> = {}) {
  const g = {
    mediaqStatus: vi.fn(async () => ({ installed: false, running: false, base: 'http://127.0.0.1:8765' })),
    mediaqInstall: vi.fn(async () => ({ ok: true, bin: 'mediaq' })),
    mediaqCancel: vi.fn(async () => ({ ok: true })),
    mediaqStart: vi.fn(async () => ({ ok: true, base: 'http://127.0.0.1:8765' })),
    mediaqStop: vi.fn(async () => ({ ok: true, running: false, stopped: true })),
    mediaqRestart: vi.fn(async () => ({ ok: true, base: 'http://127.0.0.1:8765' })),
    onMediaqProgress: vi.fn(() => () => {}),
    ...over,
  }
  ;(window as unknown as { gmatch: typeof g }).gmatch = g
  return g
}

describe('MediaqSection', () => {
  beforeEach(() => {
    useMediaqInstall.setState({ open: false, status: 'idle', percent: null, message: '' })
  })

  it('offers a one-click install that stays inline in Settings', async () => {
    const g = stubBridge()
    await renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /install media suite/i }))
    await waitFor(() => expect(g.mediaqInstall).toHaveBeenCalledTimes(1))
    // The store is started with showModal=false: install progress lives here,
    // not in a modal that pops over Settings.
    expect(useMediaqInstall.getState().open).toBe(false)
  })

  it('shows determinate progress, cancel and background while installing', async () => {
    const g = stubBridge()
    const onClose = vi.fn()
    useMediaqInstall.setState({ open: false, status: 'installing', percent: 42, message: 'Downloading uv…' })
    await renderSection({ onClose })
    expect(screen.getByText('42%')).toBeTruthy()
    // Background first: the store leaves the installing state on cancel, so
    // the background action is only present while the install is in flight.
    fireEvent.click(screen.getByRole('button', { name: /send to background/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })
    expect(g.mediaqCancel).toHaveBeenCalledTimes(1)
  })

  it('renders an indeterminate bar (no percent) for the install phase', async () => {
    stubBridge()
    useMediaqInstall.setState({ status: 'installing', percent: null, message: 'Installing mediaq…' })
    await renderSection()
    expect(screen.queryByText(/\d+%/)).toBeNull()
    expect(screen.getByText(/installing mediaq/i)).toBeTruthy()
  })

  it('reports success once installed', async () => {
    stubBridge({ mediaqStatus: vi.fn(async () => ({ installed: true, running: true, base: 'x' })) })
    useMediaqInstall.setState({ status: 'done', percent: 100, message: 'mediaq is ready' })
    await renderSection()
    expect(await screen.findByText(/installed and running/i)).toBeTruthy()
  })

  it('can start an installed server that is not running', async () => {
    let started = false
    const g = stubBridge({
      mediaqStatus: vi.fn(async () => ({ installed: true, running: started, base: 'x' })),
      mediaqStart: vi.fn(async () => { started = true; return { ok: true, base: 'x' } }),
    })
    await renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /start media suite/i }))
    await waitFor(() => expect(g.mediaqStart).toHaveBeenCalledTimes(1))
    // "Running" comes from a fresh probe, never from the click alone.
    expect(await screen.findByText(/installed and running/i)).toBeTruthy()
  })

  it('distinguishes installed from running (never claims a stopped server is ready)', async () => {
    stubBridge({ mediaqStatus: vi.fn(async () => ({ installed: true, running: false, base: 'x' })) })
    await renderSection()
    expect(await screen.findByText(/installed\. start the local server/i)).toBeTruthy()
    expect(screen.queryByText(/installed and running/i)).toBeNull()
  })

  it('can stop and restart a running server from Settings', async () => {
    const g = stubBridge({ mediaqStatus: vi.fn(async () => ({ installed: true, running: true, base: 'x' })) })
    await renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /stop media suite/i }))
    await waitFor(() => expect(g.mediaqStop).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: /restart media suite/i }))
    await waitFor(() => expect(g.mediaqRestart).toHaveBeenCalledTimes(1))
  })

  it('reports a failed start with its real reason', async () => {
    const g = stubBridge({
      mediaqStatus: vi.fn(async () => ({ installed: true, running: false, base: 'x' })),
      mediaqStart: vi.fn(async () => ({ ok: false, error: 'spawn ENOENT' })),
    })
    const toast = vi.fn()
    await renderSection({ toast })
    fireEvent.click(await screen.findByRole('button', { name: /start media suite/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/spawn ENOENT/), 'error'))
    expect(g.mediaqStart).toHaveBeenCalledTimes(1)
  })

  it('reports a stop that did not take effect instead of claiming success', async () => {
    stubBridge({
      mediaqStatus: vi.fn(async () => ({ installed: true, running: true, base: 'x' })),
      mediaqStop: vi.fn(async () => ({ ok: false, running: true, error: 'still-running' })),
    })
    const toast = vi.fn()
    await renderSection({ toast })
    fireEvent.click(await screen.findByRole('button', { name: /stop media suite/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/still running/i), 'warning'))
  })

  it('degrades honestly without the desktop bridge', async () => {
    ;(window as unknown as { gmatch: undefined }).gmatch = undefined
    await renderSection()
    expect(screen.getByText(/desktop app only/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /install media suite/i })).toBeNull()
  })
})
