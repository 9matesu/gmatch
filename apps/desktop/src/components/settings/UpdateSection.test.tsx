// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { UpdateSection } from './UpdateSection'

type Status = { phase: string; version?: string; latest?: string; error?: string; percent?: number; verified?: boolean | null }

function stubPackagedBridge(initial: Status) {
  const listeners: ((s: Status) => void)[] = []
  const bridge = {
    appVersion: vi.fn().mockResolvedValue('1.1.4'),
    openExternal: vi.fn().mockResolvedValue(undefined),
    updateCheck: vi.fn().mockResolvedValue(initial),
    updateState: vi.fn().mockResolvedValue(initial),
    updateInstall: vi.fn().mockResolvedValue({ ok: true }),
    onUpdateStatus: (cb: (s: Status) => void) => { listeners.push(cb); return () => {} },
  }
  ;(window as unknown as { gmatch: unknown }).gmatch = bridge
  return {
    bridge,
    emit: (s: Status) => { for (const l of [...listeners]) l(s) },
  }
}

beforeEach(() => {
  delete (window as unknown as { gmatch?: unknown }).gmatch
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })))
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { gmatch?: unknown }).gmatch
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('UpdateSection (packaged self-update)', () => {
  it('hydrates installed version and ready state from update:state', async () => {
    const { bridge } = stubPackagedBridge({ phase: 'ready', version: '1.2.0', verified: true })
    render(<UpdateSection toast={() => {}} />)
    expect(await screen.findByText('1.1.4')).toBeInTheDocument()
    await waitFor(() => expect(bridge.updateState).toHaveBeenCalled())
    const btn = await screen.findByRole('button', { name: /install & restart/i })
    expect(btn).toBeInTheDocument()
    expect(screen.getByText(/verified/i)).toBeInTheDocument()
  })

  it('downloading status renders the progress bar', async () => {
    const { emit } = stubPackagedBridge({ phase: 'idle' })
    render(<UpdateSection toast={() => {}} />)
    await screen.findByText('1.1.4')
    act(() => { emit({ phase: 'downloading', version: '1.2.0', percent: 47 }) })
    await waitFor(() => {
      const bar = screen.getByRole('progressbar')
      expect(bar).toHaveAttribute('aria-valuenow', '47')
    })
  })

  it('install asks for confirmation then calls updateInstall', async () => {
    const { bridge } = stubPackagedBridge({ phase: 'ready', version: '1.2.0' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<UpdateSection toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /install & restart/i }))
    await waitFor(() => expect(bridge.updateInstall).toHaveBeenCalled())
  })

  it('cancel on confirm does not install', async () => {
    const { bridge } = stubPackagedBridge({ phase: 'ready', version: '1.2.0' })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<UpdateSection toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /install & restart/i }))
    await new Promise((r) => setTimeout(r, 20))
    expect(bridge.updateInstall).not.toHaveBeenCalled()
  })

  it('error status offers the GitHub releases fallback', async () => {
    const { bridge, emit } = stubPackagedBridge({ phase: 'idle' })
    render(<UpdateSection toast={() => {}} />)
    await screen.findByText('1.1.4')
    act(() => { emit({ phase: 'error', error: 'sha256 mismatch — download discarded' }) })
    const link = await screen.findByRole('button', { name: /github releases/i })
    fireEvent.click(link)
    expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/9matesu/goongrid/releases/latest')
    expect(screen.getByText(/sha256 mismatch/i)).toBeInTheDocument()
  })

  it('manual check toasts when already current', async () => {
    const { bridge } = stubPackagedBridge({ phase: 'current', latest: '1.1.4' })
    const toasts: string[] = []
    render(<UpdateSection toast={(m) => toasts.push(m)} />)
    fireEvent.click(await screen.findByRole('button', { name: /check for updates/i }))
    await waitFor(() => expect(bridge.updateCheck).toHaveBeenCalled())
    await waitFor(() => expect(toasts.join('|')).toMatch(/latest version/i))
  })
})

describe('UpdateSection (legacy fallback without updater bridge)', () => {
  it('uses release.json and offers the plain download when newer', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      appVersion: vi.fn().mockResolvedValue('1.1.3'),
      openExternal: vi.fn().mockResolvedValue(undefined),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      file: 'gMatch-9.9.9-portable.exe', version: '9.9.9', sha256: 'ab'.repeat(32), buildDate: '2026-09-10T00:00:00Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<UpdateSection toast={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /check for updates/i }))
    const dl = await screen.findByRole('button', { name: /download 9\.9\.9/i })
    expect(dl).toBeInTheDocument()
    fireEvent.click(dl)
    expect((window as unknown as { gmatch: { openExternal: ReturnType<typeof vi.fn> } }).gmatch.openExternal)
      .toHaveBeenCalled()
    expect(await screen.findByText(/verify before running/i)).toBeInTheDocument()
  })

  it('renders fallback update section without any bridge (pure browser)', async () => {
    render(<UpdateSection toast={() => {}} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /what's new/i })).toBeInTheDocument()
  })
})

